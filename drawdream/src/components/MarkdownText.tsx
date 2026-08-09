/**
 * 轻量 Markdown 渲染：标题/粗斜体/代码/列表/引用/链接/表格 + KaTeX 数学公式。
 *
 * 支持：
 * - 行内：$...$  \(...\)
 * - 块级：$$...$$  \[...\]  ```math|latex|tex|katex|equation
 * - 环境：\begin{equation|align|aligned|gather|...}...\end{...}
 * - 化学式：\ce{} / \pu{}（mhchem）
 * - 货币 $ 误伤防护； thrifty 错误回退
 * 不执行 HTML。
 */
import { useMemo, type ReactNode } from 'react'
import katex from 'katex'
import 'katex/contrib/mhchem'
import 'katex/dist/katex.min.css'
import { colorizeText, type ColorizePrefs } from '../utils/rule-colorize'
import './MarkdownText.css'

/** LLM / 教材常见宏 */
const KATEX_MACROS: Record<string, string> = {
  '\\RR': '\\mathbb{R}',
  '\\NN': '\\mathbb{N}',
  '\\ZZ': '\\mathbb{Z}',
  '\\CC': '\\mathbb{C}',
  '\\QQ': '\\mathbb{Q}',
  '\\FF': '\\mathbb{F}',
  '\\dd': '\\mathrm{d}',
  '\\ee': '\\mathrm{e}',
  '\\ii': '\\mathrm{i}',
  '\\abs': '\\left|#1\\right|',
  '\\norm': '\\left\\|#1\\right\\|',
  '\\set': '\\left\\{#1\\right\\}',
  '\\R': '\\mathbb{R}',
  '\\N': '\\mathbb{N}',
  '\\Z': '\\mathbb{Z}',
  '\\C': '\\mathbb{C}',
  '\\Q': '\\mathbb{Q}',
}

/** 块级/可独立成段的 math 环境名 */
const BLOCK_MATH_ENVS =
  /^(equation|align|aligned|alignat|flalign|gather|multline|eqnarray|split|cases|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|array|CD)\*?$/i

function stripOuterMathWrappers(tex: string): string {
  let t = tex.trim()
  // 去掉误包的 $$ / \[ \]
  if (/^\$\$[\s\S]*\$\$$/.test(t)) t = t.slice(2, -2).trim()
  if (/^\\\[[\s\S]*\\\]$/.test(t)) t = t.slice(2, -2).trim()
  // 去掉开头的 \[ 或 $$ 残留
  t = t.replace(/^\$\$\s*/, '').replace(/\s*\$\$$/, '')
  t = t.replace(/^\\\[\s*/, '').replace(/\s*\\\]$/, '')
  return t.trim()
}

function looksLikeCurrency(inner: string): boolean {
  // $5 / $5.99 / $1,234.00 — 纯金额不当公式
  return /^\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*$/.test(inner)
}

function looksLikeMathContent(inner: string): boolean {
  const t = inner.trim()
  if (!t) return false
  if (looksLikeCurrency(t)) return false
  // 含 LaTeX 命令、上下标、运算符、希腊/常见数学符号则更像公式
  if (/\\[a-zA-Z]+/.test(t)) return true
  if (/[_^={}]/.test(t)) return true
  if (/[+\-*/=<>≤≥≠≈±∞∑∏∫√∂∇∈∉⊂⊃∪∩→←↔⇒⇔∀∃]/.test(t)) return true
  if (/[α-ωΑ-Ω]/.test(t)) return true
  // 单字母 / 短标识（x、a1、theta）
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(t) && t.length <= 12) return true
  // 数字与字母混合短式：2x、x2、3ab
  if (/^[A-Za-z0-9]+$/.test(t) && /[A-Za-z]/.test(t) && t.length <= 16) return true
  // 括号表达式 (a+b)
  if (/[()]/.test(t) && /[A-Za-z0-9+\-*/=]/.test(t)) return true
  return t.length <= 40 && !/\s{2,}/.test(t) && /[A-Za-z0-9]/.test(t)
}

function renderKatex(tex: string, displayMode: boolean, key: string): ReactNode {
  const cleaned = stripOuterMathWrappers(tex)
  if (!cleaned) {
    return <span key={key} className="md-math-empty" />
  }
  try {
    const html = katex.renderToString(cleaned, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'html',
      macros: KATEX_MACROS,
      maxSize: 20,
      maxExpand: 1000,
    })
    // KaTeX 在 throwOnError:false 时错误会带 katex-error
    return (
      <span
        key={key}
        className={displayMode ? 'md-math md-math-block' : 'md-math md-math-inline'}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  } catch {
    return (
      <code key={key} className="md-code md-math-fallback" title="math render failed">
        {displayMode ? `$$${cleaned}$$` : `$${cleaned}$`}
      </code>
    )
  }
}

