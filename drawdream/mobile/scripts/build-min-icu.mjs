#!/usr/bin/env node
/**
 * 构建 zh/en-only 的精简 ICU 78.3 数据（libicudata.so），替换 termux 完整 33MB 数据。
 * 产物：mobile/.cache/min-icu/libicudata.so（arm64，约 2.7MB）
 *
 * 原理：
 *   1. 下载 ICU 78.3 源码（对齐 termux node 的 ICU 版本，缓存到 .cache）
 *   2. 构建 x64 工具（genrb/pkgdata/icupkg）
 *   3. 从构建产物裁剪出 zh/en/root + 核心数据（brkitr/coll/nrm/cnv 等）
 *   4. 用 aarch64 gcc 交叉打包为 libicudata.so（导出 icudt78_dat 符号，与 termux 一致）
 *
 * 用法：
 *   node mobile/scripts/build-min-icu.mjs
 *   ICU_SRC_DIR=<已有源码目录> 复用源码（跳过下载/构建工具）
 *   SKIP_ICU_BUILD=1 仅重新裁剪打包（复用已构建的 icu 工具）
 */
import {
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  copyFileSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const mobileRoot = join(__dirname, '..')
const cacheDir = join(mobileRoot, '.cache')
const outDir = join(cacheDir, 'min-icu')
const ICU_VERSION = '78.3'
const ICU_TAG = 'release-78.3'
const ICU_SRC_URL = `https://github.com/unicode-org/icu/archive/refs/tags/${ICU_TAG}.tar.gz`

function log(...a) {
  console.log('[build-min-icu]', ...a)
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) throw new Error(`command failed: ${cmd} ${args.join(' ')} (exit ${r.status})`)
  return r
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true })
}

/** 生成文件清单：zh/en/root locale + 全部核心数据（.cnv/.icu/.nrm/.spp/.dict/.brk/.cfu） */
function buildKeepList(resourceRoot, itemsTxt) {
  const items = readFileSync(itemsTxt, 'utf8').split('\n').filter(Boolean)
  const keep = []
  for (const rel of items) {
    const base = rel.split('/').pop()
    const dot = base.lastIndexOf('.')
    const name = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot + 1) : ''
    // 核心非 locale 数据全保留
    const coreExts = new Set(['cnv', 'icu', 'nrm', 'spp', 'dict', 'brk', 'cfu'])
    if (coreExts.has(ext)) {
      keep.push(rel)
      continue
    }
    // locale .res：root / zh / en（含子区域）
    if (ext === 'res' && (name === 'root' || name === 'zh' || name.startsWith('zh_') ||
      name === 'en' || name.startsWith('en_'))) {
      keep.push(rel)
    }
  }
  return [...new Set(keep)].sort()
}

/** 从完整资源树复制出精简树 */
function stageMinTree(srcRoot, keepList, dstRoot) {
  rmSync(dstRoot, { recursive: true, force: true })
  ensureDir(dstRoot)
  for (const rel of keepList) {
    const from = join(srcRoot, rel)
    const to = join(dstRoot, rel)
    if (!existsSync(from)) continue
    ensureDir(dirname(to))
    copyFileSync(from, to)
  }
  log('staged min tree:', dstRoot, `${countFiles(dstRoot)} files`)
}

function countFiles(dir) {
  let n = 0
  for (const f of readdirSync(dir, { recursive: true })) {
    const p = join(dir, f)
    if (statSync(p).isFile()) n++
  }
  return n
}

function aarch64GccAvailable() {
  return spawnSync('aarch64-linux-gnu-gcc', ['--version']).status === 0
}

