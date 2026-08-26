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

// ── 官方 UI 最小激活集（Step 7·对话闭环攻坚）──────────────────────────
// ipc-connection 独占 connection 服务；client-connection 仅作 require 依赖（不置 immediately）。
function entryOf(id) {
  const entry = graph.entries.find((e) => e.id === id)
  assert.ok(entry, `图谱缺少激活集条目: ${id}`)
  return entry
}
for (const must of [
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-remotes',
  '@dsh-desktop/ipc-connection',
]) {
  entryOf(must)
}

// 依赖边：api-gateway 注入 typert+connection，api-remotes 注入 remote
assert.deepEqual(entryOf('@deepseek-ai/dsh-api-gateway').inject, ['typert', 'connection'], 'api-gateway inject 应为 [typert, connection]')
assert.deepEqual(entryOf('@deepseek-ai/dsh-api-remotes').inject, ['remote'], 'api-remotes inject 应为 [remote]')
// ipc-connection：external 依赖 client-connection/client（基类继承），且应 immediately 激活
assert.deepEqual(entryOf('@dsh-desktop/ipc-connection').external, ['@deepseek-ai/dsh-client-connection/client'], 'ipc-connection external 应指向 client-connection/client')
assert.strictEqual(entryOf('@dsh-desktop/ipc-connection').immediately, true, 'ipc-connection 应 immediately 激活')
// client-connection：仅模块依赖，不置 immediately（避免 connection 服务冲突）
assert.strictEqual(entryOf('@deepseek-ai/dsh-client-connection').immediately, undefined, 'client-connection 不应 immediately（connection 由 ipc-connection 独占）')

// ── 官方 web-frontend dist 加载路径（R5 修复后）──────────────────────
// 官方 dist 资源使用根绝对路径（/assets/...）。在固定虚拟 host `dsh-ui://app` 布局下，
// resolveRelative 仅取 pathname 映射到 dist 根（rel = 去掉前导 `/`）。
// 这里断言：dist 已落盘、index.html 引用的每个资源都在 dist 根真实存在。
const fwPkg = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'package.json')
assert.ok(fs.existsSync(fwPkg), `官方 dist 包缺失: ${fwPkg}`)
const fwDist = path.join(path.dirname(fwPkg), 'dist')
const fwIndexPath = path.join(fwDist, 'index.html')
assert.ok(fs.existsSync(fwIndexPath), `官方 dist index.html 缺失: ${fwIndexPath}`)
const fwHtml = fs.readFileSync(fwIndexPath, 'utf8')

// 提取 dist/index.html 引用的根绝对路径资源（src/href）
const refs = [...fwHtml.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1])
const uniqueRefs = [...new Set(refs)]
assert.ok(uniqueRefs.length > 0, '官方 index.html 应引用至少一个静态资源')
assert.ok(uniqueRefs.every((r) => r.startsWith('/')), '官方 dist 关键资源应为根绝对路径（空 host 布局依赖此语义）')
assert.ok(uniqueRefs.includes('/manifest.webmanifest'), '官方 index.html 应引用 /manifest.webmanifest')
assert.ok(uniqueRefs.some((r) => r.startsWith('/assets/index-')), '官方 index.html 应引用 /assets/index-*.js')

// 每个引用在 dist 根下真实存在（resolveRelative 空 host 分支映射结果）
for (const ref of uniqueRefs) {
  const rel = decodeURIComponent(ref).replace(/^\/+/, '')
  const target = path.join(fwDist, rel)
  assert.ok(fs.existsSync(target), `官方 dist 引用资源缺失: ${ref} → ${target}`)
}
console.log(`   官方 dist 资源引用: ${uniqueRefs.join(', ')} (共 ${uniqueRefs.length} 项，全部落盘)`)

console.log('✅ 零端口 bundle spike（方案 A）验证通过')
console.log(`   图谱条目: ${ids.join(', ')}`)
console.log(`   样例 bundle route: /plugins/${sampleId}/client.js → ${bundle.body.length} bytes`)
