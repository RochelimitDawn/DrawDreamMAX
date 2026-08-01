export type StatusPart =
  | { kind: 'text'; text: string }
  | { kind: 'status'; tag: string; body: string }

export function statusLabel(tag: string): string {
  return /status/i.test(tag) ? '状态' : tag
}

export function splitStatusParts(text: string): StatusPart[] {
  const parts: StatusPart[] = []
  const pattern = /<([A-Za-z][\w-]*)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const before = text.slice(cursor, match.index).trim()
    if (before) parts.push({ kind: 'text', text: stripOrphanStatusTags(before) })
    const tag = match[1] ?? ''
    if (/^(?:statusblock|status_block|status|normal_status|special_status)$/i.test(tag)) {
      parts.push({ kind: 'status', tag, body: match[2]?.trim() ?? '' })
    } else {
      parts.push({ kind: 'text', text: match[0] ?? '' })
    }
    cursor = match.index + match[0].length
  }
  const tail = stripOrphanStatusTags(text.slice(cursor)).trim()
  if (tail) parts.push({ kind: 'text', text: tail })
  return parts.length ? parts : [{ kind: 'text', text: stripOrphanStatusTags(text).trim() }]
}

export function stripOrphanStatusTags(text: string): string {
  return text
    .replace(/<\/?(?:StatusBlock|status_block|status|normal_status|special_status)\b[^>]*>/gi, '')
    .trim()
}

export function looksLikeYamlBlock(text: string): boolean {
  return /^\s*```ya?ml\s*[\r\n]+[\s\S]*?```\s*$/i.test(text)
}

export function stripYamlFence(text: string): string {
  return text.replace(/^\s*```ya?ml\s*[\r\n]+/i, '').replace(/\s*```\s*$/i, '').trim()
}
