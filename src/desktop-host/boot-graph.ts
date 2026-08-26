/**
 * dsh-desktop `__DSH_BOOT__` 图谱纯逻辑层（Step 5·零端口 bundle 装载）。
 *
 * 本模块**不依赖 Electron**，只含 graph/bundle 的纯函数，便于沙箱内自动化验证。
 * 宿主侧 `manifest.ts` 复用并 re-export 这些能力。
 *
 * 职责：
 * 1. 组合 bundle 声明 → 官方格式 `__DSH_BOOT__` 图谱（url = `/plugins/<id>/client.js?rev=...`）
 * 2. 解析 client bundle 产物路径 + 计算内容 rev（对齐官方 `graphRow`/`shortHash` 语义）
 * 3. 提供 bundle route 查询（`resolveBundleRequest`），供 `dsh-ui-protocol.ts` 直读 bundle
 * 4. 生成官方格式 HTML 注入脚本（queue shim + parser 预载 + `__DSH_BOOT__`）
 *
 * 字段语义对齐官方 `dsh-client-modules` 的 `WebBootEntry`/`WebBootGraph`。
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { bootGraphSchema, type BootEntry, type BootGraph } from '../types/boot.js'

// ── 类型定义 ─────────────────────────────────────────────────────────

/** 一颗 client bundle 的装载声明（host 内部输入，非 wire）。 */
export interface BootBundleDecl {
  /** 条目名 == 包名。 */
  id: string
  /** client bundle 产物绝对路径（方案 A 协议直读的读取目标）。 */
  path: string
  /** 包名依赖边。 */
  inject?: string[]
  /** 非基线模块 specifiers。 */
  external?: string[]
  /** 阶段一预取标记。 */
  immediately?: boolean
}

// ── 内部状态 ─────────────────────────────────────────────────────────

/** bundle 路径表：id → client bundle 绝对路径（供 bundle route 直读）。 */
const bundlePathMap = new Map<string, string>()

/** 客户端模块系统 bootstrap 包（must 在官方 HTML 注入脚本中预载）。 */
const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules'
/** HTML parser 预载的普通动态 bundle（在 Vite shell 运行前注册 factory）。 */
const PARSER_PRELOAD_IDS = [CLIENT_MODULES_ID, '@deepseek-ai/dsh-client-runtime']

// ── 内部工具 ─────────────────────────────────────────────────────────

/** sha1 内容 hash 缩短为 12 位 hex（bundle rev / graph rev）。 */
function shortHash(input: string | Buffer): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

/** 转义 graph URL 后再放入带引号的 HTML 属性。 */
function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * 从已安装包解析 `exports["./client"]` 产物路径（官方基础插件用）。
 * @param id 包名。
 * @returns client bundle 绝对路径。
 * @throws 当包无法解析或未声明 `./client` 产物。
 */
function resolveBuiltinClientBundle(id: string): string {
  const require = createRequire(__filename)
  const pkgPath = require.resolve(`${id}/package.json`)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { exports?: Record<string, unknown> }
  const clientExport = pkg.exports?.['./client'] as string | { default?: string } | undefined
  if (typeof clientExport === 'string') return join(dirname(pkgPath), clientExport)
  if (typeof clientExport === 'object' && clientExport !== null && typeof clientExport.default === 'string') {
    return join(dirname(pkgPath), clientExport.default)
  }
  throw new Error(`client-modules: ${id} 未声明 exports["./client"]`)
}

/** 生成单条图谱行（url 携带 rev 作为破缓存 query）。 */
function graphRow(decl: BootBundleDecl, rev: string): BootEntry {
  return {
    id: decl.id,
    url: `/plugins/${decl.id}/client.js?rev=${rev}`,
    rev,
    ...(decl.inject !== undefined ? { inject: decl.inject } : {}),
    ...(decl.immediately === true ? { immediately: true } : {}),
    ...(decl.external !== undefined && decl.external.length > 0 ? { external: decl.external } : {}),
  }
}

/**
 * 组合 bundle 声明列表为图谱条目：读取产物、计算 rev、登记 bundle 路径表。
 * @param bundles bundle 声明列表。
 * @returns 图谱条目列表（保持传入顺序；spike 样例无 external 依赖，真实场景需模块图拓扑排序）。
 */
function composeEntries(bundles: BootBundleDecl[]): BootEntry[] {
  return bundles.map((decl) => {
    if (!existsSync(decl.path)) {
      throw new Error(`client-modules: ${decl.id} 的 client bundle 不存在: ${decl.path}`)
    }
    const rev = shortHash(readFileSync(decl.path))
    bundlePathMap.set(decl.id, decl.path)
    return graphRow(decl, rev)
  })
}

// ── Manifest 图谱生成 ───────────────────────────────────────────────

/**
 * 生成完整的 `__DSH_BOOT__` 图谱。
 *
 * 自动包含官方基础插件（`@deepseek-ai/dsh-client-modules` + `@deepseek-ai/dsh-client-runtime`，
 * 二者是 HTML parser 预载与模块系统 bootstrap 的必需项），并叠加外部传入的 bundle 声明。
 *
 * @param rev 图谱版本号；省略时由条目内容哈希推导。
 * @param extraBundles 额外 client 插件 bundle 声明。
 * @returns 经 zod 校验的完整图谱。
 */
