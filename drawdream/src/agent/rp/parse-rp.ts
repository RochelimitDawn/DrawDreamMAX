/**
 * RP 双方言解析：ST-XML + 白名单方括号 → 统一 AST
 * - 仅识别已知 RP 标签与酒馆 widget，避免正文 [word] / 中文 [角色名] 误伤
 * - 未知标签 unwrap 内容，不吞字
 */

import { closeTagFamily, resolveTag, type RpBucket } from './tag-catalog.ts'
import { isStRpWidget, widgetFamily, widgetLabel } from './rp-widgets.ts'

export type RpPart =
  | { kind: 'text'; text: string }
  | { kind: 'scene'; title?: string; ambience?: string; body: string }
  | { kind: 'char'; name: string; role?: string }
  | { kind: 'voice'; mode: 'inner' | 'aside'; body: string }
  | { kind: 'status'; variant: string; label: string; body: string }
  | { kind: 'scaffold'; label: string; body: string }
  | { kind: 'choice'; question: string; options: string[] }
  | { kind: 'widget'; type: string; family: string; label: string; attrs: Record<string, string>; body: string }

function attrsFromXml(openTag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(openTag)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return attrs
}

/** 清理模型乱写的 options 尾巴：多余 】 ] > / 闭合标签碎片 */
function cleanChoiceBlob(raw: string): string {
  return raw
    // 完整或残缺闭合/开标签
    .replace(/<\/?(?:ask_director|choice|choices)\b[^>]*>?/gi, '')
    .replace(/[\]>'"]+$/g, '')
    // 选项说明末尾多写的 】（标题用【x】已切开，desc 不应以 】 结尾）
    .replace(/】+$/g, '')
    .trim()
}

/**
 * 从 ask_director / choice 开标签片段抽取属性。
 * 兼容：缺 `>`、options 引号未闭合、尾部 `】]>` / `】】` 垃圾。
 */
export function extractChoiceTagAttrs(fragment: string): Record<string, string> {
  const src = fragment.replace(/^</, '').replace(/>$/, '').trim()
  const attrs = attrsFromXml(src)

  // options="… 未闭合引号：从 options= 截到片段末尾
  if (!attrs.options && !attrs.opts && !attrs.choices) {
    const om =
      src.match(/options\s*=\s*"([\s\S]*)$/i) ||
      src.match(/options\s*=\s*'([\s\S]*)$/i) ||
      src.match(/opts\s*=\s*"([\s\S]*)$/i) ||
      src.match(/choices\s*=\s*"([\s\S]*)$/i)
    if (om) attrs.options = om[1]
  }
  if (!attrs.question && !attrs.q) {
    const qm =
      src.match(/question\s*=\s*"([^"]*)/i) ||
      src.match(/question\s*=\s*'([^']*)/i) ||
      src.match(/q\s*=\s*"([^"]*)/i)
    if (qm) attrs.question = qm[1]
  }

  for (const k of ['options', 'opts', 'choices', 'question', 'q'] as const) {
    if (attrs[k]) attrs[k] = cleanChoiceBlob(attrs[k])
  }
  return attrs
}

/**
 * 「短标题——说明。短标题——说明」粘连串：按「句首/句号后 + 短词 + 破折号」切开。
 * 会话实录常见：直陈——…。隐锋——…。借势——…（无【】也无 |）
 */
function splitDashLabelOptions(t: string): string[] {
  const re = /([^\s。；;：:，,「」『』""''“”‘’（）()]{1,12})([—–-]{1,2})/g
  const anchors: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) {
    const idx = m.index
    if (idx === 0 || /[。；;\s]/.test(t[idx - 1]!)) anchors.push(idx)
  }
  if (anchors.length < 2) return []
  const opts: string[] = []
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i]!
    const end = i + 1 < anchors.length ? anchors[i + 1]! : t.length
    const slice = t
      .slice(start, end)
      .replace(/^[。；;\s]+/, '')
      .replace(/[。；;\s]+$/, '')
      .trim()
    if (slice) opts.push(slice)
  }
  return opts.slice(0, 8)
}

