#!/usr/bin/env node
/**
 * 组装手机版 runtime：
 *   mobile/runtime/
 *     bin/node          — arm64 Node（默认 Termux aarch64 / bionic）
 *     lib/              — 配套 .so（注入时进 jniLibs）
 *     agent/            — 裁剪后的 Agent 树（symlink 已解引用）
 *     ui/               — Vite dist
 *     VERSION.json
 *
 * 用法：
 *   node mobile/scripts/prepare-runtime.mjs
 *   SKIP_UI_BUILD=1 SKIP_NODE_DOWNLOAD=1 node mobile/scripts/prepare-runtime.mjs
 *   NODE_ARCH=x64 node mobile/scripts/prepare-runtime.mjs   # 本机冒烟用
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  statSync,
  lstatSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const mobileRoot = join(__dirname, '..')
const projectRoot = join(mobileRoot, '..')
const outRoot = join(mobileRoot, 'runtime')
const nodeVersion = process.env.DRAWDREAM_MOBILE_NODE_VERSION || 'v22.22.0'
const nodeArch = process.env.NODE_ARCH || 'arm64' // arm64 | x64
const skipUi = process.env.SKIP_UI_BUILD === '1'
const skipNode = process.env.SKIP_NODE_DOWNLOAD === '1'
const skipAgentInstall = process.env.SKIP_AGENT_INSTALL === '1'

function log(...a) {
  console.log('[prepare-runtime]', ...a)
}

function run(cmd, args, opts = {}) {
  log('run', cmd, args.join(' '))
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) {
    throw new Error(`command failed: ${cmd} ${args.join(' ')} (exit ${r.status})`)
  }
}

function sha256File(p) {
  const h = createHash('sha256')
  h.update(readFileSync(p))
  return h.digest('hex')
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true })
}

async function download(url, dest) {
  log('download', url)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed ${res.status} ${url}`)
  await pipeline(res.body, createWriteStream(dest))
  log('saved', dest, `${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB`)
}

function extractTarGz(tarGz, destDir) {
  ensureDir(destDir)
  const r = spawnSync('tar', ['-xzf', tarGz, '-C', destDir], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`tar extract failed: ${tarGz}`)
}

function readdirSyncSafe(p) {
  try {
    return readdirSync(p).length
  } catch {
    return 0
  }
}

async function prepareNode() {
  const binDir = join(outRoot, 'bin')
  const libDir = join(outRoot, 'lib')
  ensureDir(binDir)
  const nodeOut = join(binDir, 'node')

  if (skipNode) {
    if (existsSync(nodeOut)) {
      log('SKIP_NODE_DOWNLOAD: keep existing', nodeOut)
      return
    }
    const which = spawnSync('which', ['node'], { encoding: 'utf8' })
    const sys = which.stdout?.trim()
    if (!sys) throw new Error('SKIP_NODE_DOWNLOAD 但无现成 bin/node，且系统无 node')
    run('cp', [sys, nodeOut])
    chmodSync(nodeOut, 0o755)
    log('copied host node →', nodeOut)
    return
  }

  const override = process.env.ANDROID_NODE_URL?.trim()
  const wantAndroidNode =
    process.env.FORCE_LINUX_NODE !== '1' &&
    !override &&
    (nodeArch === 'arm64' || nodeArch === 'aarch64')

  if (wantAndroidNode) {
    const androidNodeRoot = join(mobileRoot, '.cache', 'android-node')
    run(process.execPath, [join(mobileRoot, 'scripts', 'fetch-android-node.mjs')], {
      env: { ...process.env, ANDROID_NODE_OUT: androidNodeRoot },
    })
    const srcNode = join(androidNodeRoot, 'bin', 'node')
    if (!existsSync(srcNode)) throw new Error('fetch-android-node 未产出 bin/node')
    run('cp', [srcNode, nodeOut])
    chmodSync(nodeOut, 0o755)
    rmSync(libDir, { recursive: true, force: true })
    ensureDir(libDir)
    const srcLib = join(androidNodeRoot, 'lib')
    if (existsSync(srcLib)) {
      cpSync(srcLib, libDir, { recursive: true })
    }
    const meta = join(androidNodeRoot, 'ANDROID_NODE.json')
    if (existsSync(meta)) {
      cpSync(meta, join(outRoot, 'ANDROID_NODE.json'))
    }
    log('android/bionic node ready', nodeOut, 'lib entries', existsSync(libDir) ? readdirSyncSafe(libDir) : 0)
    return
  }

  let url
  let expectedName
  if (override) {
    url = override
    expectedName = 'custom-node.tar.gz'
  } else {
    expectedName = `node-${nodeVersion}-linux-${nodeArch}.tar.gz`
    url = `https://nodejs.org/dist/${nodeVersion}/${expectedName}`
  }

  const cacheDir = join(mobileRoot, '.cache')
  ensureDir(cacheDir)
  const tarPath = join(cacheDir, expectedName)
  if (!existsSync(tarPath)) {
    await download(url, tarPath)
  } else {
    log('cache hit', tarPath)
  }

  const extractDir = join(cacheDir, `extract-${nodeArch}`)
  rmSync(extractDir, { recursive: true, force: true })
  ensureDir(extractDir)
  extractTarGz(tarPath, extractDir)

  const r = spawnSync('bash', ['-lc', `find ${JSON.stringify(extractDir)} -type f -name node | head -1`], {
    encoding: 'utf8',
  })
  const found = r.stdout?.trim()
  if (!found || !existsSync(found)) throw new Error('tar 中未找到 node 二进制')
  run('cp', [found, nodeOut])
  chmodSync(nodeOut, 0o755)
  const foundLib = join(dirname(found), '..', 'lib')
  if (existsSync(foundLib)) {
    rmSync(libDir, { recursive: true, force: true })
    cpSync(foundLib, libDir, { recursive: true })
  }
  log('node binary ready', nodeOut)
}

function prepareUi() {
  const uiOut = join(outRoot, 'ui')
  rmSync(uiOut, { recursive: true, force: true })
  ensureDir(uiOut)
  if (!skipUi) {
    run('npm', ['run', 'build'], { cwd: projectRoot })
  }
  const dist = join(projectRoot, 'dist')
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error('缺少 dist/index.html，请先 npm run build 或去掉 SKIP_UI_BUILD')
  }
  cpSync(dist, uiOut, { recursive: true })
  log('ui copied', uiOut)
}

/**
 * packages 下各包 dist 不入库；CI 必须在打包前编译，否则真机
 * import @drawdream/agent-runtime/web 指向 dist/web.js 会 ERR_MODULE_NOT_FOUND。
 * 顺序：tui → ai → agent → coding-agent（与本地 agent:build 一致）。
 */
