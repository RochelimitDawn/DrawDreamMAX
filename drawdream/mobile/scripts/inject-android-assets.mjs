#!/usr/bin/env node
/**
 * 1) Node + 共享库 → jniLibs/arm64-v8a（可执行；规避 files/ noexec）
 * 2) agent/ui → assets/runtime.zip（不含 bin/lib）
 *
 *   node mobile/scripts/prepare-runtime.mjs
 *   node mobile/scripts/inject-android-assets.mjs
 */
import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  readdirSync,
  copyFileSync,
  cpSync,
  chmodSync,
  lstatSync,
  writeFileSync,
  realpathSync,
  createWriteStream,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const runtime = join(mobileRoot, 'runtime')
const assetsDir = join(mobileRoot, 'android/app/src/main/assets')
const jniDir = join(mobileRoot, 'android/app/src/main/jniLibs/arm64-v8a')
const zipPath = join(assetsDir, 'runtime.zip')
const NODE_JNI = 'libdrawdream_node.so'

/** 仅保留 Node 运行所需 so 前缀（去掉 icutest 等） */
const KEEP_LIB_PREFIXES = [
  'libz',
  'libcares',
  'libsqlite',
  'libffi',
  'libcrypto',
  'libssl',
  'libicuuc',
  'libicui18n',
  'libicudata',
  'libc++_shared',
  'libandroid-support',
]

function log(...a) {
  console.log('[inject]', ...a)
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts })
}

function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}

/** libcrypto.so.3 -> libcrypto_3.so；libfoo.so -> libfoo.so */
function toJniSoName(name) {
  const m = name.match(/^(lib.+)\.so\.(.+)$/)
  if (m) return `${m[1]}_${m[2].replace(/\./g, '_')}.so`
  if (name.endsWith('.so')) return name.startsWith('lib') ? name : `lib${name}`
  return `lib${name.replace(/[^a-zA-Z0-9]+/g, '_')}.so`
}

function shouldKeepLib(name) {
  const base = name.replace(/\.so(\..*)?$/, '')
  return KEEP_LIB_PREFIXES.some((p) => base === p || base.startsWith(p))
}

function listLibEntries(libDir) {
  /** @type {{orig:string, real:string}[]} */
  const out = []
  if (!existsSync(libDir)) return out
  for (const name of readdirSync(libDir)) {
    if (!name.includes('.so')) continue
    if (!shouldKeepLib(name)) continue
    const p = join(libDir, name)
    let lst
    try {
      lst = lstatSync(p)
    } catch {
      continue
    }
    try {
      const real = lst.isSymbolicLink() ? realpathSync(p) : p
      if (!existsSync(real) || !statSync(real).isFile()) continue
      out.push({ orig: name, real })
    } catch {
      /* dangling */
    }
  }
  return out
}

function pickCanonicalName(origNames) {
  // 优先带版本后缀的 soname（libfoo.so.3），再 libfoo.so
  const versioned = origNames.filter((n) => /\.so\.\d/.test(n))
  if (versioned.length) {
    versioned.sort((a, b) => b.length - a.length)
    return versioned[0]
  }
  const plain = origNames.filter((n) => n.endsWith('.so') && !n.includes('.so.'))
  if (plain.length) return plain.sort((a, b) => a.length - b.length)[0]
  return origNames[0]
}