/** 把 options 属性拆成选项列表（兼容 JSON / | / 【标题】 / 标题—— 粘连） */
export function splitChoiceOptions(raw: string): string[] {
  const t = cleanChoiceBlob(raw)
  if (!t) return []
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t) as unknown
      if (Array.isArray(arr)) {
        return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 8)
      }
    } catch {
      /* fall through */
    }
  }
  if (t.includes('|') && !/【/.test(t)) {
    return t
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8)
  }
  // 【世外散修】说明…【朝歌客卿】说明…  或末尾多写的 】
  const bracket = [...t.matchAll(/【([^】]+)】([^【]*)/g)]
  if (bracket.length >= 1) {
    const opts = bracket
      .map((m) => {
        const title = m[1].trim()
        const desc = cleanChoiceBlob(m[2] || '')
        return desc ? `【${title}】${desc}` : `【${title}】`
      })
      .filter((s) => s !== '【】')
      .slice(0, 8)
    if (opts.length >= 1) return opts
  }
  // 直陈——…。隐锋——…（无【】时整段会合成 1 个选项，必须切开）
  const dashOpts = splitDashLabelOptions(t)
  if (dashOpts.length >= 2) return dashOpts
  // A. … B. … / 1. … 2. …
  const lettered = [...t.matchAll(/(?:^|[\s。；;])([A-Da-d])[.、．]\s*([\s\S]*?)(?=(?:[\s。；;][A-Da-d][.、．]\s*)|$)/g)]
  if (lettered.length >= 2) {
    return lettered
      .map((m) => `${m[1].toUpperCase()}. ${cleanChoiceBlob(m[2] || '')}`.trim())
      .filter(Boolean)
  }
  if (/[;；]/.test(t)) {
    return t
      .split(/[;；]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return t ? [t] : []
}

/** 从纯文本抽出 A/B/C 或【标题】式选项（模型常不调工具直接写列表） */
export function extractFreeformChoice(text: string): {
  head: string
  question: string
  options: string[]
} | null {
  if (!text) return null
  const t = text.replace(/\r\n/g, '\n')

  // 【甲】…【乙】… 至少两项
  const brackets = [...t.matchAll(/【([^】]+)】([^【]*)/g)]
  if (brackets.length >= 2) {
    const firstIdx = brackets[0].index ?? 0
    const head = t.slice(0, firstIdx).trimEnd()
    const options = brackets
      .map((m) => {
        const title = m[1].trim()
        const desc = cleanChoiceBlob(m[2] || '')
        return desc ? `【${title}】${desc}` : `【${title}】`
      })
      .filter((s) => s !== '【】')
    if (options.length >= 2) {
      const qLine =
        head
          .split(/\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(-1)[0] || '请选择'
      return { head, question: qLine, options }
    }
  }

  // 行首 A. / A、 / 1. / 选项A —— 理论无上限
  const lineRe = /^(?:选项\s*)?([A-Za-z]|[1-9]\d*)[.、．)\]]\s*(.+)$/
  const lines = t.split('\n')
  const hits: { i: number; opt: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(lineRe)
    if (!m) continue
    const label = /[A-Za-z]/.test(m[1]) ? m[1].toUpperCase() : m[1]
    const body = cleanChoiceBlob(m[2] || '')
    if (!body) continue
    hits.push({ i, opt: `${label}. ${body}` })
  }
  if (hits.length >= 2) {
    // 要求字母/序号大体连续，避免误伤叙事里的 “A. 某句”
    const labels = hits.map((h) => h.opt.match(/^([A-Z]+|\d+)/)?.[1] || '')
    const ordered =
      labels.every((ch, idx) => {
        if (idx === 0) return true
        const prev = labels[idx - 1]
        if (/^\d+$/.test(ch) && /^\d+$/.test(prev)) return Number(ch) === Number(prev) + 1
        if (/^[A-Z]$/.test(ch) && /^[A-Z]$/.test(prev)) return ch.charCodeAt(0) === prev.charCodeAt(0) + 1
        return true
      }) || hits.length >= 3
    if (!ordered && hits.length < 3) return null
    const start = hits[0].i
    const end = hits[hits.length - 1].i
    const head = lines.slice(0, start).join('\n').trimEnd()
    const qLine =
      head
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-1)[0] || '请选择'
    const tail = lines.slice(end + 1).join('\n').trim()
    // 选项后还有大段正文时不抽（可能是叙事中的编号句）
    if (tail.length > 80 && !/^请|^选/.test(tail)) return null
    return {
      head,
      question: qLine,
      options: hits.map((h) => h.opt),
    }
  }
  return null
}

