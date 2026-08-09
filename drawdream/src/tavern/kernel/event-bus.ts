import type { JsonValue, TavernEvent, TavernEventHandler, TavernEventType } from './types.ts'

type HandlerSet = Set<TavernEventHandler>

export class TavernEventBus {
  private readonly handlers = new Map<TavernEventType, HandlerSet>()
  private sequence = 0
  private sessionRevision = 0

  get revision(): number {
    return this.sessionRevision
  }

  on<T extends JsonValue>(type: TavernEventType, handler: TavernEventHandler<T>): () => void {
    const handlers = this.handlers.get(type) ?? new Set<TavernEventHandler>()
    handlers.add(handler as TavernEventHandler)
    this.handlers.set(type, handlers)
    return () => this.off(type, handler)
  }

  once<T extends JsonValue>(type: TavernEventType, handler: TavernEventHandler<T>): () => void {
    const unsubscribe = this.on(type, async (event) => {
      unsubscribe()
      await handler(event as TavernEvent<T>)
    })
    return unsubscribe
  }

  off<T extends JsonValue>(type: TavernEventType, handler: TavernEventHandler<T>): void {
    const handlers = this.handlers.get(type)
    handlers?.delete(handler as TavernEventHandler)
    if (handlers?.size === 0) this.handlers.delete(type)
  }

  async emit<T extends JsonValue>(type: TavernEventType, payload: T, revision?: number): Promise<TavernEvent<T>> {
    this.sessionRevision = revision ?? this.sessionRevision + 1
    const event: TavernEvent<T> = {
      sequence: ++this.sequence,
      sessionRevision: this.sessionRevision,
      type,
      payload,
    }
    const handlers = [...(this.handlers.get(type) ?? [])]
    await Promise.all(handlers.map((handler) => handler(event)))
    return event
  }

  reset(sequence = 0, revision = 0): void {
    this.sequence = sequence
    this.sessionRevision = revision
  }
}