async function download(url, dest) {
  if (existsSync(dest)) {
    log('cache hit', dest)
    return
  }
  log('download', url)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed ${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(dest, buf)
  log('saved', dest, `${(buf.length / 1048576).toFixed(1)} MB`)
}

async function ensureIcuSource() {
  const srcDir = process.env.ICU_SRC_DIR
  if (srcDir && existsSync(join(srcDir, 'icu4c', 'source'))) {
    log('reuse ICU_SRC_DIR', srcDir)
    return join(srcDir, 'icu4c', 'source')
  }
  const dl = join(cacheDir, `icu-${ICU_VERSION}.tar.gz`)
  const srcRoot = join(cacheDir, `icu-src-${ICU_VERSION}`)
  if (!existsSync(join(srcRoot, 'icu4c', 'source'))) {
    await download(ICU_SRC_URL, dl)
    rmSync(srcRoot, { recursive: true, force: true })
    ensureDir(srcRoot)
    run('tar', ['xzf', dl, '-C', srcRoot, '--strip-components=1'])
  } else {
    log('reuse cached source', srcRoot)
  }
  return join(srcRoot, 'icu4c', 'source')
}

function ensureIcuTools(sourceDir) {
  // 已构建过则复用
  if (existsSync(join(sourceDir, 'bin', 'icupkg')) && existsSync(join(sourceDir, 'bin', 'pkgdata'))) {
    log('reuse built icu tools')
    return
  }
  log('configure + build ICU tools (x64)')
  const prev = process.cwd()
  process.chdir(sourceDir)
  try {
    run('./runConfigureICU', ['Linux/gcc'], { env: { ...process.env } })
    run('make', ['-j', String(Math.max(2, (parseInt(process.env.nproc || '2', 10))))])
  } finally {
    process.chdir(prev)
  }
  log('icu tools ready')
}

function buildMinIcu(sourceDir) {
  const buildRoot = join(sourceDir, 'data', 'out', 'build', 'icudt78l')
  const tmpDir = join(sourceDir, 'data', 'out', 'tmp')
  if (!existsSync(buildRoot) || !existsSync(join(tmpDir, 'icudata.lst'))) {
    throw new Error('ICU build output missing; run make in icu source first')
  }
  const itemsTxt = join(tmpDir, 'icudata.lst')
  const keepList = buildKeepList(buildRoot, itemsTxt)
  log(`keep list: ${keepList.length} items (from ${itemsTxt})`)

  const minTree = join(cacheDir, 'min-icu-tree')
  stageMinTree(buildRoot, keepList, minTree)

  const minLst = join(cacheDir, 'min-icu.lst')
  writeFileSync(minLst, keepList.join('\n') + '\n')

  // 交叉打包 arm64 libicudata.so
  ensureDir(outDir)
  const icupkgInc = join(cacheDir, 'icupkg-aarch64.inc')
  const baseInc = join(sourceDir, 'data', 'icupkg.inc')
  if (existsSync(baseInc)) {
    let inc = readFileSync(baseInc, 'utf8')
    inc = inc.replace(/\bgcc\b/g, 'aarch64-linux-gnu-gcc')
    inc = inc.replace(/GENCCODE_ASSEMBLY_TYPE=-a aarch64-linux-gnu-gcc/, 'GENCCODE_ASSEMBLY_TYPE=-a gcc')
    writeFileSync(icupkgInc, inc)
  }

  const pkgOut = join(cacheDir, 'min-icu-pkgout')
  rmSync(pkgOut, { recursive: true, force: true })
  ensureDir(pkgOut)
  const ldPath = process.env.LD_LIBRARY_PATH || ''
  const env = {
    ...process.env,
    LD_LIBRARY_PATH: join(sourceDir, 'lib') + (ldPath ? ':' + ldPath : ''),
  }
  const pkgdata = join(sourceDir, 'bin', 'pkgdata')
  // -L icudata_78 → 生成 libicudata_78.so，soname=libicudata_78.so（匹配 Android jniLibs 命名）
  const args = ['-O', icupkgInc, '-m', 'dll', '-p', 'icudata', '-L', 'icudata_78', '-s', minTree, '-d', pkgOut, '-e', 'icudt78', minLst]
  run(pkgdata, args, { env })

  const srcSo = join(pkgOut, 'libicudata_78.so')
  if (!existsSync(srcSo)) throw new Error('pkgdata did not produce libicudata_78.so')
  const destSo = join(outDir, 'libicudata.so')
  copyFileSync(srcSo, destSo)
  chmodSync(destSo, 0o755)
  log('min icu ready:', destSo, `${(statSync(destSo).size / 1048576).toFixed(1)} MB`)
}

async function main() {
  if (!aarch64GccAvailable()) {
    throw new Error('缺少 aarch64-linux-gnu-gcc（apt install gcc-aarch64-linux-gnu）')
  }
  ensureDir(cacheDir)
  const sourceDir = await ensureIcuSource()
  if (process.env.SKIP_ICU_BUILD !== '1') {
    ensureIcuTools(sourceDir)
  }
  buildMinIcu(sourceDir)
  log('done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