/** 气泡文本是否像含有正文抉择（用于「最新可点」判定） */
export function textLooksLikeChoice(text: string): boolean {
  if (!text) return false
  if (
    /<ask_director\b/i.test(text) ||
    /<\/?ask_director\b/i.test(text) ||
    /<(?:choice|choices)\b/i.test(text) ||
    (/【[^】]+】/.test(text) && /options\s*=/i.test(text))
  ) {
    return true
  }
  return extractFreeformChoice(text) != null
}

function firstChoiceQuestion(body: string): string {
  const line = body
    .split(/\n/)
    .map((l) => l.trim())
    .find(Boolean)
  return line || ''
}

function parseWidgetAttrs(raw: string): { type: string; attrs: Record<string, string>; inline: string } {
  const trimmed = raw.trim()
  const sp = trimmed.search(/\s/)
  const type = (sp < 0 ? trimmed : trimmed.slice(0, sp)).toLowerCase()
  const rest = sp < 0 ? '' : trimmed.slice(sp + 1).trim()
  const attrs: Record<string, string> = {}
  let inline = ''
  const tokenRe = /([a-zA-Z_][\w-]*)(?::(?:"([^"]*)"|'([^']*)'|(\S+)))?/g
  let last = 0
  let m: RegExpExecArray | null
  const hits: Array<{ start: number; end: number }> = []
  while ((m = tokenRe.exec(rest)) !== null) {
    const key = m[1].toLowerCase()
    const val = m[2] ?? m[3] ?? m[4]
    if (val !== undefined) {
      attrs[key] = val
      hits.push({ start: m.index, end: m.index + m[0].length })
      last = m.index + m[0].length
    } else if (/^(stripe|dis|ro|req|chk|multi|auto|plain|round|closable|bordered|open|pill|dot)$/i.test(key)) {
      attrs[key] = 'true'
      hits.push({ start: m.index, end: m.index + m[0].length })
      last = m.index + m[0].length
    } else {
      break
    }
  }
  if (hits.length && last < rest.length) {
    inline = rest.slice(last).trim()
  } else if (!hits.length) {
    inline = rest
  }
  return { type, attrs, inline }
}

function makeCloseRe(tag: string): RegExp {
  const fam = closeTagFamily(tag)
  const alt = fam.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return new RegExp(`</(?:${alt})\\s*>`, 'i')
}

function bucketToPart(
  bucket: RpBucket,
  tag: string,
  body: string,
  attrs: Record<string, string>,
  label: string,
): RpPart | RpPart[] | null {
  const b = body.replace(/^\uFEFF/, '').trim()
  switch (bucket) {
    case 'unwrap':
    case 'story':
      return b ? { kind: 'text', text: b } : null
    case 'hide':
      return null
    case 'scene': {
      const title = attrs.title || attrs.tt || attrs.name || attrs.n || ''
      const ambience = attrs.ambience || attrs.mood || attrs.v || ''
      return { kind: 'scene', title: title || undefined, ambience: ambience || undefined, body: b }
    }
    case 'char': {
      const name = (attrs.name || attrs.n || attrs.tt || b || tag).trim()
      if (!name) return null
      return { kind: 'char', name, role: attrs.role || attrs.r || undefined }
    }
    case 'voice': {
      const mode = /aside|whisper|旁白/i.test(tag) ? 'aside' : 'inner'
      return b ? { kind: 'voice', mode, body: b } : null
    }
    case 'status':
      return b ? { kind: 'status', variant: tag, label, body: b } : null
    case 'widget': {
      const t = tag.toLowerCase()
      return {
        kind: 'widget',
        type: t,
        family: widgetFamily(t),
        label: label || widgetLabel(t),
        attrs,
        body: b,
      }
    }
    case 'scaffold':
      return b ? { kind: 'scaffold', label, body: b } : null
    case 'choice': {
      if (/^opt/i.test(tag) || tag === '选项') {
        return b ? { kind: 'text', text: b } : null
      }
      const fromXmlOpts = [
        ...b.matchAll(/<opt(?:ion)?[^>]*>([\s\S]*?)<\/opt(?:ion)?>/gi),
        ...b.matchAll(/【选项\s*[A-Da-d1-4]】\s*([^\n【]+)/g),
      ].map((x) => x[1].trim())
      const q = attrs.q || attrs.question || attrs.tt || attrs.title || attrs.prompt || ''
      // options= 可能是 JSON 数组、| 分隔、或「【甲】…【乙】…」粘连串
      const fromAttr = splitChoiceOptions(attrs.options || attrs.opts || attrs.choices || '')
      const bodyQ = (q || firstChoiceQuestion(b) || '请选择').trim()
      const fromLines = b
        .split(/\n/)
        .map((l) => l.replace(/^[-*•\d.、)）]+\s*/, '').trim())
        .filter((l) => l && l !== bodyQ && !/^请选择/.test(l))
      const options = (fromAttr.length ? fromAttr : fromXmlOpts.length ? fromXmlOpts : fromLines)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8)
      return {
        kind: 'choice',
        question: bodyQ,
        options,
      }
    }
    default:
      return b ? { kind: 'text', text: b } : null
  }
}