function ensureAgentPackagesBuilt(agentSrc) {
  const skipBuild = process.env.SKIP_AGENT_PACKAGES_BUILD === '1'
  const required = [
    ['packages/tui/dist/index.js', 'tui'],
    ['packages/ai/dist/index.js', 'ai'],
    ['packages/agent/dist/index.js', 'agent-core'],
    ['packages/coding-agent/dist/web.js', 'agent-runtime/web'],
    ['packages/coding-agent/dist/index.js', 'agent-runtime'],
  ]
  const missing = required.filter(([rel]) => !existsSync(join(agentSrc, rel)))
  if (skipBuild) {
    if (missing.length) {
      throw new Error(
        'SKIP_AGENT_PACKAGES_BUILD=1 但缺少 dist:\n  - ' +
          missing.map(([r]) => r).join('\n  - '),
      )
    }
    log('SKIP_AGENT_PACKAGES_BUILD: reuse existing package dist')
    return
  }

  // tsgo 不在 package.json 依赖里，CI 需全局安装
  const tsgoCheck = spawnSync('tsgo', ['--version'], { encoding: 'utf8' })
  if (tsgoCheck.status !== 0) {
    log('install @typescript/native-preview (tsgo)')
    run('npm', ['install', '-g', '@typescript/native-preview'])
  } else {
    log('tsgo', (tsgoCheck.stdout || tsgoCheck.stderr || '').trim())
  }

  // coding-agent build 需要 shx（devDependency）
  const shxBin = join(agentSrc, 'node_modules', '.bin', 'shx')
  if (!existsSync(shxBin)) {
    log('install shx for package builds')
    run('npm', ['install', '--no-save', 'shx'], { cwd: agentSrc })
  }

  const order = ['tui', 'ai', 'agent', 'coding-agent']
  for (const name of order) {
    const pkgDir = join(agentSrc, 'packages', name)
    if (!existsSync(join(pkgDir, 'package.json'))) {
      throw new Error(`missing package: ${pkgDir}`)
    }
    log('build package', name)
    run('npm', ['run', 'build'], {
      cwd: pkgDir,
      env: {
        ...process.env,
        PATH: `${join(agentSrc, 'node_modules', '.bin')}:${process.env.PATH || ''}`,
      },
    })
  }

  const stillMissing = required.filter(([rel]) => !existsSync(join(agentSrc, rel)))
  if (stillMissing.length) {
    throw new Error(
      'agent packages build incomplete:\n  - ' + stillMissing.map(([r]) => r).join('\n  - '),
    )
  }
  log('agent packages dist ready')
}