type InlineTok =
  | { k: 'text'; v: string }
  | { k: 'code'; v: string }
  | { k: 'math'; v: string; display: boolean }
  | { k: 'strong'; v: string }
  | { k: 'em'; v: string }
  | { k: 'link'; text: string; href: string }

/** 找配对的 \end{name}，处理嵌套同名环境 */
function findEnvEnd(src: string, from: number, envName: string): number {
  const openRe = new RegExp(`\\\\begin\\{${envName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'gi')
  const closeRe = new RegExp(`\\\\end\\{${envName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'gi')
  let depth = 1
  let i = from
  while (i < src.length && depth > 0) {
    openRe.lastIndex = i
    closeRe.lastIndex = i
    const o = openRe.exec(src)
    const c = closeRe.exec(src)
    if (!c) return -1
    if (o && o.index < c.index) {
      depth++
      i = o.index + o[0].length
    } else {
      depth--
      if (depth === 0) return c.index + c[0].length
      i = c.index + c[0].length
    }
  }
  return -1
}

/**
 * 从 pos 扫描行内/块定界公式；成功返回 [end, tex, display]，否则 null。
 */
function tryScanMath(
  src: string,
  pos: number,
): { end: number; tex: string; display: boolean } | null {
  const ch = src[pos]
  const prev = pos > 0 ? src[pos - 1] : ''

  // $$ ... $$
  if (src.startsWith('$$', pos)) {
    const close = src.indexOf('$$', pos + 2)
    if (close < 0) return null
    return { end: close + 2, tex: src.slice(pos + 2, close), display: true }
  }

  // \[ ... \]
  if (src.startsWith('\\[', pos)) {
    const close = src.indexOf('\\]', pos + 2)
    if (close < 0) return null
    return { end: close + 2, tex: src.slice(pos + 2, close), display: true }
  }

  // \( ... \)
  if (src.startsWith('\\(', pos)) {
    const close = src.indexOf('\\)', pos + 2)
    if (close < 0) return null
    const tex = src.slice(pos + 2, close)
    if (!tex.trim()) return null
    return { end: close + 2, tex, display: false }
  }

  // \begin{env} ... \end{env}
  if (src.startsWith('\\begin{', pos)) {
    const m = /^\\begin\{([A-Za-z*]+)\}/.exec(src.slice(pos))
    if (!m) return null
    const env = m[1]
    const bodyStart = pos + m[0].length
    const end = findEnvEnd(src, bodyStart, env)
    if (end < 0) return null
    const whole = src.slice(pos, end)
    const display = BLOCK_MATH_ENVS.test(env)
    return { end, tex: whole, display }
  }

  // $ ... $（非 $$）；货币与标识符边界防护
  if (ch === '$' && !src.startsWith('$$', pos)) {
    // 前一字符为字母/数字时不当开界（如 US$）
    if (prev && /[A-Za-z0-9]/.test(prev)) return null
    let i = pos + 1
    if (i >= src.length) return null
    // 开界后不得空白（避免 " $ x $" 误伤；真要空格用 \( \)）
    if (/\s/.test(src[i]!)) return null
    let escaped = false
    while (i < src.length) {
      const c = src[i]!
      if (escaped) {
        escaped = false
        i++
        continue
      }
      if (c === '\\') {
        escaped = true
        i++
        continue
      }
      if (c === '\n') {
        // 行内 $ 不允许跨行（跨行用 $$ / \[）
        return null
      }
      if (c === '$') {
        const inner = src.slice(pos + 1, i)
        const next = src[i + 1] || ''
        // 闭界后紧跟字母数字则更像货币片段
        if (next && /[A-Za-z0-9]/.test(next)) return null
        // 闭界前空白 → 非法
        if (/\s$/.test(inner)) return null
        if (!looksLikeMathContent(inner)) return null
        return { end: i + 1, tex: inner, display: false }
      }
      i++
    }
  }

  return null
}

function tokenizeInline(text: string): InlineTok[] {
  const toks: InlineTok[] = []
  let i = 0
  const n = text.length
  let buf = ''

  const flush = () => {
    if (buf) {
      toks.push({ k: 'text', v: buf })
      buf = ''
    }
  }

  while (i < n) {
    // 行内代码优先
    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1)
      if (close > i) {
        flush()
        toks.push({ k: 'code', v: text.slice(i + 1, close) })
        i = close + 1
        continue
      }
    }

    // 数学
    const math = tryScanMath(text, i)
    if (math) {
      flush()
      toks.push({ k: 'math', v: math.tex, display: math.display })
      i = math.end
      continue
    }

    // 粗体 ** ** / __ __
    if (text.startsWith('**', i) || text.startsWith('__', i)) {
      const mark = text.slice(i, i + 2)
      const close = text.indexOf(mark, i + 2)
      if (close > i + 1 && !text.slice(i + 2, close).includes('\n')) {
        flush()
        toks.push({ k: 'strong', v: text.slice(i + 2, close) })
        i = close + 2
        continue
      }
    }

    // 斜体 * * / _ _
    if (
      (text[i] === '*' || text[i] === '_') &&
      text[i + 1] &&
      text[i + 1] !== text[i] &&
      !/\s/.test(text[i + 1]!)
    ) {
      const mark = text[i]!
      let j = i + 1
      while (j < n && text[j] !== mark && text[j] !== '\n') j++
      if (j < n && text[j] === mark && j > i + 1) {
        flush()
        toks.push({ k: 'em', v: text.slice(i + 1, j) })
        i = j + 1
        continue
      }
    }

    // 链接 [text](url)
    if (text[i] === '[') {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(text.slice(i))
      if (lm) {
        flush()
        toks.push({ k: 'link', text: lm[1], href: lm[2] })
        i += lm[0].length
        continue
      }
    }

    buf += text[i]
    i++
  }
  flush()
  return toks
}

