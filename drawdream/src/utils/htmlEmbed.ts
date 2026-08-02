/**
 * 消息正文 HTML 混排切分：围栏 / 整页文档 / 顶层 styled div 块。
 * 供 RichMessage 把 HTML 与叙事交替渲染。
 */

export type HtmlPart =
  | { kind: 'text'; text: string }
  | { kind: 'html'; html: string; scripts: boolean }

/** 是否像完整 HTML 文档 */
export function looksLikeHtmlDocument(text: string): boolean {
  if (!text) return false
  const t = text.trim()
  const head = t.slice(0, 80).toLowerCase()
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return true
  if (/<\/html\s*>/i.test(t) && /<html[\s>]/i.test(t)) return true
  return false
}

/** 从 ```html … ``` 围栏提取 */
function takeFence(
  src: string,
  from: number,
): { end: number; html: string; scripts: boolean } | null {
  const rest = src.slice(from)
  const m = /^```([^\n`]*)\r?\n([\s\S]*?)```/.exec(rest)
  if (!m) return null
  const lang = (m[1] || '').trim().toLowerCase()
  if (!/\bhtml\b/.test(lang) && lang !== '' && !lang.startsWith('html')) {
    // 仅认 html 围栏；空 lang 且内容像 HTML 也认
    if (!looksLikeHtmlDocument(m[2]) && !/^\s*<div\b/i.test(m[2])) return null
  }
  return { end: from + m[0].length, html: m[2], scripts: /\bscripts?\b/i.test(lang) }
}

/** 匹配顶层带 style 或 class 的 div 块 */
function takeStyledDiv(src: string, from: number): { end: number; html: string } | null {
  const re = /<div\b[^>]*\b(?:style|class)\s*=/gi
  re.lastIndex = from
  const m = re.exec(src)
  if (!m || m.index !== from) {
    // 允许 from 处有空白
    const slice = src.slice(from)
    const lead = slice.match(/^\s*/)
    const start = from + (lead ? lead[0].length : 0)
    re.lastIndex = start
    const m2 = re.exec(src)
    if (!m2 || m2.index !== start) return null
    return closeDiv(src, m2.index)
  }
  return closeDiv(src, m.index)
}

function closeDiv(src: string, openAt: number): { end: number; html: string } | null {
  const tokenRe = /<div\b|<\/div\s*>/gi
  tokenRe.lastIndex = openAt + 1
  let depth = 1
  let tk: RegExpExecArray | null
  while ((tk = tokenRe.exec(src))) {
    if (tk[0].toLowerCase().startsWith('</')) {
      depth--
      if (depth === 0) {
        const end = tokenRe.lastIndex
        return { end, html: src.slice(openAt, end) }
      }
    } else {
      depth++
    }
  }
  return null
}

/**
 * 将正文切成 text/html 交替序列。
 * 识别：```html 围栏、整页 HTML、顶层 styled <div>。
 */
export function splitHtmlParts(text: string): HtmlPart[] {
  if (!text) return []
  if (looksLikeHtmlDocument(text)) {
    return [{ kind: 'html', html: text.trim(), scripts: /<script[\s>]/i.test(text) }]
  }

  const parts: HtmlPart[] = []
  let i = 0
  const pushText = (s: string) => {
    if (!s) return
    const last = parts[parts.length - 1]
    if (last?.kind === 'text') last.text += s
    else parts.push({ kind: 'text', text: s })
  }

  while (i < text.length) {
    // 围栏
    if (text.startsWith('```', i)) {
      const f = takeFence(text, i)
      if (f) {
        parts.push({ kind: 'html', html: f.html, scripts: f.scripts })
        i = f.end
        continue
      }
    }
    // 整页文档起头（消息中段）
    const slice = text.slice(i)
    if (/^\s*<(!doctype\s+html|html[\s>])/i.test(slice)) {
      const endMatch = /<\/html\s*>/i.exec(slice)
      if (endMatch) {
        const end = i + endMatch.index + endMatch[0].length
        const html = text.slice(i, end).trim()
        parts.push({ kind: 'html', html, scripts: /<script[\s>]/i.test(html) })
        i = end
        continue
      }
    }
    // styled div
    const ws = text.slice(i).match(/^\s*/)?.[0].length ?? 0
    const at = i + ws
    if (at < text.length && /^<div\b/i.test(text.slice(at))) {
      const d = takeStyledDiv(text, at)
      if (d && d.html.length > 40) {
        if (ws) pushText(text.slice(i, at))
        parts.push({ kind: 'html', html: d.html, scripts: /<script[\s>]/i.test(d.html) })
        i = d.end
        continue
      }
    }
    // 普通字符
    pushText(text[i]!)
    i++
  }

  // 合并：若仅一段纯 text，保持原样
  if (parts.length === 0) return [{ kind: 'text', text }]
  return parts
}

/**
 * 检测文本是否包含美化 HTML 标记（div/table/style 等）。
 * 用于消息更新时判断是否应提升为 html channel 渲染。
 */
export function looksLikeHtmlMarkup(text: string): boolean {
  if (!text) return false
  const t = text.trim()
  if (!t) return false
  if (looksLikeHtmlDocument(t)) return true
  if (/^\s*```html[\s\S]*?```\s*$/i.test(t)) return true
  // 美化卡片常用结构：带 style/class 的块级元素、表格、style 块
  return /<\s*(?:div|table|style|section|article|aside)\b[^>]*(?:\b(?:style|class)\s*=|\b(?:style|class)\s*=)?/i.test(t) ||
    /<\s*style\b[\s\S]*?<\/\s*style\s*>/i.test(t) ||
    (/<\s*div\b[^>]*>/i.test(t) && /<\s*\/\s*div\s*>/i.test(t))
}
