const SUPPORTED_SLASH_COMMANDS = new Set(['reroll', 'rewind', 'compact', 'branch', 'store', 'greeting', 'swipe'])
const SUPPORTED_EVENTS = new Set(['app_ready', 'chat_changed', 'character_selected', 'message_sent', 'message_received', 'message_updated', 'message_swiped', 'generation_started', 'generation_ended', 'variables_updated', 'chat_metadata_updated'])

export function normalizeTavernSlashCommand(command: string): { name: string; command: string } | null {
  const normalized = command.trim()
  if (!normalized) return null
  const name = normalized.replace(/^\//, '').split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  return SUPPORTED_SLASH_COMMANDS.has(name) ? { name, command: normalized } : null
}

export function filterTavernEvents(events: unknown): string[] {
  return Array.isArray(events)
    ? events.filter((event): event is string => typeof event === 'string' && SUPPORTED_EVENTS.has(event))
    : []
}
