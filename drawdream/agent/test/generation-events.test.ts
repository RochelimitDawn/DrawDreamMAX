import assert from 'node:assert/strict'
import test from 'node:test'
import { createStoryEventHandler } from '../server/story-subscribe.ts'

test('生成生命周期只创建一个 generationId 并显式结束', () => {
  const frames: unknown[] = []
  const handler = createStoryEventHandler({
    broadcast: (frame) => frames.push(frame),
    resyncAll: () => undefined,
    safeStats: () => null,
    getNames: () => ({ charName: 'A', userName: 'U' }),
  })

  handler({ type: 'agent_start' })
  handler({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hi' } })
  handler({ type: 'agent_end' })

  const lifecycle = frames.filter((frame) => (frame as { type?: string }).type === 'generation') as Array<{
    generationId: string
    phase: string
    outcome?: string
  }>
  assert.equal(lifecycle.length, 2)
  assert.equal(lifecycle[0]?.phase, 'start')
  assert.equal(lifecycle[1]?.phase, 'end')
  assert.equal(lifecycle[1]?.outcome, 'completed')
  assert.equal(lifecycle[0]?.generationId, lifecycle[1]?.generationId)
})

test('重试期间保持 generationId，失败结束为 failed', () => {
  const frames: unknown[] = []
  const handler = createStoryEventHandler({
    broadcast: (frame) => frames.push(frame),
    resyncAll: () => undefined,
    safeStats: () => null,
    getNames: () => ({ charName: 'A', userName: 'U' }),
  })

  handler({ type: 'agent_start' })
  handler({ type: 'auto_retry_start', attempt: 2, maxAttempts: 3 })
  handler({ type: 'auto_retry_end', success: false, finalError: 'timeout' })

  const lifecycle = frames.filter((frame) => (frame as { type?: string }).type === 'generation') as Array<{
    generationId: string
    phase: string
    outcome?: string
  }>
  assert.deepEqual(lifecycle.map((event) => event.phase), ['start', 'retry', 'end'])
  assert.equal(lifecycle[0]?.generationId, lifecycle[2]?.generationId)
  assert.equal(lifecycle[2]?.outcome, 'failed')
})
