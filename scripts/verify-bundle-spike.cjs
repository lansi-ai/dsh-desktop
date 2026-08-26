/**
 * Step 5·零端口 bundle spike（方案 A）自动化验证脚本。
 *
 * 在沙箱（无 Electron 运行时）内验证：
 * 1. `__DSH_BOOT__` 图谱含官方基础插件 + 样例插件，且每条 entry 的 url/rev 符合官方 wire 语义
 * 2. 样例句 bundle 能被 `dsh-ui://plugins/<id>/client.js` bundle route 正确读回（方案 A 装载路径）
 * 3. 官方格式 HTML 注入脚本包含 queue shim + parser 预载 + `__DSH_BOOT__`
 *
 * 运行：`npm run build && node scripts/verify-bundle-spike.cjs`
 */

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const bootGraph = require(path.join(root, 'dist', 'desktop-host', 'boot-graph.js'))

const sampleId = 'dsh-spike-sample'
const samplePath = path.join(root, 'dist', 'desktop-shell', 'web', 'dsh-spike-sample.js')
assert.ok(fs.existsSync(samplePath), `样例 bundle 缺失: ${samplePath}`)

const graph = bootGraph.generateBootGraph('desktop-m1-ipc-test', [{ id: sampleId, path: samplePath }])

// 1. 图谱含官方基础插件 + 样例插件
const ids = graph.entries.map((entry) => entry.id)
for (const must of ['@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-runtime', sampleId]) {
  assert.ok(ids.includes(must), `图谱缺少 ${must}`)
}

// 2. 每条 entry 有 url + rev，url 指向 /plugins/<id>/client.js?rev=
for (const entry of graph.entries) {
  assert.equal(entry.url, `/plugins/${entry.id}/client.js?rev=${entry.rev}`, `${entry.id} url 不符`)
  assert.equal(entry.rev.length, 12, `${entry.id} rev 应为 12 位 hex`)
}

// 3. bundle route 能读回样例 bundle（模拟协议请求：URL.pathname 不含 query）
const bundle = bootGraph.resolveBundleRequest(`/plugins/${sampleId}/client.js`)
assert.ok(bundle, 'bundle route 应返回样例 bundle')
assert.ok(bundle.contentType.includes('text/javascript'), 'bundle contentType 应为 JS')
const bundleText = bundle.body.toString()
assert.ok(bundleText.includes(sampleId), 'bundle 内容应包含样例 id')
assert.ok(bundleText.includes('__ModuleLoader__'), 'bundle 应注册到 __ModuleLoader__')

// 4. resolveBundlePath 能查到样例 bundle 绝对路径
assert.equal(bootGraph.resolveBundlePath(sampleId), samplePath)

// 5. 注入脚本包含 queue shim + parser 预载 + __DSH_BOOT__
const script = bootGraph.generateFullBootScript('desktop-m1-ipc-test', [{ id: sampleId, path: samplePath }])
assert.ok(script.includes('window.__ModuleLoader__'), '注入脚本应含 queue shim')
assert.ok(script.includes('@deepseek-ai/dsh-client-modules/client.js'), '注入脚本应预载 client-modules')
assert.ok(script.includes('@deepseek-ai/dsh-client-runtime/client.js'), '注入脚本应预载 client-runtime')
assert.ok(script.includes('window.__DSH_BOOT__'), '注入脚本应含 __DSH_BOOT__')
assert.ok(script.includes(`"id":"${sampleId}"`), '注入脚本图谱应包含样例插件')

console.log('✅ 零端口 bundle spike（方案 A）验证通过')
console.log(`   图谱条目: ${ids.join(', ')}`)
console.log(`   样例 bundle route: /plugins/${sampleId}/client.js → ${bundle.body.length} bytes`)
