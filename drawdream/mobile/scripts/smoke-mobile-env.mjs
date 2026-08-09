#!/usr/bin/env node
/**
 * Phase 0 桌面冒烟：用系统 Node + 移动端 env 布局启动 Agent，验证 /healthz。
 * 不依赖 Android SDK。
 *
 *   node mobile/scripts/smoke-mobile-env.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const agentDir = join(root, 'agent')
const home = join(tmpdir(), `drawdream-mobile-smoke-${process.pid}`)
const port = process.env.PORT || '17620'

mkdirSync(home, { recursive: true })
mkdirSync(join(home, '.drawdream', 'agent'), { recursive: true })

const uiDist = join(root, 'dist')
if (!existsSync(join(uiDist, 'index.html'))) {
  console.error('缺少 dist/index.html，请先 npm run build')
  process.exit(1)
}

const env = {
  ...process.env,
  HOME: home,
  HOST: '127.0.0.1',
  PORT: String(port),
  DRAWDREAM_UI_DIST: uiDist,
  DRAWDREAM_SKIP_BUILTIN_MODELS: '1',
  DRAWDREAM_CODING_AGENT_DIR: join(home, '.drawdream', 'agent'),
  DD_AUTH_MODE: 'single',
  DD_ALLOW_REGISTER: '0',
  DD_DATA_ROOT: join(home, 'data'),
}

console.log('[smoke] HOME=', home, 'PORT=', port)
const child = spawn('npm', ['run', 'web'], {
  cwd: agentDir,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let out = ''
child.stdout.on('data', (d) => {
  out += d
  process.stdout.write(d)
})
child.stderr.on('data', (d) => {
  out += d
  process.stderr.write(d)
})

const deadline = Date.now() + 45000
async function waitHealth() {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`)
      if (r.ok) {
        const j = await r.json()
        console.log('[smoke] healthz OK', j)
        return true
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const ok = await waitHealth()
child.kill('SIGTERM')
setTimeout(() => {
  try {
    child.kill('SIGKILL')
  } catch {
    /* ignore */
  }
}, 2000)

// 清理临时 HOME（保留失败现场可设 KEEP_SMOKE=1）
if (process.env.KEEP_SMOKE !== '1') {
  try {
    rmSync(home, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

if (!ok) {
  console.error('[smoke] FAIL: /healthz 未在时限内就绪')
  process.exit(1)
}
console.log('[smoke] PASS')
process.exit(0)
