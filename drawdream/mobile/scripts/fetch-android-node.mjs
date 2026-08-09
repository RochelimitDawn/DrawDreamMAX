#!/usr/bin/env node
/**
 * 下载 Android/bionic 兼容的 arm64 Node + 共享库（默认 Termux aarch64 包）。
 * 产出目录结构：
 *   <out>/bin/node
 *   <out>/lib/*.so*
 *
 * 环境变量：
 *   ANDROID_NODE_OUT   输出根目录（默认 mobile/.cache/android-node）
 *   TERMUX_NODE_VER    可选锁定 nodejs 版本；默认读 Packages 索引最新
 *   ANDROID_NODE_URL   若设置则跳过 Termux，按 prepare-runtime 的 tar 逻辑处理（本脚本不负责）
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  cpSync,
  readdirSync,
  statSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
  copyFileSync,
} from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const mobileRoot = join(__dirname, '..')
const outRoot = process.env.ANDROID_NODE_OUT || join(mobileRoot, '.cache', 'android-node')
const arch = 'aarch64'
const base = 'https://packages.termux.dev/apt/termux-main'
const packagesUrl = `${base}/dists/stable/main/binary-${arch}/Packages`

const CORE_PKGS = [
  'nodejs',
  'openssl',
  'zlib',
  'c-ares',
  'libsqlite',
  'libffi',
  'libicu',
  'libc++',
  'libandroid-support',
]

function log(...a) {
  console.log('[fetch-android-node]', ...a)
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true })
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function download(url, dest, tries = 5) {
  let lastErr
  for (let i = 1; i <= tries; i++) {
    try {
      log('download', url, i > 1 ? `(retry ${i}/${tries})` : '')
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!res.ok) throw new Error(`download failed ${res.status} ${url}`)
      await pipeline(res.body, createWriteStream(dest))
      log('saved', dest, `${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB`)
      return
    } catch (e) {
      lastErr = e
      log('download error', e?.message || e)
      try {
        rmSync(dest, { force: true })
      } catch {
        /* ignore */
      }
      if (i < tries) await sleep(1500 * i)
    }
  }
  throw lastErr || new Error(`download failed: ${url}`)
}