function copyPath(from, to, filter) {
  ensureDir(dirname(to))
  const isDir = statSync(from).isDirectory()
  if (isDir) {
    ensureDir(to)
    // rsync -aL：解引用 symlink，避免手机上绝对路径断链
    const r = spawnSync(
      'rsync',
      [
        '-aL',
        '--exclude',
        '.git/',
        '--exclude',
        'test/',
        '--exclude',
        'docs/',
        '--exclude',
        'examples/',
        '--exclude',
        '.cache/',
        from.endsWith('/') ? from : `${from}/`,
        to.endsWith('/') ? to : `${to}/`,
      ],
      { encoding: 'utf8' },
    )
    if (r.status === 0) return
    log('rsync failed, fallback cpSync', r.stderr?.slice(0, 200))
  }
  cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter,
  })
}

/**
 * 强制用 packages/* 实体覆盖 node_modules/@drawdream/*（file: 链接）
 */
function materializeWorkspaceLinks(agentOut) {
  const packagesDir = join(agentOut, 'packages')
  const map = {
    'agent-runtime': 'coding-agent',
    'agent-core': 'agent',
    ai: 'ai',
    tui: 'tui',
  }

  const relinkAt = (nmRoot) => {
    const scope = join(nmRoot, '@drawdream')
    if (!existsSync(scope)) return
    for (const [pkgName, dirName] of Object.entries(map)) {
      const dest = join(scope, pkgName)
      const src = join(packagesDir, dirName)
      if (!existsSync(src)) {
        log('warn: missing package for link', pkgName, src)
        continue
      }
      rmSync(dest, { recursive: true, force: true })
      cpSync(src, dest, {
        recursive: true,
        dereference: true,
        filter: (p) => {
          const s = p.replace(src, '')
          if (s.includes('/node_modules/')) return false
          if (s.includes('/test/')) return false
          if (s.includes('/docs/')) return false
          if (s.includes('/examples/')) return false
          if (s.includes('/.git')) return false
          return true
        },
      })
      log('materialized @drawdream/' + pkgName)
    }
  }

  // 只处理顶层 node_modules。packages/*/node_modules 里再拷会触发
  // 「copy X into X/node_modules/@drawdream/...」自引用错误。
  relinkAt(join(agentOut, 'node_modules'))

  // packages 内嵌 node_modules/@drawdream：删掉坏链即可，依赖提升到顶层解析
  if (existsSync(packagesDir)) {
    for (const name of readdirSync(packagesDir)) {
      const scope = join(packagesDir, name, 'node_modules', '@drawdream')
      if (!existsSync(scope)) continue
      rmSync(scope, { recursive: true, force: true })
      log('removed nested', scope.replace(agentOut, ''))
    }
  }

  const binDir = join(agentOut, 'node_modules', '.bin')
  if (existsSync(binDir)) {
    rmSync(binDir, { recursive: true, force: true })
    log('removed node_modules/.bin')
  }
}

/** 展开残留 symlink；断链则删除 */
function flattenSymlinks(root) {
  const walk = (dir) => {
    let names
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      const p = join(dir, name)
      let lst
      try {
        lst = lstatSync(p)
      } catch {
        continue
      }
      if (lst.isSymbolicLink()) {
        try {
          const real = realpathSync(p)
          rmSync(p, { force: true })
          cpSync(real, p, { recursive: true, dereference: true })
          log('flattened symlink', p.replace(root, ''))
        } catch {
          rmSync(p, { force: true })
          log('removed broken symlink', p.replace(root, ''))
        }
        continue
      }
      if (lst.isDirectory()) walk(p)
    }
  }
  walk(root)
}

