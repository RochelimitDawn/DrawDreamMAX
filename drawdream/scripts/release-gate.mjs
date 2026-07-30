import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const agent = join(root, 'agent')
const codingAgent = join(agent, 'packages', 'coding-agent')

function run(command, args, cwd = root) {
  process.stdout.write(`\n[gate] ${command} ${args.join(' ')}\n`)
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

function assert(condition, message) {
  if (!condition) throw new Error(`[gate] ${message}`)
}

assert(Number(process.versions.node.split('.')[0]) >= 22, 'Node.js 22 or newer is required')
assert(existsSync(join(root, 'dist', 'index.html')), 'frontend dist/index.html is missing; build must run first')

run('npx', ['tsc', '--noEmit'], agent)
run('node', ['--test', 'test/card.test.ts', 'test/cardBridge.test.ts', 'test/tavern-prompt.test.ts', 'test/tavern-runtime-adapter.test.ts', 'test/swipe.test.ts', 'test/hybrid-extension.test.ts'], agent)
run('npm', ['run', 'build'], codingAgent)
run('npm', ['run', 'build'], root)
run('git', ['diff', '--check'], root)

const androidMain = readFileSync(join(root, 'mobile/android/app/src/main/java/com/drawdream/app/MainActivity.kt'), 'utf8')
assert(androidMain.includes('uri?.port == -1 || uri.port == 7620'), 'Android WebView must restrict local navigation to port 7620')
assert(androidMain.includes('host == "127.0.0.1" || host == "localhost"'), 'Android WebView must restrict navigation to loopback hosts')

const bridge = readFileSync(join(root, 'src/utils/cardBridge.ts'), 'utf8')
assert(bridge.includes("'module.authorize'"), 'module authorization bridge request is missing')
assert(bridge.includes("'external.module'"), 'external.module capability is missing')
assert(!bridge.includes('eval('), 'Card Bridge must not expose eval')

const assets = readFileSync(join(root, 'src/tavern/card-assets.ts'), 'utf8')
assert(assets.includes("Only HTTPS external assets are allowed"), 'external assets must require HTTPS')
assert(assets.includes("path escapes card workspace"), 'asset path traversal guard is missing')

process.stdout.write('\n[gate] release gate passed; Android device and offline-cache tests require a real Android runtime.\n')
