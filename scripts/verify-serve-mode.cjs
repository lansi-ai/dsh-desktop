/**
 * Step 6·零端口验证 + --serve 兼容模式冒烟脚本。
 *
 * 验证目标（沙箱内逻辑验证，实际端口监听需在 Electron 启动后 `netstat` 核验）：
 *   1. parseArgv 在三种输入下产生正确的 CliOptions：
 *      - 默认模式（零端口，portless）
 *      - --serve 无参 → 默认端口 38000
 *      - --serve=5173 等号形式
 *      - --serve 5173 空格形式
 *   2. 默认 DESKTOP_OVERLAY_PATCHES 栈中 webserver/web-runtime/web-startup 均为 disabled
 *      （零端口红线 R-03 保证：不传 --serve 时不会监听 HTTP 端口）。
 *
 * 运行：`npm run build && node scripts/verify-serve-mode.cjs`
 */

const assert = require('node:assert')
const path = require('node:path')

const root = path.join(__dirname, '..')
const argvMod = require(path.join(root, 'dist', 'desktop-shell', 'argv.js'))
const hostMod = require(path.join(root, 'dist', 'desktop-host', 'boot.js'))

// ── 1. argv parser 行为矩阵 ────────────────────────────────────────────

function testParse(label, argv, expected) {
  const got = argvMod.parseArgv(argv)
  assert.deepEqual(got, expected, `${label}: parseArgv(${JSON.stringify(argv)}) 不符`)
  console.log(`   ✓ ${label}: ${JSON.stringify(argv)} → ${JSON.stringify(got)}`)
}

testParse('默认无参数', ['electron', 'app'], { serve: false, servePort: 38000 })
testParse('--serve 无参', ['electron', 'app', '--serve'], { serve: true, servePort: 38000 })
testParse('--serve=5173 等号', ['electron', 'app', '--serve=5173'], { serve: true, servePort: 5173 })
testParse('--serve 5173 空格', ['electron', 'app', '--serve', '5173'], { serve: true, servePort: 5173 })
testParse('--serve=65535 上限', ['electron', 'app', '--serve=65535'], { serve: true, servePort: 65535 })
testParse('--serve=0 非法值回退默认', ['electron', 'app', '--serve=0'], { serve: true, servePort: 38000 })
testParse('--serve=-1 非法值回退默认', ['electron', 'app', '--serve=-1'], { serve: true, servePort: 38000 })
testParse('其他参数忽略', ['electron', 'app', '--serve', '4321', '--foo', 'bar'], { serve: true, servePort: 4321 })

// ── 2. 默认补丁栈禁用 Web 传输层（零端口红线） ────────────────────────
const patches = hostMod.getDesktopOverlayPatches()
assert.ok(Array.isArray(patches), 'DESKTOP_OVERLAY_PATCHES 应为数组')

function findById(id) {
  // 顶层 id 字段或 insert 内部的 id 均查找
  for (const patch of patches) {
    if (patch && typeof patch === 'object') {
      if (patch.id === id) return patch
      if (Array.isArray(patch.insert)) {
        const found = patch.insert.find((x) => x && x.id === id)
        if (found) return found
      }
    }
  }
  return undefined
}

const webserver = findById('webserver')
const webRuntime = findById('web-runtime')
const webStartup = findById('web-startup')

assert.ok(webserver !== undefined, '补丁栈应包含 webserver 条目')
assert.ok(webRuntime !== undefined, '补丁栈应包含 web-runtime 条目')
assert.ok(webStartup !== undefined, '补丁栈应包含 web-startup 条目')
assert.strictEqual(webserver.disabled, true, 'webserver 默认应为 disabled（零端口红线）')
assert.strictEqual(webRuntime.disabled, true, 'web-runtime 默认应为 disabled（零端口红线）')
assert.strictEqual(webStartup.disabled, true, 'web-startup 默认应为 disabled（零端口红线）')
console.log('   ✓ 默认补丁栈：webserver/web-runtime/web-startup 均为 disabled（零端口 R-03 红线成立）')

// IPC 载波变体仍在列（connection/client-runtime 被禁用 → 走 IPC 桥）。
const connection = findById('connection')
const clientRuntime = findById('client-runtime')
assert.ok(connection !== undefined && connection.disabled === true, 'connection 应为 disabled（IPC 载波变体替代）')
assert.ok(clientRuntime !== undefined && clientRuntime.disabled === true, 'client-runtime 应为 disabled（IPC 载波变体替代）')
console.log('   ✓ connection/client-runtime 已禁用（IPC 载波变体替换生效）')

console.log('')
console.log('✅ Step 6·零端口 + --serve 兼容模式冒烟通过')
console.log('   - parseArgv 行为矩阵全部符合预期')
console.log('   - 默认 DESKTOP_OVERLAY_PATCHES 已禁用 Web 传输层（零端口红线 R-03 成立）')
console.log('   - 实际端口监听/未监听核验：需在 Electron 启动后用 netstat 确认')
