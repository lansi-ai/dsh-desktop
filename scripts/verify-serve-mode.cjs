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
// 期望结构随 src/desktop-shell/argv.ts 的 CliOptions 对齐：M4 新增 --hidden /
// --select-data-dir 后 parseArgv 恒返回 { serve, servePort, hidden, selectDataDir }。

function testParse(label, argv, expected) {
  const got = argvMod.parseArgv(argv)
  assert.deepEqual(got, expected, `${label}: parseArgv(${JSON.stringify(argv)}) 不符`)
  console.log(`   ✓ ${label}: ${JSON.stringify(argv)} → ${JSON.stringify(got)}`)
}

const base = { hidden: false, selectDataDir: false }

testParse('默认无参数', ['electron', 'app'], { serve: false, servePort: 38000, ...base })
testParse('--serve 无参', ['electron', 'app', '--serve'], { serve: true, servePort: 38000, ...base })
testParse('--serve=5173 等号', ['electron', 'app', '--serve=5173'], { serve: true, servePort: 5173, ...base })
testParse('--serve 5173 空格', ['electron', 'app', '--serve', '5173'], { serve: true, servePort: 5173, ...base })
testParse('--serve=65535 上限', ['electron', 'app', '--serve=65535'], { serve: true, servePort: 65535, ...base })
testParse('--serve=0 非法值回退默认', ['electron', 'app', '--serve=0'], { serve: true, servePort: 38000, ...base })
testParse('--serve=-1 非法值回退默认', ['electron', 'app', '--serve=-1'], { serve: true, servePort: 38000, ...base })
testParse('--hidden 静默', ['electron', 'app', '--hidden'], { serve: false, servePort: 38000, hidden: true, selectDataDir: false })
testParse('--select-data-dir 重选目录', ['electron', 'app', '--select-data-dir'], { serve: false, servePort: 38000, hidden: false, selectDataDir: true })
testParse('其他参数忽略', ['electron', 'app', '--serve', '4321', '--foo', 'bar'], { serve: true, servePort: 4321, ...base })

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

// 0.1.2 IPC 载波替换后的传输层断言（对齐 boot.ts §3 现状）：
//   - host-connection 激活（createSharedFetchHandler 是桌面传输背板核心，不再禁用）；
//   - client-runtime 已随上游删除（无此行）；client-hmr / cordis-client-runner /
//     cordis-host-runner 仍 disabled（IPC 载波替代）。
const hostConnection = findById('host-connection')
const clientHmr = findById('client-hmr')
const cordisClientRunner = findById('cordis-client-runner')
const cordisHostRunner = findById('cordis-host-runner')
assert.ok(hostConnection !== undefined && hostConnection.disabled !== true, 'host-connection 应激活（IPC 载波背板）')
assert.ok(findById('client-runtime') === undefined, 'client-runtime 应已删除（0.1.2 上游移除）')
assert.ok(clientHmr !== undefined && clientHmr.disabled === true, 'client-hmr 应为 disabled')
assert.ok(cordisClientRunner !== undefined && cordisClientRunner.disabled === true, 'cordis-client-runner 应为 disabled')
assert.ok(cordisHostRunner !== undefined && cordisHostRunner.disabled === true, 'cordis-host-runner 应为 disabled')
console.log('   ✓ host-connection 激活 + client-runtime 已删 + runner 三行 disabled（IPC 载波替换成立）')

console.log('')
console.log('✅ Step 6·零端口 + --serve 兼容模式冒烟通过')
console.log('   - parseArgv 行为矩阵全部符合预期')
console.log('   - 默认 DESKTOP_OVERLAY_PATCHES 已禁用 Web 传输层（零端口红线 R-03 成立）')
console.log('   - 实际端口监听/未监听核验：需在 Electron 启动后用 netstat 确认')