function pushPart(out: RpPart[], p: RpPart | RpPart[] | null) {
  if (!p) return
  if (Array.isArray(p)) {
    for (const x of p) pushPart(out, x)
    return
  }
  if (p.kind === 'text') {
    const prev = out[out.length - 1]
    if (prev?.kind === 'text') {
      prev.text += p.text
      return
    }
  }
  out.push(p)
}

/** 只剥离已知 RP 的 XML 标签与「闭合」方括号；正文里故意保留的 [word] 不删 */
function stripOrphanKnownTags(text: string): string {
  return text
    .replace(/<\/?[A-Za-z][\w:-]*(?:\s[^>]*)?\/?>/g, (tag) => {
      const name = tag.replace(/^<\/?/, '').replace(/\/?>$/, '').split(/[\s>]/)[0] || ''
      return resolveTag(name) ? '' : tag
    })
    .replace(/\[\/\s*[a-zA-Z][\w-]*\s*\]/g, (tag) => {
      const type = tag.replace(/^\[\/\s*/, '').replace(/\]$/, '').trim().toLowerCase()
      if (resolveTag(type) || isStRpWidget(type)) return ''
      return tag
    })
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
}

export function parseRpText(
  input: string,
  opts?: { streaming?: boolean; inferFreeformChoice?: boolean },
): RpPart[] {
  if (!input) return []
  let text = input.replace(/\r\n/g, '\n')

  if (opts?.streaming) {
    const hold = incompleteTail(text)
    if (hold >= 0 && hold < text.length) {
      const stable = text.slice(0, hold)
      const parts = parseRpTextCore(stable)
      return finalizeParts(parts, opts?.inferFreeformChoice !== false)
    }
    if (hold < 0 && looksIncompleteOpen(text)) {
      return finalizeParts([{ kind: 'text', text }], opts?.inferFreeformChoice !== false)
    }
  }

  return finalizeParts(parseRpTextCore(text), opts?.inferFreeformChoice !== false)
}

function incompleteTail(text: string): number {
  let lastOpen = -1
  const xmlOpen = [...text.matchAll(/<([A-Za-z][\w:-]*)(?:\s[^>]*)?>/g)]
  for (const m of xmlOpen) {
    const tag = m[1]
    if (tag.startsWith('/')) continue
    if (!resolveTag(tag)) continue
    const after = text.slice((m.index ?? 0) + m[0].length)
    const closeRe = makeCloseRe(tag)
    if (!closeRe.test(after) && !m[0].endsWith('/>')) {
      lastOpen = m.index ?? 0
    }
  }
  const tkOpen = [...text.matchAll(/\[([a-zA-Z][\w-]*)([^\]]*)\]/g)]
  for (const m of tkOpen) {
    const type = m[1]
    if (type.startsWith('/')) continue
    const def = resolveTag(type)
    if (!def && !isStRpWidget(type)) continue
    const after = text.slice((m.index ?? 0) + m[0].length)
    const closeTok = new RegExp(`\\[\\/\\s*${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]`, 'i')
    if (!closeTok.test(after)) {
      if (def?.bucket === 'char' && !after.trimStart().startsWith('[')) continue
      if (
        def &&
        ['scene', 'voice', 'status', 'choice', 'scaffold', 'unwrap', 'story', 'widget'].includes(
          def.bucket,
        )
      ) {
        lastOpen = Math.max(lastOpen, m.index ?? 0)
      } else if (isStRpWidget(type)) {
        lastOpen = Math.max(lastOpen, m.index ?? 0)
      }
    }
  }
  if (lastOpen < 0) {
    const lt = text.lastIndexOf('<')
    if (lt >= 0 && text.indexOf('>', lt) < 0) lastOpen = lt
    const lb = text.lastIndexOf('[')
    if (lb >= 0 && text.indexOf(']', lb) < 0) lastOpen = Math.max(lastOpen, lb)
  }
  return lastOpen
}

