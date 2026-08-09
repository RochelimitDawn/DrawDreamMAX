#!/usr/bin/env node
/**
 * 把 agent 服务端打包为单文件 ESM（bundle 全部依赖，含 ws/coding-agent/ai/mcp-sdk）。
 * 产物 runtime/agent/single.mjs：真机上只需 `node single.mjs`，不依赖 node_modules。
 * ws 的动态 require 用 createRequire(import.meta.url) shim 解决（ESM 下 require node 内置模块）。
 *
 * 用法：
 *   node mobile/scripts/bundle-agent.mjs
 *   SKIP_SMOKE=1 跳过启动冒烟
 */

import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const mobileRoot = join(__dirname, '..')
const projectRoot = join(mobileRoot, '..')
const agentSrc = join(projectRoot, 'agent')
const outDir = join(mobileRoot, 'runtime', 'agent')
const outFile = join(outDir, 'single.mjs')

const log = (...a) => console.log('[bundle-agent]', ...a)

const REQUIRE_SHIM = `import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);`

export async function bundleAgent() {
  if (!existsSync(join(agentSrc, 'server', 'main.ts'))) {
    throw new Error(`agent src missing: ${agentSrc}/server/main.ts`)
  }
  log('bundle', 'server/main.ts →', outFile)
  const r = spawnSync(
    'npx',
    [
      '--yes',
      'esbuild',
      join(agentSrc, 'server', 'main.ts'),
      '--bundle',
      '--platform=node',
      '--format=esm',
      // 单文件 bundle 模式：裁剪树无 node_modules，扩展加载须走
      // VIRTUAL_MODULES（typebox 等已由 loader.ts 静态 import 内联进 bundle），
      // 而非 Node 的 require.resolve（找不到 typebox 会崩）。
      `--banner:js=${REQUIRE_SHIM}globalThis.__DD_SINGLE_FILE_BUNDLE=true;`,
      `--outfile=${outFile}`,
      '--log-level=warning',
    ],
    { encoding: 'utf8' },
  )
  if (r.status !== 0) {
    console.error(r.stdout || '')
    console.error(r.stderr || '')
    throw new Error('esbuild bundle failed')
  }
  log('bundled', outFile, `(${(statSync(outFile).size / 1024 / 1024).toFixed(1)} MB)`)

  if (process.env.SKIP_SMOKE !== '1') {
    const port = 18980 + Math.floor(Math.random() * 200)
    // smoke 在 outDir 下启动，避免 server 的 auth 迁移逻辑把 agentSrc/.drawdream
    // 重命名搬进 data/users/<id>/workspace（CI 全新环境会触发）。
    const smokeRoot = join(outDir, '.smoke')
    mkdirSync(smokeRoot, { recursive: true })
    const p = spawn(process.execPath, [outFile], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        DD_AUTH_MODE: 'single',
        DD_DATA_ROOT: join(smokeRoot, 'data'),
        DRAWDREAM_CODING_AGENT_DIR: join(smokeRoot, 'agent-home'),
      },
      cwd: smokeRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let smokeBuf = ''
    const ok = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000)
      p.stdout.on('data', (d) => {
        smokeBuf += d.toString()
        if (smokeBuf.includes('listening')) {
          clearTimeout(timer)
          resolve(true)
        }
      })
      p.stderr.on('data', (d) => {
        smokeBuf += d.toString()
      })
      p.on('exit', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
    p.kill()
    rmSync(smokeRoot, { recursive: true, force: true })
    if (!ok) {
      console.error('[bundle-agent] smoke server output:\n' + smokeBuf)
      throw new Error('single.mjs smoke failed: no "listening" within 8s')
    }
    log('smoke OK (single.mjs started)')
  }
  return outFile
}

// CLI 直接运行
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  bundleAgent()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[bundle-agent] fatal', e)
      process.exit(1)
    })
}
