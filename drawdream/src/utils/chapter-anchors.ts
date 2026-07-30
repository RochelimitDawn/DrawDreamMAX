import { parseRpText, type RpPart } from '../agent/rp/parse-rp'

export type ChapterAnchor = {
  messageId: string
  key: string
  title: string
  kind: 'scene' | 'chapter'
  order: number
}

function widgetTitle(p: Extract<RpPart, { kind: 'widget' }>): string | null {
  const t = (p.type || '').toLowerCase()
  if (t !== 'chapter' && t !== 'epigraph') return null
  const attrs = p.attrs || {}
  const fromAttr =
    attrs.title || attrs.name || attrs.tt || attrs.label || attrs.heading || ''
  const label = (p.label || '').trim()
  const bodyFirst = (p.body || '').trim().split(/\r?\n/).find((l) => l.trim()) || ''
  const title = String(fromAttr || label || bodyFirst).trim()
  return title || null
}

/** 从单条叙事文本提取 scene / chapter 锚点标题 */
export function extractAnchorsFromText(messageId: string, text: string, orderStart = 0): ChapterAnchor[] {
  if (!text?.trim()) return []
  let parts: RpPart[]
  try {
    parts = parseRpText(text, { streaming: false })
  } catch {
    return []
  }
  const out: ChapterAnchor[] = []
  let order = orderStart
  let idx = 0
  for (const p of parts) {
    if (p.kind === 'scene' && p.title?.trim()) {
      const title = p.title.trim()
      out.push({
        messageId,
        key: `${messageId}:scene:${idx}:${title}`,
        title,
        kind: 'scene',
        order: order++,
      })
    } else if (p.kind === 'widget') {
      const title = widgetTitle(p)
      if (title) {
        out.push({
          messageId,
          key: `${messageId}:chapter:${idx}:${title}`,
          title,
          kind: 'chapter',
          order: order++,
        })
      }
    }
    idx++
  }
  return out
}

export function extractAnchorsFromMessages(
  messages: Array<{ id: string; channel: string; text: string }>,
): ChapterAnchor[] {
  const out: ChapterAnchor[] = []
  let order = 0
  for (const m of messages) {
    if (m.channel !== 'narrative' && m.channel !== 'greeting') continue
    const chunk = extractAnchorsFromText(m.id, m.text, order)
    out.push(...chunk)
    order += chunk.length
  }
  return out
}
