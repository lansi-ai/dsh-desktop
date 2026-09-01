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

// ── 官方 UI 自动扫描图谱（攻坚第 2 批·自动扫描方案）────────────────────
// 复刻官方 ClientModuleRegistry：从 node_modules/@deepseek-ai 自动发现全部 dsh.client 包
// （含全部 ui-* 客户端插件），client-connection 剔除出图谱（D-9：官方驱动全量激活会抢走
// connection），ipc-connection 独占 connection 服务。
function entryOf(id) {
  const entry = graph.entries.find((e) => e.id === id)
  assert.ok(entry, `图谱缺少激活集条目: ${id}`)
  return entry
}
for (const must of [
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-runtime',
  '@lansi-ai/dsh-ipc-connection',
]) {
  entryOf(must)
}

// 依赖边（官方 dsh.client.inject 为模块加载依赖，用完整包名而非 service 名）：
// api-gateway 依赖 typert-registry + client-connection（连接基类），api-remotes 依赖 api-gateway
assert.deepEqual(entryOf('@deepseek-ai/dsh-api-gateway').inject, ['@deepseek-ai/dsh-typert-registry', '@deepseek-ai/dsh-client-connection'], 'api-gateway inject 应为官方声明 [typert-registry, client-connection]')
assert.deepEqual(entryOf('@deepseek-ai/dsh-api-remotes').inject, ['@deepseek-ai/dsh-api-gateway'], 'api-remotes inject 应为 [api-gateway]')
// ipc-connection：external 依赖 client-connection/client（基类继承），且应 immediately 激活
assert.deepEqual(entryOf('@lansi-ai/dsh-ipc-connection').external, ['@deepseek-ai/dsh-client-connection/client'], 'ipc-connection external 应指向 client-connection/client')
assert.strictEqual(entryOf('@lansi-ai/dsh-ipc-connection').immediately, true, 'ipc-connection 应 immediately 激活')

// 自动扫描应含全部 ui-* 客户端插件（官方 UI 渲染必需：ui-renderer 提供 mountApp 的服务）
const uiIds = graph.entries.map((e) => e.id).filter((id) => id.toLowerCase().includes('ui-'))
assert.ok(uiIds.length >= 20, `自动扫描应发现 >=20 个 ui-* 插件，实际 ${uiIds.length}`)
entryOf('@deepseek-ai/dsh-client-ui-renderer')
entryOf('@deepseek-ai/dsh-client-ui-conversation')
entryOf('@deepseek-ai/dsh-client-ui-layout')
entryOf('@deepseek-ai/dsh-client-ui-sidebar')

// client-connection：**不入图谱**（官方驱动全量激活会抢走 connection 服务），
// 仅登记为图谱外预载注册模块（PRELOAD_ONLY），供 ipc-connection require 继承基类。
const ccId = '@deepseek-ai/dsh-client-connection'
assert.strictEqual(graph.entries.find((e) => e.id === ccId), undefined, 'client-connection 不应在图谱 entries（否则被官方驱动激活）')
bootGraph.registerPreloadOnly()
const ccPath = bootGraph.resolveBundlePath(ccId)
assert.ok(ccPath !== undefined && fs.existsSync(ccPath), 'client-connection 应登记 bundle 路径')
const ccBundle = bootGraph.resolveBundleRequest(`/plugins/${ccId}/client.js`)
assert.ok(ccBundle, 'client-connection 应能被 bundle route 直读（预载注册）')
// 注入脚本应带出 client-connection 预载 script（仅注册 factory，不入图谱）
const fullScript = bootGraph.generateFullBootScript('desktop-m1-ipc-test', [{ id: sampleId, path: samplePath }])
assert.ok(fullScript.includes(`/plugins/${ccId}/client.js?rev=`), '注入脚本应预载 client-connection 基类（PRELOAD_ONLY）')
assert.ok(fullScript.includes(`"id":"${ccId}"`) === false, '注入脚本图谱不应含 client-connection 条目')
assert.ok(fullScript.includes('@deepseek-ai/dsh-client-ui-renderer/client.js'), '注入脚本应预载/含 ui-renderer 客户端插件')

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

// ── M1 门禁·第三方 client 插件无改动装载（ADR-007 方案 A 协议直读）────────
// 第三方插件（@lnyanhongyan/dsh-opencode-usage）不在 @deepseek-ai 自动扫描 scope，
// 经 buildThirdPartyBundleDecl 声明装载：读 dsh.client 声明 + exports["./client"] 解析 bundle。
const thirdPartyId = '@lnyanhongyan/dsh-opencode-usage'
const tpHostDecl = bootGraph.buildThirdPartyBundleDecl(thirdPartyId)
assert.ok(tpHostDecl.path.endsWith(path.join('lib', 'client.js')), `第三方 bundle 应指向 lib/client.js: ${tpHostDecl.path}`)
assert.ok(fs.existsSync(tpHostDecl.path), `第三方 bundle 缺失: ${tpHostDecl.path}`)
assert.deepEqual(tpHostDecl.inject, [
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-locale',
], '第三方 dsh.client.inject 应为官方槽位依赖')
assert.strictEqual(tpHostDecl.immediately, true, '第三方插件应立即激活')

// 图谱应包含第三方条目，且 bundle route 能直读其产物（方案 A 装载路径）
const tpGraph = bootGraph.generateBootGraph('desktop-m1-ipc-test', [tpHostDecl])
const tpEntry = tpGraph.entries.find((e) => e.id === thirdPartyId)
assert.ok(tpEntry, '图谱应包含第三方插件条目')
assert.equal(tpEntry.url, `/plugins/${thirdPartyId}/client.js?rev=${tpEntry.rev}`)
const tpBundle = bootGraph.resolveBundleRequest(`/plugins/${thirdPartyId}/client.js`)
assert.ok(tpBundle, 'bundle route 应返回第三方 bundle')
assert.ok(tpBundle.body.toString().includes('__ModuleLoader__'), '第三方 bundle 应注册到 __ModuleLoader__')
assert.ok(tpBundle.body.toString().includes('settings.section'), '第三方 bundle 应注册 settings.section 槽位')
console.log(`   第三方插件无改动装载: /plugins/${thirdPartyId}/client.js → ${tpBundle.body.length} bytes`)

console.log('✅ 零端口 bundle spike（方案 A）验证通过')
console.log(`   图谱条目: ${ids.join(', ')}`)
console.log(`   样例 bundle route: /plugins/${sampleId}/client.js → ${bundle.body.length} bytes`)
