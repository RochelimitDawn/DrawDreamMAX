#!/usr/bin/env node
/**
 * 开发入口：构建绘梦 UI，再启动内嵌 DrawDream Agent，于单端口同源托管 dist + /api + /ws。
 * 默认 PORT=7620；VITE_WATCH=1 时后台 vite build --watch 重建静态资源。
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const agentDir = join(root, 'agent')
const children = []
let shuttingDown = false

function log(tag, buf, isErr = false) {
  const stream = isErr ? process.stderr : process.stdout
  for (const line of buf.toString().split(/\r?\n/)) {
    if (line.length) stream.write(`[${tag}] ${line}\n`)
  }
}

function run(tag, command, args, cwd, env = process.env) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
  child.stdout.on('data', (d) => log(tag, d, false))
  child.stderr.on('data', (d) => log(tag, d, true))
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.error(`[${tag}] 已退出 code=${code} signal=${signal ?? ''}`)
    shutdown(code ?? 1)
  })
  children.push(child)
  return child
}

function runOnce(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} failed: ${c}`))))
  })
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) {
    try {
      c.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

if (!existsSync(join(agentDir, 'server', 'main.ts'))) {
  console.error('未找到 agent/server/main.ts')
  process.exit(1)
}

for (const [ex, dest] of [
  ['drawdream.agent.example.json', 'drawdream.agent.json'],
  ['drawdream.config.example.json', 'drawdream.config.json'],
]) {
  const from = join(agentDir, ex)
  const to = join(agentDir, dest)
  if (existsSync(from) && !existsSync(to)) {
    copyFileSync(from, to)
    console.log(`[setup] 已生成 agent/${dest}`)
  }
}

if (!existsSync(join(agentDir, 'node_modules'))) {
  console.log('[setup] 安装 agent 依赖…')
  await runOnce('npm', ['install'], agentDir)
}

if (!existsSync(join(root, 'node_modules'))) {
  console.log('[setup] 安装 UI 依赖…')
  await runOnce('npm', ['install'], root)
}

console.log('[dev] 构建 UI → dist/ …')
await runOnce('npm', ['run', 'build'], root)

const port = process.env.PORT || '7620'
const host = process.env.HOST || '0.0.0.0'
const uiDist = join(root, 'dist')
const watch = process.env.VITE_WATCH === '1' || process.env.VITE_WATCH === 'true'

console.log(`[dev] 单端口 http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}  （UI+API+WS 同源）`)

if (watch) {
  const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  console.log('[dev] VITE_WATCH=1：后台 vite build --watch')
  run(
    'watch',
    existsSync(viteBin) ? process.execPath : 'npx',
    existsSync(viteBin) ? [viteBin, 'build', '--watch'] : ['vite', 'build', '--watch'],
    root,
  )
}

run('agent', 'npm', ['run', 'web'], agentDir, {
  ...process.env,
  PORT: port,
  HOST: host,
  DRAWDREAM_UI_DIST: uiDist,
})
