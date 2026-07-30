import assert from 'node:assert/strict'
import test from 'node:test'
import { TavernEventBus } from '../../src/tavern/kernel/event-bus.ts'
import { MvuStoreController } from '../../src/tavern/kernel/mvu.ts'
import { VariableConflictError } from '../../src/tavern/kernel/types.ts'

test('TavernEventBus emits ordered events and supports unsubscribe', async () => {
  const bus = new TavernEventBus()
  const received: number[] = []
  const unsubscribe = bus.on('message_received', (event) => {
    received.push(event.sequence)
  })

  await bus.emit('message_received', { id: 'm1' })
  unsubscribe()
  await bus.emit('message_received', { id: 'm2' })

  assert.deepEqual(received, [1])
  assert.equal(bus.revision, 2)
})

test('MvuStoreController commits nested operations with revisions', () => {
  const store = new MvuStoreController('session-1', {
    chat: { score: 2, tags: ['initial'] },
  })

  const commit = store.commit({
    transactionId: 'tx-1',
    sessionId: 'session-1',
    baseRevision: 0,
    scope: 'chat',
    operations: [
      { op: 'add', path: 'score', value: 3 },
      { op: 'append', path: 'tags', value: 'updated' },
      { op: 'set', path: 'status.current', value: 'active' },
    ],
  })

  assert.equal(commit.revision, 1)
  assert.deepEqual(commit.value, {
    score: 5,
    tags: ['initial', 'updated'],
    status: { current: 'active' },
  })
})

test('MvuStoreController rejects stale revisions and unsafe paths', () => {
  const store = new MvuStoreController('session-1')
  store.commit({
    transactionId: 'tx-1',
    sessionId: 'session-1',
    baseRevision: 0,
    scope: 'global',
    operations: [{ op: 'set', path: 'value', value: 1 }],
  })

  assert.throws(
    () => store.commit({
      transactionId: 'tx-stale',
      sessionId: 'session-1',
      baseRevision: 0,
      scope: 'global',
      operations: [{ op: 'set', path: 'value', value: 2 }],
    }),
    (error: unknown) => error instanceof VariableConflictError && error.currentRevision === 1,
  )

  assert.throws(() => store.commit({
    transactionId: 'tx-unsafe',
    sessionId: 'session-1',
    baseRevision: 1,
    scope: 'global',
    operations: [{ op: 'set', path: '__proto__.polluted', value: true }],
  }))
})
