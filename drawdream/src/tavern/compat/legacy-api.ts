import { unavailableRuntimeCapability } from './errors.ts'

export type ExtensionRuntimeRequest = {
  type: string
  payload?: unknown
}

export type LegacyApiHost = {
  request: (request: ExtensionRuntimeRequest) => Promise<unknown> | unknown
}

export function createLegacyApiFacade(host: LegacyApiHost) {
  const request = (type: string, payload?: unknown) => host.request({ type, payload })
  return {
    SillyTavern: {
      getContext: () => request('context.get'),
      eventSource: {
        subscribe: (events: string[]) => request('event.subscribe', { events }),
        on: (event: string, handler: (payload: unknown) => void) => {
          void request('event.subscribe', { events: [event] })
          return handler
        },
      },
    },
    TavernHelper: {
      getVariables: (options?: { scope?: string; messageId?: string }) => request('variables.get', options || {}),
      updateVariables: (transaction: unknown) => request('variables.patch', transaction),
      replaceVariables: (transaction: unknown) => request('variables.patch', transaction),
      registerVariableSchema: (schema: unknown) => request('variables.schema', { schema }),
      getChatMessages: () => request('message.snapshot'),
      createChatMessages: (messages: unknown) => request('message.create', { messages }),
      setChatMessages: (messages: unknown) => request('message.update', { messages }),
      deleteChatMessages: (ids: unknown) => request('message.update', { deleteIds: ids }),
      triggerSlash: (command: string) => request('slash.execute', { command }),
      generate: (text: string, options?: Record<string, unknown>) => request('generate', { text, ...(options || {}) }),
      getWorldBooks: () => request('worldbook.list'),
      getWorldBook: (path: string) => request('worldbook.get', { path }),
      selectWorldBooks: (paths: string[]) => request('worldbook.select', { paths }),
      putWorldBookEntry: (entry: Record<string, unknown>) => request('worldbook.entry.put', entry),
      getPresets: () => request('preset.list'),
      getActivePreset: () => request('preset.get'),
      selectPreset: (file: string | null) => request('preset.select', { file }),
      getCharacter: () => request('character.get'),
      injectPrompt: (text: string, options?: Record<string, unknown>) => request('inject.prompt', { text, ...(options || {}) }),
      speak: (text: string, options?: Record<string, unknown>) => request('audio.speak', { text, ...(options || {}) }),
    },
    unsupported: (method: string, alternative?: string): never => {
      throw unavailableRuntimeCapability(method, alternative)
    },
  }
}
