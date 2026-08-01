import assert from 'node:assert/strict'
import test from 'node:test'
import { isDrawDreamLoopbackUrl, shouldOpenInExternalBrowser } from '../../src/tavern/mobile-policy.ts'

test('Android loopback policy accepts only localhost and port 7620', () => {
  assert.equal(isDrawDreamLoopbackUrl('http://127.0.0.1:7620/'), true)
  assert.equal(isDrawDreamLoopbackUrl('http://localhost/healthz'), true)
  assert.equal(isDrawDreamLoopbackUrl('http://127.0.0.1:7621/'), false)
  assert.equal(isDrawDreamLoopbackUrl('http://192.168.1.2:7620/'), false)
  assert.equal(isDrawDreamLoopbackUrl('file:///tmp/index.html'), false)
  assert.equal(shouldOpenInExternalBrowser('https://example.com'), true)
})