function parsePackages(text) {
  const blocks = text.split(/\n\n+/)
  const map = new Map()
  for (const blk of blocks) {
    const fields = {}
    for (const line of blk.split('\n')) {
      if (!line || line.startsWith(' ')) continue
      const i = line.indexOf(':')
      if (i < 0) continue
      fields[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    if (fields.Package) map.set(fields.Package, fields)
  }
  return map
}

function extractDeb(debPath, destDir) {
  ensureDir(destDir)
  const safe = basename(debPath).replace(/[^a-zA-Z0-9._+-]+/g, '_')
  const tmp = join(destDir, `.extract-${safe}`)
  rmSync(tmp, { recursive: true, force: true })
  ensureDir(tmp)
  // 只解出 data.tar*，再只展开 usr/bin 与 usr/lib，避免 doc 坏链
  const r = spawnSync('bash', ['-lc', `cd ${JSON.stringify(tmp)} && ar x ${JSON.stringify(debPath)}`], {
    stdio: 'inherit',
  })
  if (r.status !== 0) throw new Error(`ar x failed: ${debPath}`)
  const dataTar = ['data.tar.xz', 'data.tar.gz', 'data.tar.zst', 'data.tar'].map((n) => join(tmp, n)).find((p) => existsSync(p))
  if (!dataTar) throw new Error(`no data.tar* in ${debPath}`)
  const patterns = [
    './data/data/com.termux/files/usr/bin',
    './data/data/com.termux/files/usr/lib',
    'data/data/com.termux/files/usr/bin',
    'data/data/com.termux/files/usr/lib',
  ]
  let tarArgs
  if (dataTar.endsWith('.xz')) tarArgs = ['-xJf', dataTar, '-C', tmp, '--wildcards', '--no-anchored']
  else if (dataTar.endsWith('.gz')) tarArgs = ['-xzf', dataTar, '-C', tmp, '--wildcards', '--no-anchored']
  else if (dataTar.endsWith('.zst')) tarArgs = ['--zstd', '-xf', dataTar, '-C', tmp, '--wildcards', '--no-anchored']
  else tarArgs = ['-xf', dataTar, '-C', tmp, '--wildcards', '--no-anchored']
  // 尝试按路径过滤；失败则全量解压
  let t = spawnSync('tar', [...tarArgs, ...patterns], { encoding: 'utf8' })
  if (t.status !== 0) {
    log('selective tar failed, full extract', t.stderr?.slice(0, 200))
    if (dataTar.endsWith('.xz')) tarArgs = ['-xJf', dataTar, '-C', tmp]
    else if (dataTar.endsWith('.gz')) tarArgs = ['-xzf', dataTar, '-C', tmp]
    else if (dataTar.endsWith('.zst')) tarArgs = ['--zstd', '-xf', dataTar, '-C', tmp]
    else tarArgs = ['-xf', dataTar, '-C', tmp]
    t = spawnSync('tar', tarArgs, { stdio: 'inherit' })
    if (t.status !== 0) throw new Error(`tar extract failed: ${dataTar}`)
  }
  return tmp
}

function findUnder(root, pred) {
  const out = []
  const walk = (d) => {
    let names
    try {
      names = readdirSync(d)
    } catch {
      return
    }
    for (const name of names) {
      const p = join(d, name)
      let st
      try {
        st = statSync(p, { throwIfNoEntry: false })
      } catch {
        continue
      }
      if (!st) continue
      if (st.isDirectory()) walk(p)
      else if (st.isFile() && pred(p, name)) out.push(p)
    }
  }
  walk(root)
  return out
}

async function main() {
  ensureDir(outRoot)
  const cacheDir = join(mobileRoot, '.cache', 'termux-debs')
  ensureDir(cacheDir)

  const idxPath = join(cacheDir, 'Packages')
  await download(packagesUrl, idxPath)
  const pkgs = parsePackages(readFileSync(idxPath, 'utf8'))

  const binDir = join(outRoot, 'bin')
  const libDir = join(outRoot, 'lib')
  rmSync(binDir, { recursive: true, force: true })
  rmSync(libDir, { recursive: true, force: true })
  ensureDir(binDir)
  ensureDir(libDir)

  const resolved = []
  for (const name of CORE_PKGS) {
    const meta = pkgs.get(name)
    if (!meta?.Filename) throw new Error(`package not found in index: ${name}`)
    resolved.push(meta)
  }

  for (const meta of resolved) {
    const url = `${base}/${meta.Filename}`
    const debName = basename(meta.Filename)
    const debPath = join(cacheDir, debName)
    if (!existsSync(debPath)) {
      await download(url, debPath)
    } else {
      log('cache hit', debPath)
    }
    const extracted = extractDeb(debPath, cacheDir)
    // Termux 前缀: data/data/com.termux/files/usr/{bin,lib}
    const usr = findUnder(extracted, (p) => p.endsWith('/usr/bin/node')).map((p) => dirname(dirname(p)))[0]
      || findUnder(extracted, (p, n) => n.startsWith('lib') && p.includes('/usr/lib/')).map((p) => {
        // climb to usr
        let d = dirname(p)
        while (d !== '/' && basename(d) !== 'usr') d = dirname(d)
        return d
      })[0]

    if (usr && existsSync(join(usr, 'bin'))) {
      for (const f of readdirSync(join(usr, 'bin'))) {
        const from = join(usr, 'bin', f)
        if (statSync(from).isFile()) {
          cpSync(from, join(binDir, f))
          try {
            chmodSync(join(binDir, f), 0o755)
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (usr && existsSync(join(usr, 'lib'))) {
      const walkLib = (d) => {
        let names
        try {
          names = readdirSync(d)
        } catch {
          return
        }
        for (const name of names) {
          const from = join(d, name)
          let lst
          try {
            lst = lstatSync(from)
          } catch {
            continue
          }
          if (lst.isSymbolicLink()) {
            if (!/\.so(\.|$)/.test(name)) continue
            try {
              const target = readlinkSync(from)
              const dest = join(libDir, name)
              try {
                rmSync(dest, { force: true, recursive: true })
              } catch {
                /* ignore */
              }
              symlinkSync(target, dest)
            } catch (e) {
              log('symlink skip', name, e.message)
            }
            continue
          }
          if (lst.isDirectory()) {
            if (name === 'pkgconfig' || name === 'cmake') continue
            // engines / modules 子目录也拷 .so
            walkLib(from)
            continue
          }
          if (lst.isFile() && /\.so(\.|$)/.test(name)) {
            const dest = join(libDir, name)
            try {
              rmSync(dest, { force: true, recursive: true })
            } catch {
              /* ignore */
            }
            copyFileSync(from, dest)
            try {
              chmodSync(dest, 0o755)
            } catch {
              /* ignore */
            }
          }
        }
      }
      walkLib(join(usr, 'lib'))
    }
    rmSync(extracted, { recursive: true, force: true })
  }

  const nodeOut = join(binDir, 'node')
  if (!existsSync(nodeOut)) throw new Error('node binary missing after extract')
  chmodSync(nodeOut, 0o755)

  // 修补 RUNPATH：node → $ORIGIN/../lib；各 .so → $ORIGIN
  const pe = spawnSync('patchelf', ['--set-rpath', '$ORIGIN/../lib', nodeOut], { encoding: 'utf8' })
  if (pe.status === 0) log('patchelf rpath set on node')
  else log('patchelf skip (optional):', pe.stderr?.trim() || pe.error?.message || 'not installed')
  for (const name of readdirSync(libDir)) {
    const p = join(libDir, name)
    try {
      if (lstatSync(p).isSymbolicLink()) continue
      if (!/\.so(\.|$)/.test(name)) continue
      spawnSync('patchelf', ['--set-rpath', '$ORIGIN', p], { encoding: 'utf8' })
    } catch {
      /* ignore */
    }
  }

  const meta = {
    source: 'termux',
    arch,
    packages: resolved.map((m) => ({ name: m.Package, version: m.Version, file: m.Filename })),
    builtAt: new Date().toISOString(),
    sha256Node: createHash('sha256').update(readFileSync(nodeOut)).digest('hex'),
  }
  writeFileSync(join(outRoot, 'ANDROID_NODE.json'), JSON.stringify(meta, null, 2))
  log('ready', nodeOut, 'libs', readdirSync(libDir).length)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