function coloredSpans(text: string, key: string, colorPrefs: ColorizePrefs): ReactNode[] {
  const spans = colorizeText(text, colorPrefs)
  return spans.map((sp, k) => (
    <span key={`${key}-c${k}`} className={sp.rule ? `read-hl read-hl-${sp.rule}` : undefined}>
      {sp.text}
    </span>
  ))
}

function pushColoredInline(text: string, key: string, colorPrefs: ColorizePrefs): ReactNode[] {
  const parts = text.split('\n')
  const nodes: ReactNode[] = []
  parts.forEach((part, j) => {
    if (part) nodes.push(...coloredSpans(part, `${key}-l${j}`, colorPrefs))
    if (j < parts.length - 1) nodes.push(<br key={`${key}-br${j}`} />)
  })
  return nodes.length ? nodes : [text]
}

function pushColoredText(
  nodes: ReactNode[],
  text: string,
  key: string,
  colorize: boolean,
  colorPrefs: ColorizePrefs | null,
) {
  const parts = text.split('\n')
  parts.forEach((part, j) => {
    if (part) {
      if (colorize && colorPrefs?.colorizeEnabled) {
        nodes.push(...coloredSpans(part, `${key}-t${j}`, colorPrefs))
      } else {
        nodes.push(<span key={`${key}-t${j}`}>{part}</span>)
      }
    }
    if (j < parts.length - 1) nodes.push(<br key={`${key}-br${j}`} />)
  })
}

function inlineMd(
  text: string,
  keyPrefix: string,
  colorize = false,
  colorPrefs: ColorizePrefs | null = null,
): ReactNode[] {
  const toks = tokenizeInline(text)
  const nodes: ReactNode[] = []
  let i = 0
  for (const tok of toks) {
    const key = `${keyPrefix}-${i++}`
    if (tok.k === 'text') {
      pushColoredText(nodes, tok.v, key, colorize, colorPrefs)
    } else if (tok.k === 'code') {
      nodes.push(
        <code key={key} className="md-code">
          {tok.v}
        </code>,
      )
    } else if (tok.k === 'math') {
      nodes.push(renderKatex(tok.v, tok.display, key))
    } else if (tok.k === 'strong') {
      if (colorize && colorPrefs?.colorizeEnabled) {
        nodes.push(
          <strong key={key} className="md-strong">
            {pushColoredInline(tok.v, key, colorPrefs)}
          </strong>,
        )
      } else {
        nodes.push(<strong key={key}>{tok.v}</strong>)
      }
    } else if (tok.k === 'em') {
      if (colorize && colorPrefs?.colorizeEnabled) {
        nodes.push(
          <em key={key} className="md-em">
            {pushColoredInline(tok.v, key, colorPrefs)}
          </em>,
        )
      } else {
        nodes.push(<em key={key}>{tok.v}</em>)
      }
    } else if (tok.k === 'link') {
      nodes.push(
        <a key={key} className="md-link" href={tok.href} target="_blank" rel="noreferrer noopener">
          {tok.text}
        </a>,
      )
    }
  }
  return nodes.length ? nodes : [<span key={`${keyPrefix}-0`}>{text}</span>]
}

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'table'; headers: string[]; rows: string[][]; aligns: Array<'left' | 'center' | 'right' | undefined> }
  | { t: 'quote'; text: string }
  | { t: 'pre'; text: string }
  | { t: 'math'; text: string }
  | { t: 'hr' }

