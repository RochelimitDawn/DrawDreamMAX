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

/** 文档内是否含可执行脚本（决定 HtmlFrame scripts 沙箱） */
export function htmlLooksInteractive(html: string): boolean {
  return /<script[\s>]/i.test(html) || /\bon[a-z]+\s*=/i.test(html)
}

/** body 是否为「恰好一份」完整 HTML 文档（末尾 </html> 后仅空白） */
function bodyIsSingleCompleteDoc(body: string): boolean {
  const re = /<\/html\s*>/gi
  let m: RegExpExecArray | null
  let count = 0
  let lastEnd = -1
  while ((m = re.exec(body)) !== null) {
    count++
    lastEnd = m.index + m[0].length
  }
  if (count === 1) return body.slice(lastEnd).trim() === ''
  if (count === 0) {
    return body.length >= 200 && /<\/(div|section|body)>/i.test(body)
  }
  return false
}

/**
 * 从文本中定位「围栏包裹的 HTML 文档/大界面」（卡显示正则常见产物）。
 * 闭合策略：
 * 1) 优先首个「恰好一份完整文档」的行首 ```（多 state/options 各进独立帧）
 * 2) 否则回退末闭（单文档内含行首 ``` 时避免提前截断）
 */
export function findFencedHtmlDocument(
  text: string,
): { html: string; scripts: boolean; start: number; end: number } | null {
  if (!text) return null
  const openRe = /(^|\n)(```([^\n`]*)\r?\n)/g
  let om: RegExpExecArray | null
  while ((om = openRe.exec(text)) !== null) {
    const fenceStart = om.index + om[1].length
    const openTok = om[2]
    const lang = (om[3] ?? '').trim()
    if (lang && !/^html\b/i.test(lang) && !/^(?:html\s*\+?\s*(?:scripts?|js))$/i.test(lang)) {
      continue
    }
    const contentStart = fenceStart + openTok.length
    const probe = text.slice(contentStart, contentStart + 80).trimStart().toLowerCase()
    if (!probe.startsWith('<!doctype html') && !probe.startsWith('<html')) {
      if (!/^<(div|section|article|main|body)\b/i.test(probe) || text.length < 200) {
        continue
      }
    }
    const rest = text.slice(contentStart)
    const closeRe = /\r?\n```[ \t]*(?=\r?\n|$)/g
    let cm: RegExpExecArray | null
    let firstSingleClose = -1
    let firstSingleEnd = -1
    let lastClose = -1
    let lastEnd = -1
    while ((cm = closeRe.exec(rest)) !== null) {
      const body = rest.slice(0, cm.index)
      if (!/<\/html\s*>/i.test(body) && !(body.length >= 200 && /<\/(div|section|body)>/i.test(body))) {
        continue
      }
      lastClose = cm.index
      lastEnd = cm.index + cm[0].length
      if (firstSingleClose < 0 && bodyIsSingleCompleteDoc(body)) {
        firstSingleClose = cm.index
        firstSingleEnd = cm.index + cm[0].length
      }
    }
    const bestClose = firstSingleClose >= 0 ? firstSingleClose : lastClose
    const bestEnd = firstSingleClose >= 0 ? firstSingleEnd : lastEnd
    if (bestClose < 0) continue
    const html = rest.slice(0, bestClose).replace(/^\uFEFF/, '').trim()
    if (!html) continue
    const isDoc = looksLikeHtmlDocument(html)
    const isUiRoot = /^<(div|section|article|main|body)\b/i.test(html) && html.length >= 200
    if (!isDoc && !isUiRoot) continue
    const scripts = htmlLooksInteractive(html) || /\bscripts?\b|\bjs\b|\+/i.test(lang)
    return {
      html,
      scripts,
      start: fenceStart,
      end: contentStart + bestEnd,
    }
  }
  return null
}

/** 整段 trim 后恰为围栏 HTML 文档时返回 */
export function claimFencedHtmlDocument(text: string): { html: string; scripts: boolean } | null {
  const t = text.trim()
  const found = findFencedHtmlDocument(t)
  if (!found) return null
  const pre = t.slice(0, found.start).trim()
  const post = t.slice(found.end).trim()
  if (pre || post) return null
  return { html: found.html, scripts: found.scripts }
}

/** 粗判：整条消息就是一个界面（整楼模式） */
export function isFullInterface(text: string): boolean {
  const found = findFencedHtmlDocument(text)
  if (found) {
    const pre = text.slice(0, found.start).trim()
    const post = text.slice(found.end).trim()
    if (post) return false
    if (!pre) return true
    return pre.length <= 80 && !pre.includes('```') && !looksLikeHtmlDocument(pre)
  }
  if (looksLikeHtmlDocument(text.trim())) return true
  const parts = splitHtmlParts(text)
  return parts.length === 1 && parts[0]!.kind === 'html'
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
  return { end: from + m[0].length, html: m[2], scripts: /\bscripts?\b/i.test(lang) || htmlLooksInteractive(m[2]) }
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
  // 围栏 HTML 文档整段认领（卡开局 / 多状态栏产物）
  const found = findFencedHtmlDocument(text)
  if (found) {
    const parts: HtmlPart[] = []
    const pre = text.slice(0, found.start)
    if (pre.trim()) parts.push(...splitTopLevelDivs(pre))
    parts.push({ kind: 'html', html: found.html, scripts: found.scripts })
    const post = text.slice(found.end)
    if (post.trim()) parts.push(...splitHtmlParts(post))
    return parts
  }
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

/** 在纯文本段中切出行首起始、深度配平的标准容器块（div/section/table 等） */
function splitTopLevelDivs(text: string): HtmlPart[] {
  const blockRe = /^[ \t]*<(div|section|article|table|details)(\s[^>]*)?>/gm
  const parts: HtmlPart[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(text)) !== null) {
    const tag = m[1]!
    const tagRe = new RegExp(`<(/?)${tag}(?:\\s[^>]*)?>`, 'gi')
    tagRe.lastIndex = m.index
    let depth = 0
    let end = -1
    let t: RegExpExecArray | null
    while ((t = tagRe.exec(text)) !== null) {
      depth += t[1] ? -1 : 1
      if (depth === 0) {
        end = t.index + t[0].length
        break
      }
    }
    if (end < 0) continue
    const before = text.slice(last, m.index)
    if (before.trim()) parts.push({ kind: 'text', text: before })
    const html = text.slice(m.index, end).trim()
    parts.push({ kind: 'html', html, scripts: htmlLooksInteractive(html) })
    last = end
    blockRe.lastIndex = end
  }
  if (parts.length === 0) return [{ kind: 'text', text }]
  const rest = text.slice(last)
  if (rest.trim()) parts.push({ kind: 'text', text: rest })
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
