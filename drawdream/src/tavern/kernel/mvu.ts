import type { JsonObject, JsonValue, MvuSchema, MvuStore, VariableCommit, VariableOperation, VariableTransaction } from './types.ts'
import { VariableConflictError } from './types.ts'

const pathParts = (path: string): string[] => {
  const parts = path.split('.').map((part) => part.trim())
  if (!path || parts.some((part) => !part || part === '__proto__' || part === 'prototype' || part === 'constructor')) {
    throw new Error(`Invalid MVU path: ${path}`)
  }
  return parts
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function parentOf(root: JsonObject, path: string, create: boolean): { parent: JsonObject; key: string } {
  const parts = pathParts(path)
  let parent = root
  for (const part of parts.slice(0, -1)) {
    const current = parent[part]
    if (current === undefined) {
      if (!create) return { parent, key: parts.at(-1)! }
      parent[part] = {}
    }
    if (!parent[part] || typeof parent[part] !== 'object' || Array.isArray(parent[part])) throw new Error(`MVU path is not an object: ${path}`)
    parent = parent[part] as JsonObject
  }
  return { parent, key: parts.at(-1)! }
}

function applyOperation(root: JsonObject, operation: VariableOperation): void {
  const { parent, key } = parentOf(root, operation.path, operation.op !== 'delete')
  if (operation.op === 'delete') {
    delete parent[key]
  } else if (operation.op === 'set') {
    parent[key] = clone(operation.value)
  } else if (operation.op === 'merge') {
    const existing = parent[key]
    if (existing !== undefined && (typeof existing !== 'object' || Array.isArray(existing))) throw new Error(`MVU merge target is not an object: ${operation.path}`)
    parent[key] = { ...(existing as JsonObject | undefined), ...clone(operation.value) }
  } else if (operation.op === 'add') {
    const value = parent[key] ?? 0
    if (typeof value !== 'number') throw new Error(`MVU add target is not numeric: ${operation.path}`)
    parent[key] = value + operation.value
  } else {
    const value = parent[key]
    if (value !== undefined && !Array.isArray(value)) throw new Error(`MVU append target is not an array: ${operation.path}`)
    parent[key] = [...((value as JsonValue[] | undefined) ?? []), clone(operation.value)]
  }
}

export class MvuStoreController {
  private readonly store: MvuStore
  private schema: MvuSchema | null = null

  constructor(sessionId: string, initial?: Partial<MvuStore>) {
    this.store = {
      sessionId,
      global: clone(initial?.global ?? {}),
      chat: clone(initial?.chat ?? {}),
      messages: clone(initial?.messages ?? {}),
      revisions: clone(initial?.revisions ?? {}),
    }
  }

  snapshot(): MvuStore {
    return clone(this.store)
  }

  setSchema(schema: MvuSchema | null): void {
    if (schema !== null && (!schema || typeof schema !== 'object')) throw new Error('Invalid MVU schema')
    if (schema) validateSchema(this.store.chat, schema, '$chat')
    this.schema = schema ? clone(schema) : null
  }

  getSchema(): MvuSchema | null {
    return clone(this.schema)
  }

  commit(transaction: VariableTransaction): VariableCommit {
    if (transaction.sessionId !== this.store.sessionId) throw new Error('MVU session mismatch')
    const key = transaction.scope === 'message' ? `message:${transaction.messageId ?? ''}` : transaction.scope
    const currentRevision = this.store.revisions[key] ?? 0
    if (currentRevision !== transaction.baseRevision) throw new VariableConflictError(currentRevision)
    if (transaction.scope === 'message' && !transaction.messageId) throw new Error('Message scope requires messageId')
    const current = transaction.scope === 'global' ? this.store.global : transaction.scope === 'chat' ? this.store.chat : this.store.messages[transaction.messageId!] ?? {}
    const next = clone(current)
    for (const operation of transaction.operations) applyOperation(next, operation)
    if (this.schema && transaction.scope === 'chat') validateSchema(next, this.schema, '$chat')
    if (transaction.scope === 'global') this.store.global = next
    else if (transaction.scope === 'chat') this.store.chat = next
    else this.store.messages[transaction.messageId!] = next
    const revision = currentRevision + 1
    this.store.revisions[key] = revision
    return { revision, value: clone(next), transactionId: transaction.transactionId }
  }
}

function validateSchema(value: unknown, schema: MvuSchema, path: string): void {
  if (schema.type) {
    const valid = schema.type === 'null' ? value === null : schema.type === 'array' ? Array.isArray(value) : schema.type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) : schema.type === 'integer' ? typeof value === 'number' && Number.isInteger(value) : typeof value === schema.type
    if (!valid) throw new Error(`MVU schema mismatch at ${path}: expected ${schema.type}`)
  }
  if (schema.type === 'object' || schema.properties || schema.required) {
    const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
    for (const key of schema.required ?? []) if (!(key in object)) throw new Error(`MVU schema missing required field at ${path}.${key}`)
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in object) validateSchema(object[key], child, `${path}.${key}`)
    if (schema.additionalProperties === false) for (const key of Object.keys(object)) if (!schema.properties?.[key]) throw new Error(`MVU schema rejects field at ${path}.${key}`)
  }
  if (schema.type === 'array' && schema.items && Array.isArray(value)) value.forEach((item, index) => validateSchema(item, schema.items!, `${path}[${index}]`))
}