const unorderedItemRe = /^[ \t]*(?:[-+•▪●]\s+|\*\s+)(\S.*)$/
const orderedItemRe = /^[ \t]*\d+[.)、]\s*(\S.*)$/
const tableDividerCellRe = /^:?-{3,}:?$/
const mathFenceLangRe = /^(math|latex|tex|katex|equation|align|aligned|gather)$/i
const beginEnvLineRe = /^[ \t]*\\begin\{([A-Za-z*]+)\}/

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function tableAlign(cell: string): 'left' | 'center' | 'right' | undefined {
  const trimmed = cell.trim()
  if (!tableDividerCellRe.test(trimmed)) return undefined
  if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center'
  if (trimmed.endsWith(':')) return 'right'
  if (trimmed.startsWith(':')) return 'left'
  return undefined
}

function isTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length || !lines[index].includes('|')) return false
  const headers = tableCells(lines[index])
  const divider = tableCells(lines[index + 1])
  return headers.length > 0 && divider.length === headers.length && divider.every((cell) => tableDividerCellRe.test(cell))
}

function isMathBlockStart(line: string): boolean {
  const t = line.trim()
  if (/^\$\$/.test(t)) return true
  if (/^\\\[/.test(t)) return true
  const bm = beginEnvLineRe.exec(line)
  if (bm && BLOCK_MATH_ENVS.test(bm[1])) return true
  return false
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    // 围栏代码 / 数学
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim().split(/\s+/)[0] || ''
      const body: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      if (i < lines.length) i++
      if (mathFenceLangRe.test(lang)) {
        blocks.push({ t: 'math', text: body.join('\n') })
      } else {
        blocks.push({ t: 'pre', text: body.join('\n') })
      }
      continue
    }
    // $$ 块
    if (/^\$\$/.test(line.trim())) {
      const one = line.trim()
      if (one.length > 4 && one.endsWith('$$') && !one.slice(2, -2).includes('$$')) {
        blocks.push({ t: 'math', text: one.slice(2, -2).trim() })
        i++
        continue
      }
      const body: string[] = [one.slice(2)]
      i++
      while (i < lines.length && !/\$\$\s*$/.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      if (i < lines.length) {
        body.push(lines[i].replace(/\$\$\s*$/, ''))
        i++
      }
      blocks.push({ t: 'math', text: body.join('\n').trim() })
      continue
    }
    // \[ ... \] 块
    if (/^\\\[/.test(line.trim())) {
      const one = line.trim()
      if (one.length > 4 && /\\\]\s*$/.test(one)) {
        blocks.push({ t: 'math', text: one.replace(/^\\\[/, '').replace(/\\\]\s*$/, '').trim() })
        i++
        continue
      }
      const body: string[] = [one.replace(/^\\\[/, '')]
      i++
      while (i < lines.length && !/\\\]\s*$/.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      if (i < lines.length) {
        body.push(lines[i].replace(/\\\]\s*$/, ''))
        i++
      }
      blocks.push({ t: 'math', text: body.join('\n').trim() })
      continue
    }
    // \begin{equation|align|...} 多行环境 → 块级
    {
      const bm = beginEnvLineRe.exec(line)
      if (bm && BLOCK_MATH_ENVS.test(bm[1])) {
        const env = bm[1]
        const collected: string[] = [line]
        i++
        const closeRe = new RegExp(`\\\\end\\{${env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`)
        let depth = 1
        while (i < lines.length && depth > 0) {
          const L = lines[i]
          collected.push(L)
          if (new RegExp(`\\\\begin\\{${env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`).test(L)) depth++
          if (closeRe.test(L)) depth--
          i++
          if (depth === 0) break
        }
        blocks.push({ t: 'math', text: collected.join('\n').trim() })
        continue
      }
    }
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      blocks.push({ t: 'hr' })
      i++
      continue
    }
    if (isTableStart(lines, i)) {
      const headers = tableCells(lines[i])
      const divider = tableCells(lines[i + 1])
      const aligns = divider.map(tableAlign)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const cells = tableCells(lines[i])
        if (cells.length !== headers.length) break
        rows.push(cells)
        i++
      }
      blocks.push({ t: 'table', headers, rows, aligns })
      continue
    }
    const hm = /^(#{1,4})\s+(.+)$/.exec(line)
    if (hm) {
      blocks.push({ t: 'h', level: hm[1].length, text: hm[2].trim() })
      i++
      continue
    }
    if (/^>\s?/.test(line)) {
      const qs: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        qs.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ t: 'quote', text: qs.join('\n') })
      continue
    }
    if (unorderedItemRe.test(line)) {
      const items: string[] = []
      while (i < lines.length && unorderedItemRe.test(lines[i])) {
        items.push(lines[i].match(unorderedItemRe)![1])
        i++
      }
      blocks.push({ t: 'ul', items })
      continue
    }
    if (orderedItemRe.test(line)) {
      const items: string[] = []
      while (i < lines.length && orderedItemRe.test(lines[i])) {
        items.push(lines[i].match(orderedItemRe)![1])
        i++
      }
      blocks.push({ t: 'ol', items })
      continue
    }
    const paras: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !unorderedItemRe.test(lines[i]) &&
      !orderedItemRe.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i]) &&
      !isMathBlockStart(lines[i]) &&
      !isTableStart(lines, i)
    ) {
      paras.push(lines[i])
      i++
    }
    blocks.push({ t: 'p', text: paras.join('\n') })
  }
  return blocks
}