export function generateBootGraph(rev?: string, extraBundles?: BootBundleDecl[]): BootGraph {
  const builtins: BootBundleDecl[] = [
    { id: CLIENT_MODULES_ID, path: resolveBuiltinClientBundle(CLIENT_MODULES_ID) },
    { id: '@deepseek-ai/dsh-client-runtime', path: resolveBuiltinClientBundle('@deepseek-ai/dsh-client-runtime') },
  ]
  const bundles = [...builtins, ...(extraBundles ?? [])]
  const entries = composeEntries(bundles)
  const graphRev = rev ?? `desktop-m1-${shortHash(JSON.stringify(entries))}`
  return bootGraphSchema.parse({ rev: graphRev, entries })
}

/**
 * 查询某 client bundle 的绝对路径（供 bundle route 直读）。
 * 仅返回 `generateBootGraph` 已登记过的 id。
 *
 * @param id 包名。
 * @returns bundle 绝对路径，或 undefined 表示未登记。
 */
export function resolveBundlePath(id: string): string | undefined {
  return bundlePathMap.get(id)
}

/**
 * 解析 bundle route 请求（方案 A：`dsh-ui://` 协议直读）。
 *
 * 匹配 `/plugins/<id>/client.js[.map]?rev=...`，从已登记 bundle 路径表直读产物。
 * 纯函数、不依赖 Electron，便于沙箱内自动化验证。
 *
 * @param pathname 请求路径（可由 `new URL(request.url).pathname` 得到）。
 * @returns 读取到的 bundle 内容与 MIME，或 undefined 表示非 bundle route / 未登记 / 文件缺失。
 */
export function resolveBundleRequest(pathname: string): { body: Buffer; contentType: string } | undefined {
  const decoded = decodeURIComponent(pathname)
  const prefix = '/plugins/'
  const suffix = '/client.js'
  const mapSuffix = '.map'
  if (!decoded.startsWith(prefix)) return undefined
  let id: string
  let isMap = false
  if (decoded.endsWith(suffix + mapSuffix)) {
    id = decoded.slice(prefix.length, -suffix.length - mapSuffix.length)
    isMap = true
  } else if (decoded.endsWith(suffix)) {
    id = decoded.slice(prefix.length, -suffix.length)
  } else {
    return undefined
  }
  const bundlePath = resolveBundlePath(id)
  if (bundlePath === undefined) return undefined
  const filePath = isMap ? `${bundlePath}.map` : bundlePath
  if (!existsSync(filePath)) return undefined
  return {
    body: readFileSync(filePath),
    contentType: isMap ? 'application/json; charset=utf-8' : 'text/javascript; charset=utf-8',
  }
}

// ── HTML 注入脚本 ───────────────────────────────────────────────────

/**
 * 生成官方格式的 boot 注入脚本（queue shim + parser 预载 script + `window.__DSH_BOOT__`）。
 *
 * 与官方 `injectBootManifest` 逐字对齐：inline 注册队列先于 client-modules / client-runtime 的
 * 普通 classic `<script src>`，其 `create()` 在模块系统创建后切换到 live 注册模式。
 * JSON 中 `<` 被转义为 `\\u003c`，避免插件控制的字符串逃逸出 script 元素。
 *
 * @param graph 完整图谱。
 * @returns 注入到 `<head>` 之后的脚本内容。
 */
function bootManifestInlineScript(graph: BootGraph): string {
  const json = JSON.stringify(graph).replaceAll('<', '\\u003c')
  const queue = `<script>(()=>{
const pendingQueue=[]
window.__ModuleLoader__={
  mode:"queue",
  pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(options){
    if(this.mode!=="queue")throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot")
    const index=pendingQueue.findIndex(registration=>registration.id==="@deepseek-ai/dsh-client-modules")
    const registration=pendingQueue[index]
    if(registration===undefined)throw new Error("client-modules: HTML did not preload @deepseek-ai/dsh-client-modules/client.js")
    pendingQueue.splice(index,1)
    const exports=registration.factory(specifier=>{
      throw new Error('client-modules: @deepseek-ai/dsh-client-modules/client.js requested external "'+specifier+'" before the module system existed')
    })
    if(typeof exports!=="object"||exports===null||typeof exports.createClientModuleSystem!=="function"||typeof exports.apply!=="function"){
      throw new Error("client-modules: @deepseek-ai/dsh-client-modules/client.js did not export the bootstrap module face")
    }
    return exports.createClientModuleSystem(this,{id:registration.id,exports},options)
  }
}
})()</script>`
  const preload = PARSER_PRELOAD_IDS.map((id) => graph.entries.find((entry) => entry.id === id))
    .filter((entry): entry is BootEntry => entry !== undefined)
    .map((entry) => `<script src="${escapeHtmlAttribute(entry.url)}"></script>`)
    .join('')
  return `${queue}${preload}<script>window.__DSH_BOOT__ = ${json}</script>`
}

/**
 * 生成完整的 boot 注入脚本（含 `__DSH_BOOT__` 图谱 + queue shim + parser 预载）。
 *
 * @param rev 图谱版本号。
 * @param extraBundles 额外 client 插件 bundle 声明（需包含待验证的样例/第三方插件）。
 * @returns HTML 注入脚本字符串。
 */
export function generateFullBootScript(rev?: string, extraBundles?: BootBundleDecl[]): string {
  return bootManifestInlineScript(generateBootGraph(rev, extraBundles))
}