function stageJniLibs() {
  const srcNode = join(runtime, 'bin', 'node')
  const srcLib = join(runtime, 'lib')
  if (!existsSync(srcNode)) {
    throw new Error(`缺少 ${srcNode}，请先 prepare-runtime（arm64/android node）`)
  }

  rmSync(jniDir, { recursive: true, force: true })
  mkdirSync(jniDir, { recursive: true })

  const entries = listLibEntries(srcLib)
  /** contentHash -> { jniName, real, origNames: string[] } */
  const byHash = new Map()
  for (const { orig, real } of entries) {
    const h = sha256File(real)
    if (!byHash.has(h)) {
      byHash.set(h, { real, origNames: [orig] })
    } else {
      byHash.get(h).origNames.push(orig)
    }
  }

  /** origName -> jniName */
  const rename = new Map()
  /** jniName -> real path */
  const jniFiles = new Map()

  for (const group of byHash.values()) {
    const canonOrig = pickCanonicalName(group.origNames)
    let jni = toJniSoName(canonOrig)
    if (!jni.startsWith('lib')) jni = `lib${jni}`
    if (jni === NODE_JNI) jni = 'libdrawdream_node_dep.so'
    // 冲突则加短 hash
    if (jniFiles.has(jni) && jniFiles.get(jni) !== group.real) {
      jni = jni.replace(/\.so$/, `_${sha256File(group.real).slice(0, 6)}.so`)
    }
    jniFiles.set(jni, group.real)
    for (const o of group.origNames) rename.set(o, jni)
  }

  for (const [jni, abs] of jniFiles) {
    const dest = join(jniDir, jni)
    copyFileSync(abs, dest)
    chmodSync(dest, 0o755)
  }

  const nodeDest = join(jniDir, NODE_JNI)
  copyFileSync(srcNode, nodeDest)
  chmodSync(nodeDest, 0o755)

  // 额外别名：libfoo.so 与 libfoo.so.N 若未在 rename 中，映射到同前缀 jni
  for (const [orig, jni] of [...rename.entries()]) {
    const plain = orig.replace(/\.so\..+$/, '.so')
    if (plain !== orig && !rename.has(plain)) rename.set(plain, jni)
  }

  const allBins = [nodeDest, ...[...jniFiles.keys()].map((n) => join(jniDir, n))]
  const pairs = [...rename.entries()].filter(([a, b]) => a !== b)

  for (const bin of allBins) {
    run('patchelf', ['--set-rpath', '$ORIGIN', bin])
    for (const [from, to] of pairs) {
      run('patchelf', ['--replace-needed', from, to, bin])
    }
    // soname 与文件名一致，避免 loader 困惑
    const base = bin.split('/').pop()
    if (base && base !== NODE_JNI) {
      run('patchelf', ['--set-soname', base, bin])
    }
  }

  const needed = run('patchelf', ['--print-needed', nodeDest])
  log('node NEEDED:\n' + (needed.stdout || '').trim())

  const meta = {
    nodeJni: NODE_JNI,
    rename: Object.fromEntries(rename),
    files: readdirSync(jniDir),
    totalMb: (
      readdirSync(jniDir).reduce((s, n) => s + statSync(join(jniDir, n)).size, 0) /
      1024 /
      1024
    ).toFixed(1),
  }
  writeFileSync(join(runtime, 'JNI_LIBS.json'), JSON.stringify(meta, null, 2))
  mkdirSync(assetsDir, { recursive: true })
  writeFileSync(
    join(assetsDir, 'native-node.json'),
    JSON.stringify({ nodeJni: NODE_JNI, abi: 'arm64-v8a' }, null, 2),
  )
  log('jniLibs', jniDir, 'files=', meta.files.length, 'sizeMB=', meta.totalMb)
}

function packRuntimeZip() {
  mkdirSync(assetsDir, { recursive: true })
  rmSync(zipPath, { force: true })

  const staging = join(mobileRoot, '.cache', 'runtime-zip-staging')
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  for (const name of ['agent', 'ui', 'VERSION.json', 'ANDROID_NODE.json', 'JNI_LIBS.json']) {
    const from = join(runtime, name)
    if (!existsSync(from)) {
      if (name === 'agent' || name === 'ui' || name === 'VERSION.json') {
        throw new Error(`runtime 缺少 ${name}`)
      }
      continue
    }
    cpSync(from, join(staging, name), { recursive: true })
  }

  // 用 python zipfile，排除 node_modules 里无用大缓存；保留运行所需
  const py = `
import os, zipfile
staging = ${JSON.stringify(staging)}
out = ${JSON.stringify(zipPath)}
skip_parts = {'.git', '__pycache__', '.cache'}
must = [
    'agent/mobile-entry.mjs',
    'agent/server/main.ts',
    'agent/server/user-host.ts',
    'agent/node_modules/@drawdream/agent-runtime/package.json',
    'agent/node_modules/@drawdream/agent-runtime/dist/web.js',
    'agent/node_modules/@drawdream/agent-runtime/dist/index.js',
    'agent/node_modules/@drawdream/ai/dist/index.js',
    'agent/node_modules/@drawdream/agent-core/dist/index.js',
    'ui/index.html',
]
count = 0
written = set()
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, dirs, files in os.walk(staging):
        dirs[:] = [d for d in dirs if d not in skip_parts]
        for f in files:
            path = os.path.join(root, f)
            arc = os.path.relpath(path, staging).replace(os.sep, '/')
            z.write(path, arc)
            written.add(arc)
            count += 1
missing = [m for m in must if m not in written]
if missing:
    raise SystemExit('runtime.zip missing required files:\\n  - ' + '\\n  - '.join(missing))
print(f'files={count}')
print('zip_ok web.js present')
`
  const r = run('python3', ['-c', py], { stdio: 'inherit' })
  if (r.status !== 0 || !existsSync(zipPath)) {
    throw new Error('打包 runtime.zip 失败')
  }
  const mb = (statSync(zipPath).size / 1024 / 1024).toFixed(1)
  log('wrote', zipPath, `${mb} MB (agent+ui only)`)
}

function main() {
  if (!existsSync(join(runtime, 'VERSION.json'))) {
    console.error('缺少 mobile/runtime，请先: node mobile/scripts/prepare-runtime.mjs')
    process.exit(1)
  }
  if (run('patchelf', ['--version']).status !== 0) {
    console.error('需要 patchelf：sudo apt-get install -y patchelf')
    process.exit(1)
  }
  stageJniLibs()
  if (process.env.INJECT_SKIP_ZIP === '1') {
    log('INJECT_SKIP_ZIP=1, skip runtime.zip')
  } else {
    packRuntimeZip()
  }
  log('done')
}

main()