export function MarkdownText({
  text,
  className = '',
  colorize = false,
  colorPrefs = null,
}: {
  text: string
  className?: string
  /** 仅叙事阅读路径开启 */
  colorize?: boolean
  colorPrefs?: ColorizePrefs | null
}) {
  const blocks = useMemo(() => parseBlocks(text || ''), [text])
  const cp = colorize ? colorPrefs : null
  if (!text.trim()) return null
  return (
    <div className={`md-body ${className}`.trim()}>
      {blocks.map((b, i) => {
        if (b.t === 'h') {
          const Tag = (`h${Math.min(4, b.level)}` as 'h1' | 'h2' | 'h3' | 'h4')
          return (
            <Tag key={i} className={`md-h md-h${b.level}`}>
              {inlineMd(b.text, `h${i}`, colorize, cp)}
            </Tag>
          )
        }
        if (b.t === 'p') {
          return (
            <p key={i} className="md-p">
              {inlineMd(b.text, `p${i}`, colorize, cp)}
            </p>
          )
        }
        if (b.t === 'ul') {
          return (
            <ul key={i} className="md-ul">
              {b.items.map((it, j) => (
                <li key={j}>{inlineMd(it, `ul${i}-${j}`, colorize, cp)}</li>
              ))}
            </ul>
          )
        }
        if (b.t === 'ol') {
          return (
            <ol key={i} className="md-ol">
              {b.items.map((it, j) => (
                <li key={j}>{inlineMd(it, `ol${i}-${j}`, colorize, cp)}</li>
              ))}
            </ol>
          )
        }
        if (b.t === 'table') {
          return (
            <div key={i} className="md-table-wrap">
              <table className="md-table">
                <thead>
                  <tr>
                    {b.headers.map((cell, j) => (
                      <th key={j} style={b.aligns[j] ? { textAlign: b.aligns[j] } : undefined}>
                        {inlineMd(cell, `th${i}-${j}`, colorize, cp)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, j) => (
                        <td key={j} style={b.aligns[j] ? { textAlign: b.aligns[j] } : undefined}>
                          {inlineMd(cell, `td${i}-${r}-${j}`, colorize, cp)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (b.t === 'quote') {
          return (
            <blockquote key={i} className="md-quote">
              {inlineMd(b.text, `q${i}`, colorize, cp)}
            </blockquote>
          )
        }
        if (b.t === 'pre') {
          return (
            <pre key={i} className="md-pre">
              <code>{b.text}</code>
            </pre>
          )
        }
        if (b.t === 'math') {
          return (
            <div key={i} className="md-math-block-wrap">
              {renderKatex(b.text, true, `math${i}`)}
            </div>
          )
        }
        return <hr key={i} className="md-hr" />
      })}
    </div>
  )
}