function verifyMobileAgentTree(agentOut) {
  const checks = [
    'package.json',
    'server/main.ts',
    'server/user-host.ts',
    'node_modules/ws/package.json',
    'node_modules/@drawdream/agent-runtime/package.json',
    'node_modules/@drawdream/agent-runtime/dist/web.js',
    'node_modules/@drawdream/agent-runtime/dist/index.js',
    'node_modules/@drawdream/ai/package.json',
    'node_modules/@drawdream/ai/dist/index.js',
    'node_modules/@drawdream/agent-core/package.json',
    'node_modules/@drawdream/agent-core/dist/index.js',
    'node_modules/@drawdream/tui/package.json',
    'node_modules/@drawdream/tui/dist/index.js',
    '.drawdream/extensions/roleplay.ts',
  ]
  const missing = []
  for (const rel of checks) {
    const p = join(agentOut, rel)
    if (!existsSync(p)) missing.push(rel)
    else {
      try {
        if (lstatSync(p).isSymbolicLink()) missing.push(rel + ' (still symlink)')
      } catch {
        missing.push(rel)
      }
    }
  }
  // @drawdream/* 不得仍是绝对路径链
  const dd = join(agentOut, 'node_modules', '@drawdream')
  if (existsSync(dd)) {
    for (const n of readdirSync(dd)) {
      const p = join(dd, n)
      if (lstatSync(p).isSymbolicLink()) {
        missing.push(`@drawdream/${n} still symlink`)
      }
    }
  }
  // package exports 子路径：确保 package.json 声明 ./web 且文件存在
  try {
    const rtPkg = JSON.parse(
      readFileSync(join(agentOut, 'node_modules/@drawdream/agent-runtime/package.json'), 'utf8'),
    )
    const webExp = rtPkg.exports?.['./web']
    if (!webExp) missing.push('agent-runtime package.json missing exports["./web"]')
  } catch (e) {
    missing.push('agent-runtime package.json unreadable: ' + (e.message || e))
  }
  if (missing.length) {
    throw new Error('mobile agent tree incomplete:\n  - ' + missing.join('\n  - '))
  }
  log('verifyMobileAgentTree OK')
}

function writeMobileEntry(agentOut) {
  const launcher = `#!/usr/bin/env node
/**
 * DrawDream mobile agent entry — 由 Android AgentRuntimeService 调用。
 * 约定 cwd = runtime/agent，HOME 由壳注入到 app 私有目录。
 */
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const main = join(here, 'server', 'main.ts')
const single = join(here, 'single.mjs')

console.log('[mobile-entry] start', process.version, process.arch, process.platform)
console.log('[mobile-entry] execPath', process.execPath)
console.log('[mobile-entry] cwd', process.cwd())
console.log('[mobile-entry] here', here)
console.log('[mobile-entry] main', main, 'exists=', existsSync(main))
console.log('[mobile-entry] single', single, 'exists=', existsSync(single))
console.log('[mobile-entry] package.json exists=', existsSync(join(here, 'package.json')))
const dd = join(here, 'node_modules', '@drawdream')
console.log('[mobile-entry] @drawdream', existsSync(dd) ? readdirSync(dd).join(',') : 'MISSING')

process.env.HOST = process.env.HOST || '127.0.0.1'
process.env.PORT = process.env.PORT || '7620'
process.env.DRAWDREAM_SKIP_BUILTIN_MODELS = process.env.DRAWDREAM_SKIP_BUILTIN_MODELS || '1'
if (!process.env.DRAWDREAM_UI_DIST) {
  process.env.DRAWDREAM_UI_DIST = join(root, 'ui')
}

const libDir = join(root, 'lib')
if (existsSync(libDir)) {
  const prev = process.env.LD_LIBRARY_PATH || ''
  process.env.LD_LIBRARY_PATH = prev ? libDir + ':' + prev : libDir
}

process.chdir(here)

try {
  // 单文件优先（不依赖 node_modules）；缺失回退 server/main.ts
  if (existsSync(single)) {
    console.log('[mobile-entry] loading single.mjs (bundle)')
    await import(pathToFileURL(single).href)
  } else {
    // 实体路径预检（package exports 可能无 CJS main，createRequire 会误报）
    for (const rel of [
      'node_modules/ws/package.json',
      'node_modules/@drawdream/agent-runtime/dist/index.js',
      'node_modules/@drawdream/agent-runtime/dist/web.js',
      'node_modules/@drawdream/ai/dist/index.js',
    ]) {
      const p = join(here, rel)
      console.log('[mobile-entry] check', rel, existsSync(p) ? 'OK' : 'MISSING')
    }
    await import(pathToFileURL(main).href)
  }
} catch (err) {
  console.error('[mobile-entry] fatal', err)
  if (err && err.stack) console.error(err.stack)
  process.exit(1)
}
`
  writeFileSync(join(agentOut, 'mobile-entry.mjs'), launcher)
}

