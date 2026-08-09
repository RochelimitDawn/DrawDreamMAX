import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const workspace = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(`${workspace}/${path}`, 'utf8')

test('Android WebView keeps the local Agent on loopback port 7620', () => {
  const activity = read('mobile/android/app/src/main/java/com/drawdream/app/MainActivity.kt')
  const network = read('mobile/android/app/src/main/res/xml/network_security_config.xml')
  const service = read('mobile/android/app/src/main/java/com/drawdream/app/AgentRuntimeService.kt')
  assert.match(activity, /host == "127\.0\.0\.1" \|\| host == "localhost"/)
  assert.match(activity, /uri\.port == 7620/)
  assert.match(activity, /MIXED_CONTENT_NEVER_ALLOW/)
  assert.match(network, /127\.0\.0\.1/)
  assert.match(network, /localhost/)
  assert.match(network, /cleartextTrafficPermitted="false"/)
  assert.match(service, /env\["HOST"\] = "127\.0\.0\.1"/)
  assert.match(service, /const val PORT = 7620/)
})
