/**
 * 路线 A 最小实证：验证 ipc-connection 的 bundle `require` 链路。
 *
 * Step 0：官方 client-connection bundle 自包含 AbstractApiClient 并可继承（已通过）。
 * Step 1：模拟 client 模块系统的 makeRequire（stripClientSuffix + 注册表解析），
 *          让 ipc-connection 的 factory 在同步 require('@deepseek-ai/dsh-client-connection/client')
 *          时解析到已注册的 client-connection 工厂，materialize 后拿到 AbstractApiClient，
 *          并确认 IPC 子类可实例化、exports.apply 可作为 connection 服务提供。
 *
 * 运行：node scripts/verify-ipc-carrier.cjs
 */
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')

/** 读取官方 client-connection bundle 文本。 */
function readClientConnectionSrc() {
  const p = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-connection', 'lib', 'client.js')
  assert.ok(fs.existsSync(p), `client-connection bundle 缺失: ${p}`)
  return fs.readFileSync(p, 'utf8')
}

/** 读取我们的 ipc-connection bundle 文本（src/desktop-shell/web/）。 */
function readIpcConnectionSrc() {
  const p = path.join(root, 'src', 'desktop-shell', 'web', 'ipc-connection.js')
  assert.ok(fs.existsSync(p), `ipc-connection bundle 缺失: ${p}`)
  return fs.readFileSync(p, 'utf8')
}

/**
 * 在浏览器沙箱里执行一个 bundle，捕获其 factory（window.__ModuleLoader__.load）。
 * @param {string} src bundle 源码
 * @returns {Map<string, Function>} id → factory
 */
function registerBundle(src) {
  const registrations = new Map()
  const __ModuleLoader__ = {
    mode: 'queue',
    pendingQueue: [],
    load(reg) {
      registrations.set(reg.id, reg.factory)
    },
    create() {
      throw new Error('create 不在本实证范围内')
    },
  }
  const sandbox = {
    window: {
      __ModuleLoader__,
      // preload 白名单桥 stub：验证 doFetch 信封透传 + server-response 包装。
      desktopBridge: {
        request: async (envelope) => ({ data: { echoedRpcId: envelope.rpcId }, rpcId: envelope.rpcId }),
        rpc: async () => ({}),
        onFrame: () => () => {},
        respond: async () => ({ accepted: true }),
      },
    },
    // vm context 隔离于宿主 global；注入 bundle 可能引用的浏览器/平台全局面。
    URL,
    URLSearchParams,
    Response,
    AbortSignal,
    AbortController,
    TextEncoder,
    TextDecoder,
    crypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  }
  const context = vm.createContext(sandbox)
  vm.runInContext(src, context)
  return { registrations, window: sandbox.window }
}

/** 模拟 client 模块系统的同步 makeRequire（对齐 ClientModuleSystem.makeRequire）。 */
function makeRequire(factories) {
  return (spec) => {
    // stripClientSuffix：'@deepseek-ai/dsh-client-connection/client' → 包 id
    const id = spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec
    const factory = factories.get(id)
    assert.ok(factory, `同步 require 未找到已注册模块: ${spec}（需先 arrive 注册其工厂）`)
    // materialize：factory(require) 返回 exports
    const requireStub = () => {
      throw new Error(`意外的嵌套 require: ${spec}`)
    }
    return factory(requireStub)
  }
}

// ── 注册两个 bundle ──────────────────────────────────────────────────
const facts = new Map()
let sandboxRef = null
for (const src of [readClientConnectionSrc(), readIpcConnectionSrc()]) {
  const { registrations, window: w } = registerBundle(src)
  for (const [id, factory] of registrations) facts.set(id, factory)
  sandboxRef = { window: w }
}
assert.ok(facts.has('@deepseek-ai/dsh-client-connection'), 'client-connection 工厂已注册')
assert.ok(facts.has('@dsh-desktop/ipc-connection'), 'ipc-connection 工厂已注册')

// ── materialize ipc-connection：其中的 require('@deepseek-ai/dsh-client-connection/client')
//    经 makeRequire 解析到 client-connection 工厂并拿到 AbstractApiClient ──
const ipcFactory = facts.get('@dsh-desktop/ipc-connection')
const ipcExports = ipcFactory(makeRequire(facts))

assert.equal(typeof ipcExports.apply, 'function', 'ipc-connection 应导出 apply')
assert.deepEqual(ipcExports.inject, [], 'ipc-connection 不应依赖其它服务')
assert.equal(typeof ipcExports.AbstractApiClient, 'undefined', 'ipc-connection 不应导出 AbstractApiClient（由 apply 内部使用）')

// ── 模拟 Cordis ctx：apply(ctx) 应 provide('connection', handle) ──────
let provided = null
const ctx = {
  provide(key, value) {
    if (key === 'connection') provided = value
  },
}
ipcExports.apply(ctx)
assert.ok(provided, 'apply 应 provide connection 服务')
assert.ok(provided.api, 'connection.api 应存在')
assert.equal(typeof provided.api.doFetch, 'function', 'api.doFetch 存在')
assert.equal(typeof provided.api.openMux, 'function', 'api.openMux 存在')
assert.equal(typeof provided.api.openHost, 'function', 'api.openHost 存在')
assert.equal(typeof provided.start, 'function', 'connection.start 存在')

console.log('✅ 路线 A 最小实证（Step 1）通过：bundle require 链路成立')
console.log('   client-connection exports: AbstractApiClient / apply / inject / RpcId / transportError')
console.log('   ipc-connection requires → 拿到 AbstractApiClient → IPC 子类实例化 → apply provide(connection)')

// ── Step 2：单测 doFetch 的信封透传 + server-response 包装 ─────────────
// 官方 callUnary 会做 serverResponseSchema.parse + rpcId 回显校验，因此 doFetch
// 必须返回 {type:'server-response', rpcId(回显), result:{ok, value|error}}。
async function stepTwo() {
  const api = provided.api
  const fixedRpcId = '00000000-0000-4000-8000-000000000001'
  const input = new URL('dsh-ui://app/api/session.prompt')
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: fixedRpcId, method: 'session.prompt', payload: { arg: 1 } }),
  }
  const resp = await api.doFetch(input, init)
  assert.equal(resp.ok, true, 'doFetch 应返回 ok 响应')
  const json = await resp.json()
  assert.equal(json.type, 'server-response', 'doFetch 应包 server-response 信封')
  assert.equal(json.rpcId, fixedRpcId, 'server-response 应回显请求 rpcId')
  assert.equal(json.result.ok, true, 'host 正常结果 result.ok=true')
  assert.equal(json.result.value.echoedRpcId, fixedRpcId, 'result.value 应为 host 回传数据')

  // host 错误分支：raw 含 error → result.ok=false
  sandboxRef.window.desktopBridge.request = async () => ({ rpcId: fixedRpcId, error: { code: 100, message: 'boom' } })
  const respErr = await api.doFetch(input, init)
  const jsonErr = await respErr.json()
  assert.equal(jsonErr.result.ok, false, 'host 错误应 result.ok=false')
  assert.equal(jsonErr.result.error.message, 'boom', '错误应透传 message')
  console.log('✅ 路线 A 最小实证（Step 2）通过：doFetch 信封透传 + server-response 包装')
  console.log('   请求信封 → preload.request 保真 rpcId 透传 → server-response 回显 rpcId → result 窄化')
}

stepTwo().catch((error) => {
  console.error('❌ Step 2 失败:', error)
  process.exit(1)
})
