import { cleanChat, parseStChat, type CleanRules, type ParsedStChat, type StChatMessage } from '../chatlog.ts'
import { normalizeCard } from '../card.ts'
import type { CharacterCard } from '../types.ts'

export type SourceSidecar = {
  source: 'sillytavern'
  raw: Record<string, unknown>
}

export type AdaptedCharacterCard = {
  card: CharacterCard
  sidecar: SourceSidecar
}

export type AdaptedChat = ParsedStChat & {
  sidecars: Array<StChatMessage['source']>
}

export function adaptCharacterCard(input: unknown): AdaptedCharacterCard {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('角色卡 JSON 不是对象')
  }
  const raw = structuredClone(input) as Record<string, unknown>
  return {
    card: normalizeCard(raw),
    sidecar: { source: 'sillytavern', raw },
  }
}

export function adaptSillyTavernChat(jsonl: string, rules?: CleanRules): AdaptedChat {
  const parsed = parseStChat(jsonl)
  const messages = cleanChat(parsed.messages, rules)
  return {
    ...parsed,
    messages,
    sidecars: messages.map((message) => (message.source ? { ...message.source, swipes: message.source.swipes ? [...message.source.swipes] : undefined } : undefined)),
  }
}

function sourceFields(message: StChatMessage): Record<string, unknown> {
  const source = message.source
  return {
    ...(source?.sendDate ? { send_date: source.sendDate } : {}),
    ...(source && 'extra' in source ? { extra: source.extra } : {}),
    ...(source && 'variables' in source ? { variables: source.variables } : {}),
    ...(source && 'metadata' in source ? { metadata: source.metadata } : {}),
    ...(source?.swipes ? { swipes: [...source.swipes] } : {}),
    ...(source?.swipeId != null ? { swipe_id: source.swipeId } : {}),
  }
}

export function exportSillyTavernChat(chat: AdaptedChat): string {
  const header = {
    user_name: chat.meta.userName,
    character_name: chat.meta.charName,
    ...(chat.meta.createDate ? { create_date: chat.meta.createDate } : {}),
  }
  const lines = [JSON.stringify(header)]
  for (const message of chat.messages) {
    lines.push(JSON.stringify({
      name: message.name,
      is_user: message.role === 'user',
      is_system: false,
      mes: message.text,
      ...sourceFields(message),
    }))
  }
  return `${lines.join('\n')}\n`
}