async function prepareAgent() {
  const agentSrc = join(projectRoot, 'agent')
  const agentOut = join(outRoot, 'agent')
  rmSync(agentOut, { recursive: true, force: true })
  ensureDir(agentOut)

  // 1) 先保证依赖齐全（含 dev，供 tsgo/shx 构建 packages）
  if (!skipAgentInstall) {
    run('npm', ['install'], { cwd: agentSrc })
  }

  // 2) 编译 packages dist（必须在 omit=dev 之前）
  ensureAgentPackagesBuilt(agentSrc)

  // 3) 再裁剪为生产依赖树
  if (!skipAgentInstall && process.env.KEEP_AGENT_DEV !== '1') {
    run('npm', ['prune', '--omit=dev'], { cwd: agentSrc })
  }

  const filter = (src) => {
    const base = src.replace(agentSrc, '')
    if (base.includes('/.git')) return false
    if (base.includes('/test/')) return false
    if (base.includes('/docs/')) return false
    if (base.includes('/examples/')) return false
    return true
  }

  for (const name of [
    'server',
    'src',
    'packages',
    'package.json',
    'package-lock.json',
    'node_modules',
    'assets',
    // 产品接线层（roleplay 扩展）；缺失会导致 /rprefresh 与剧情工具不可用
    '.drawdream',
  ]) {
    const from = join(agentSrc, name)
    if (!existsSync(from)) {
      log('skip missing', name)
      continue
    }
    log('copy', name, '(dereference)')
    copyPath(from, join(agentOut, name), filter)
  }

  materializeWorkspaceLinks(agentOut)
  flattenSymlinks(agentOut)
  writeMobileEntry(agentOut)
  verifyMobileAgentTree(agentOut)

  // 4) 生成单文件入口（single.mjs）：真机优先加载，不依赖 node_modules。
  //    失败不阻断整体（node_modules 树仍在，作为兜底入口）
  try {
    const { bundleAgent } = await import('./bundle-agent.mjs')
    await bundleAgent()
  } catch (err) {
    console.error('[prepare-runtime] single.mjs bundle skipped:', err?.message || err)
  }

  // 启动期 import 预检（与真机相同 ESM 路径）
  const importCheck = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const root = ${JSON.stringify(agentOut)}
process.chdir(root)
await import('@drawdream/agent-runtime/web')
await import('@drawdream/ai')
console.log('[prepare-runtime] import smoke OK')
`,
    ],
    { encoding: 'utf8', cwd: agentOut, env: { ...process.env, NODE_PATH: '' } },
  )
  if (importCheck.status !== 0) {
    console.error(importCheck.stdout || '')
    console.error(importCheck.stderr || '')
    throw new Error('import smoke failed for @drawdream/agent-runtime/web (see above)')
  }
  log((importCheck.stdout || '').trim() || 'import smoke OK')

  log('agent staged', agentOut)
}

function writeVersion() {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  const runtimeId = process.env.DRAWDREAM_RUNTIME_ID ||
    process.env.GITHUB_SHA ||
    `runtime-${pkg.version}-${Date.now()}`
  const info = {
    appVersion: pkg.version,
    runtimeId,
    nodeVersion,
    nodeArch,
    builtAt: new Date().toISOString(),
    host: process.env.HOST || '127.0.0.1',
    port: 7620,
    notes: [
      '默认 arm64 使用 Termux aarch64 Node（bionic）；FORCE_LINUX_NODE=1 可强制官方 linux 包。',
      'agent packages/*/dist 在打包前强制 tsgo build；@drawdream/* 为实体目录。',
      'agent/node_modules 已解引用 symlink。',
      'Node 可执行文件由 inject 打进 jniLibs，从 nativeLibraryDir 启动。',
    ],
  }
  writeFileSync(join(outRoot, 'VERSION.json'), JSON.stringify(info, null, 2))
  log('VERSION.json', info)
}

function packTarball() {
  const tgz = join(mobileRoot, 'drawdream-runtime.tgz')
  rmSync(tgz, { force: true })
  run('tar', ['-czf', tgz, '-C', outRoot, '.'])
  const sum = sha256File(tgz)
  writeFileSync(join(mobileRoot, 'drawdream-runtime.sha256'), `${sum}  drawdream-runtime.tgz\n`)
  log('packed', tgz, `${(statSync(tgz).size / 1024 / 1024).toFixed(1)} MB`, 'sha256', sum.slice(0, 12) + '…')
}

async function main() {
  ensureDir(outRoot)
  log('outRoot', outRoot)
  await prepareNode()
  prepareUi()
  await prepareAgent()
  writeVersion()
  packTarball()
  ensureDir(join(mobileRoot, 'android/app/src/main/assets'))
  writeFileSync(
    join(mobileRoot, 'android/app/src/main/assets/runtime-pointer.json'),
    JSON.stringify(
      {
        tarball: 'drawdream-runtime.tgz',
        note: 'CI injects jniLibs + runtime.zip via inject-android-assets.mjs',
      },
      null,
      2,
    ),
  )
  log('done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