function looksIncompleteOpen(text: string): boolean {
  const lt = text.lastIndexOf('<')
  if (lt >= 0 && text.indexOf('>', lt) < 0) return true
  const lb = text.lastIndexOf('[')
  if (lb >= 0 && text.indexOf(']', lb) < 0) return true
  return false
}

function finalizeParts(out: RpPart[], inferFreeformChoice = true): RpPart[] {
  const cleaned = out
    .map((p) => {
      if (p.kind === 'text') {
        const t = stripOrphanKnownTags(p.text)
        return t ? ({ kind: 'text', text: t } as RpPart) : null
      }
      return p
    })
    .filter((p): p is RpPart => p != null && !(p.kind === 'text' && !p.text.trim()))

  // 已有正式 choice 标签则不二次抽取
  if (!inferFreeformChoice || cleaned.some((p) => p.kind === 'choice')) return cleaned

  // 仅在「尾部是纯文本块」时抽 A/B/C / 【】 自由列表
  let lastTextIdx = -1
  for (let i = cleaned.length - 1; i >= 0; i--) {
    if (cleaned[i].kind === 'text') {
      lastTextIdx = i
      break
    }
  }
  if (lastTextIdx < 0) return cleaned
  const last = cleaned[lastTextIdx] as Extract<RpPart, { kind: 'text' }>
  const free = extractFreeformChoice(last.text)
  if (!free) return cleaned

  const next = cleaned.slice()
  const parts: RpPart[] = []
  if (free.head.trim()) parts.push({ kind: 'text', text: free.head })
  parts.push({ kind: 'choice', question: free.question, options: free.options })
  next.splice(lastTextIdx, 1, ...parts)
  return next.filter((p) => !(p.kind === 'text' && !p.text.trim()))
}

/** 方括号开标签：必须是英文标识符开头，排除 [林晚] 等中文 */
function isBracketTagOpen(inner: string): boolean {
  return /^[a-zA-Z][\w-]*(\s|$|:)/.test(inner.trim()) || /^[a-zA-Z][\w-]*$/.test(inner.trim())
}

