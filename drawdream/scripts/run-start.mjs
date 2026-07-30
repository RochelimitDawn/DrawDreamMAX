#!/usr/bin/env node
/**
 * 生产入口：要求已有 dist/index.html，由 Agent 同源托管 UI + /api + /ws。
 * 用法：npm run build && npm run start
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const agentDir = join(root, 'agent')
const distIndex = join(root, 'dist', 'index.html')

if (!existsSync(distIndex)) {
  console.error('缺少 dist/index.html，请先执行：npm run build')
  process.exit(1)
}

const port = process.env.PORT || '7620'
const env = {
  ...process.env,
  PORT: port,
  HOST: process.env.HOST || '0.0.0.0',
  DRAWDREAM_UI_DIST: join(root, 'dist'),
  // R4：Web 宿主默认跳过内置全量模型目录（产品用 models.json 自定义渠道）
  DRAWDREAM_SKIP_BUILTIN_MODELS: process.env.DRAWDREAM_SKIP_BUILTIN_MODELS ?? '1',
}

console.log(`[start] 单端口 http://0.0.0.0:${port}  UI=${env.DRAWDREAM_UI_DIST}`)
const child = spawn('npm', ['run', 'web'], {
  cwd: agentDir,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
child.on('exit', (c) => process.exit(c ?? 0))