function parseRpTextCore(text: string): RpPart[] {
  const out: RpPart[] = []
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (ch === '[') {
      const closeBracket = text.indexOf(']', i + 1)
      if (closeBracket < 0) {
        pushPart(out, { kind: 'text', text: text.slice(i) })
        break
      }
      const inner = text.slice(i + 1, closeBracket)
      if (inner.startsWith('/')) {
        // 孤立闭合标签：丢弃标签本身
        const closeType = inner.slice(1).trim().split(/\s+/)[0] || ''
        if (resolveTag(closeType) || isStRpWidget(closeType)) {
          i = closeBracket + 1
          continue
        }
        pushPart(out, { kind: 'text', text: text.slice(i, closeBracket + 1) })
        i = closeBracket + 1
        continue
      }
      // 非标准标签（中文名、纯数字等）原样当文本
      if (!isBracketTagOpen(inner)) {
        pushPart(out, { kind: 'text', text: text.slice(i, closeBracket + 1) })
        i = closeBracket + 1
        continue
      }

      const { type, attrs, inline } = parseWidgetAttrs(inner)
      const def = resolveTag(type)
      const closeTok = new RegExp(`\\[\\/\\s*${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]`, 'i')
      const rest = text.slice(closeBracket + 1)
      const cm = closeTok.exec(rest)

      // 已知 RP 容器
      if (
        cm &&
        def &&
        (def.bucket === 'scene' ||
          def.bucket === 'voice' ||
          def.bucket === 'status' ||
          def.bucket === 'choice' ||
          def.bucket === 'scaffold' ||
          def.bucket === 'unwrap' ||
          def.bucket === 'story' ||
          def.bucket === 'widget')
      ) {
        const body = rest.slice(0, cm.index)
        const merged = inline ? `${inline}\n${body}` : body
        pushPart(out, bucketToPart(def.bucket, type, merged, attrs, def.label))
        i = closeBracket + 1 + cm.index + cm[0].length
        continue
      }

      if (def?.bucket === 'char') {
        const name = attrs.n || attrs.name || attrs.tt || inline || type
        pushPart(out, { kind: 'char', name: name.trim(), role: attrs.role })
        i = closeBracket + 1
        continue
      }

      if (def && (def.bucket === 'scene' || def.bucket === 'voice') && inline) {
        pushPart(out, bucketToPart(def.bucket, type, inline, attrs, def.label))
        i = closeBracket + 1
        continue
      }

      // 酒馆 widget（原生卡片）
      if (isStRpWidget(type) && cm) {
        const body = rest.slice(0, cm.index)
        const merged = inline ? `${inline}\n${body}` : body
        pushPart(
          out,
          bucketToPart('widget', type, merged, attrs, widgetLabel(type)),
        )
        i = closeBracket + 1 + cm.index + cm[0].length
        continue
      }
      if (isStRpWidget(type) && (inline || Object.keys(attrs).length)) {
        pushPart(
          out,
          bucketToPart('widget', type, inline || '', attrs, widgetLabel(type)),
        )
        i = closeBracket + 1
        continue
      }

      // 未知方括号类型：保留正文，丢掉标签壳

      // 未知 [type]...[/type]：保留正文，丢掉标签壳
      if (cm) {
        const body = rest.slice(0, cm.index)
        const keep = [inline, body].filter(Boolean).join('\n')
        if (keep) pushPart(out, { kind: 'text', text: keep })
        i = closeBracket + 1 + cm.index + cm[0].length
        continue
      }

      // 未知自闭合 [type] 或 [type attrs]：有 inline 则当文本，否则整段当文本
      if (inline) {
        pushPart(out, { kind: 'text', text: inline })
        i = closeBracket + 1
        continue
      }
      // 单独 [word] 且无属性：保留原样文本（含括号），避免吞字
      pushPart(out, { kind: 'text', text: text.slice(i, closeBracket + 1) })
      i = closeBracket + 1
      continue
    }

    if (ch === '<') {
      // choice 族：options="…" 内常含畸形尾；整段吞到 </ask_director> 或文末
      const choiceOpen = text.slice(i).match(/^<(ask_director|choice|choices)\b/i)
      if (choiceOpen) {
        const tagName = choiceOpen[1]
        const defChoice = resolveTag(tagName)
        if (defChoice?.bucket === 'choice') {
          const restAll = text.slice(i)
          const closeRe = new RegExp(`</${tagName}\\s*>`, 'i')
          const closeM = closeRe.exec(restAll)
          const chunk = closeM ? restAll.slice(0, closeM.index + closeM[0].length) : restAll
          const attrs = extractChoiceTagAttrs(chunk)
          pushPart(out, bucketToPart(defChoice.bucket, tagName, '', attrs, defChoice.label))
          i = i + chunk.length
          continue
        }
      }

      const gt = text.indexOf('>', i + 1)
      if (gt < 0) {
        // 未写完的开标签：尝试识别 ask_director / choice 等（模型常漏写 >）
        const partial = text.slice(i + 1)
        const tagName = (partial.match(/^([A-Za-z][\w:-]*)/) || [])[1] || ''
        const defPartial = tagName ? resolveTag(tagName) : null
        if (
          defPartial?.bucket === 'choice' &&
          /(?:question|q|options|opts|choices)\s*=/i.test(partial)
        ) {
          const attrs = extractChoiceTagAttrs(partial.replace(/\s*\/?\s*$/, ''))
          pushPart(out, bucketToPart(defPartial.bucket, tagName, '', attrs, defPartial.label))
          break
        }
        pushPart(out, { kind: 'text', text: text.slice(i) })
        break
      }
      const raw = text.slice(i + 1, gt)
      if (raw.startsWith('!--')) {
        const endC = text.indexOf('-->', i)
        i = endC >= 0 ? endC + 3 : text.length
        continue
      }
      if (raw.startsWith('/')) {
        const closeName = raw.slice(1).trim().split(/\s+/)[0] || ''
        if (resolveTag(closeName)) {
          i = gt + 1
          continue
        }
        // 未知闭合标签保留为文本（少见）
        pushPart(out, { kind: 'text', text: text.slice(i, gt + 1) })
        i = gt + 1
        continue
      }
      const selfClose = raw.endsWith('/')
      const openInner = selfClose ? raw.slice(0, -1).trim() : raw.trim()
      const tagName = openInner.split(/\s+/)[0] || ''
      const def = resolveTag(tagName)
      // choice 族用增强抽取（畸形 options 引号 / 尾部垃圾）
      const attrs =
        def?.bucket === 'choice' ? extractChoiceTagAttrs(openInner) : attrsFromXml(openInner)

      // 未知 XML：整段当文本，避免把 HTML 比较符之类误伤；若像标签则只 unwrap 内容
      if (!def) {
        if (selfClose) {
          pushPart(out, { kind: 'text', text: text.slice(i, gt + 1) })
          i = gt + 1
          continue
        }
        const closeRe = new RegExp(`</${tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*>`, 'i')
        const rest = text.slice(gt + 1)
        const cm = closeRe.exec(rest)
        if (cm) {
          const body = rest.slice(0, cm.index)
          if (body) pushPart(out, { kind: 'text', text: body })
          i = gt + 1 + cm.index + cm[0].length
        } else {
          // 未闭合未知标签：保留开标签原文，继续
          pushPart(out, { kind: 'text', text: text.slice(i, gt + 1) })
          i = gt + 1
        }
        continue
      }

      if (selfClose) {
        if (def.bucket === 'char') {
          const name = attrs.name || attrs.n || tagName
          pushPart(out, { kind: 'char', name })
        } else if (def.bucket === 'choice') {
          // <ask_director question="…" options="…"/> 或未正确闭合的伪自闭合
          pushPart(out, bucketToPart(def.bucket, tagName, '', attrs, def.label))
        } else if (def.bucket === 'scene') {
          const title = attrs.title || attrs.tt || attrs.name || attrs.n || ''
          if (title) pushPart(out, { kind: 'scene', title, body: '' })
        }
        i = gt + 1
        continue
      }

      // 决策标签：属性已带 question/options 时，即使未闭合也当选择卡（模型常写成裸开标签）
      if (
        def.bucket === 'choice' &&
        (attrs.question || attrs.q || attrs.options || attrs.opts || attrs.choices)
      ) {
        const closeReChoice = makeCloseRe(tagName)
        const restChoice = text.slice(gt + 1)
        const cmChoice = closeReChoice.exec(restChoice)
        const bodyChoice = cmChoice ? restChoice.slice(0, cmChoice.index) : ''
        const nextChoice = cmChoice
          ? gt + 1 + cmChoice.index + cmChoice[0].length
          : gt + 1
        pushPart(out, bucketToPart(def.bucket, tagName, bodyChoice, attrs, def.label))
        i = nextChoice
        continue
      }

      const closeRe = makeCloseRe(tagName)
      const rest = text.slice(gt + 1)
      const cm = closeRe.exec(rest)
      let body: string
      let next: number
      if (cm) {
        body = rest.slice(0, cm.index)
        next = gt + 1 + cm.index + cm[0].length
      } else if (def.bucket === 'scene' && (attrs.title || attrs.tt || attrs.name)) {
        // 未闭合 scene 但有 title：只出标题卡，正文留给后续文本（避免吞掉 StatusBlock）
        pushPart(out, {
          kind: 'scene',
          title: attrs.title || attrs.tt || attrs.name || attrs.n || undefined,
          ambience: attrs.ambience || attrs.mood || undefined,
          body: '',
        })
        i = gt + 1
        continue
      } else {
        // 未闭合已知标签：流式外不当吞全文，开标签后正文当文本
        body = rest
        next = text.length
      }

      pushPart(out, bucketToPart(def.bucket, tagName, body, attrs, def.label))
      i = next
      continue
    }

    let j = i + 1
    while (j < text.length && text[j] !== '<' && text[j] !== '[') j++
    const chunk = text.slice(i, j)
    if (chunk) pushPart(out, { kind: 'text', text: chunk })
    i = j
  }

  return out
}
