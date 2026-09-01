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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { bootGraphSchema, type BootEntry, type BootGraph, type BootBatch } from '../types/boot.js'

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

/** 图谱应排除的互斥 client 包（官方装配单选的互斥对只保一个激活，双激活会注册冲突）。 */
const CLIENT_EXCLUDE_IDS = new Set([
  // 桌面端 directory-picker 走 native（匹配 prepare 钩子的 ElectronDirectoryPicker），
  // browse（浏览器文件浏览）是互斥副本；两包注册同一 single slot（conversation.hero.workspace.directoryFlow
  // / sidebar.workspaces.directoryFlow）会抛 "already has a registration"。
  '@deepseek-ai/dsh-client-ui-directory-picker-browse',
  // 桌面版布局插件接管 root 槽位（方案 B），禁用官方布局插件
  '@deepseek-ai/dsh-client-ui-layout',
  // M6-P3 侧栏壳自研：@lansi-ai/dsh-desktop-sidebar 接管 sidebar 槽位（fold + 新会话 +
  // 5 子槽位声明）；官方 ui-sidebar 排除后，ui-workspace/ui-settings 无改动注册其子槽位
  // （摸底证实 ui-workspace 运行时不 require ui-sidebar，dsh.client.inject 仅为装载顺序提示）。
  '@deepseek-ai/dsh-client-ui-sidebar',
])

// ── 内部状态 ─────────────────────────────────────────────────────────

/** bundle 路径表：id → client bundle 绝对路径（供 bundle route 直读）。 */
const bundlePathMap = new Map<string, string>()

// ── 官方 UI 客户端面（0.1.2 · 载波经 __DSH_TRANSPORT__ 自持）───────────────
// 0.1.2 中官方 `@deepseek-ai/dsh-client-connection` 的 apply() 读取页面全局
// `window.__DSH_TRANSPORT__`（HTML boot 脚本已注入桌面 IPC 传输）自行提供
// `ctx.connection` 服务。桌面不再继承 AbstractApiClient，因此 client-connection
// 正常进入图谱并激活其 apply；服务端由官方 api-gateway(client) 拥有连接循环。
/** 客户端模块系统 bootstrap 包（0.1.2 PARSER_PRELOAD_IDS 仅含它，bootstrap batch 承载）。 */
const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules'
/** 图谱内传输占位模块（自持传输定义在 HTML boot 脚本 __DSH_TRANSPORT__，此处仅占位激活）。 */
const IPC_CONNECTION_ID = '@lansi-ai/dsh-ipc-connection'
/** 图谱外预载注册模块：0.1.2 已无继承基类场景，清空。 */
const PRELOAD_ONLY_IDS: string[] = []

// ── 内部工具 ─────────────────────────────────────────────────────────

/** sha1 内容 hash 缩短为 12 位 hex（bundle rev / graph rev）。 */
function shortHash(input: string | Buffer): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

/** 转义 graph URL 后再放入带引号的 HTML 属性。 */
function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** 从已安装包解析 `exports["./client"]` 产物路径（官方基础插件用）。
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

/**
 * 解析第三方 scope（非 `@deepseek-ai`）client 插件的装载声明（M1 门禁·第三方无改动装载）。
 *
 * 官方自动扫描（`scanClientPackages`）仅覆盖 `node_modules/@deepseek-ai` scope；
 * 第三方插件（如 `@lnyanhongyan/dsh-opencode-usage`）不在其中，需经此声明装载。
 *
 * 读取包 `dsh.client` 声明（platform/inject/external/immediately）解析 bundle 路径，
 * 与生成图谱行的 boot 语义对齐。对未声明 `dsh.client` 的包回退为仅按
 * `exports["./client"]` 解析 + 默认立即激活。
 *
 * @param id 第三方插件包名（完整包名，如 `@lnyanhongyan/dsh-opencode-usage`）。
 * @returns 装载声明（id/path/inject/external/immediately）。
 * @throws 当包无法解析或未声明 `./client` 产物。
 */
export function buildThirdPartyBundleDecl(id: string): BootBundleDecl {
  const require = createRequire(__filename)
  const pkgPath = require.resolve(`${id}/package.json`)
  const pkgDir = dirname(pkgPath)
  const meta = scanClientMeta(id, pkgDir)
  if (meta === undefined) {
    // 无 dsh.client 声明：仍按 exports["./client"] 解析 + 默认立即激活（作装载载体）。
    return { id, path: resolveBuiltinClientBundle(id), inject: [], immediately: true }
  }
  return {
    id,
    path: meta.clientPath,
    ...(meta.inject !== undefined ? { inject: meta.inject } : {}),
    ...(meta.external.length > 0 ? { external: meta.external } : {}),
    // 第三方插件默认真实激活（immediately 仅控制 prefetch，激活由官方驱动全量触发）。
    immediately: true,
  }
}

/**
 * 第三方 client 插件装载清单（M1 门禁·第三方无改动装载）：经 `dsh.client` 声明装载。
 *
 * 注：M4-d3 升级轮中 @lnyanhongyan/dsh-opencode-usage 因 peer 锁 rc.7 与 0.1.2
 * 不兼容已从依赖移除，清单暂空；待其升版后重新加入。
 */
export const THIRD_PARTY_CLIENT_IDS: string[] = []

/**
 * 解析全部第三方插件的装载声明（HTML 注入与插件清单两条装配线共用的唯一来源）。
 * 单个包解析失败不阻断整体（跨包边界：某包缺失/未声明 ./client 不应拖垮启动）。
 */
export function buildThirdPartyBundles(): BootBundleDecl[] {
  const decls: BootBundleDecl[] = []
  for (const id of THIRD_PARTY_CLIENT_IDS) {
    try {
      decls.push(buildThirdPartyBundleDecl(id))
    } catch (error) {
      console.warn(`[boot-graph] 第三方插件 ${id} 装载声明解析失败，已跳过:`, error)
    }
  }
  return decls
}

/**
 * 解析本地 `src/desktop-shell/web/` 下静态 client bundle（编译产物优先，源码回退）。
 *
 * 编译后 boot-graph 位于 `dist/desktop-host/`，本地 bundle 位于 `dist/desktop-shell/web/`；
 * 沙箱验证时 boot-graph 位于 `src/desktop-host/`，本地 bundle 位于 `src/desktop-shell/web/`。
 * 取两者中先存在者为路径，保证 dev 与自动化验证双态可用。
 *
 * @param filename 静态 bundle 文件名（如 `ipc-connection.js`）。
 * @returns 现存 bundle 的绝对路径。
 * @throws 当两个候选路径均不存在。
 */
function resolveLocalWebBundle(filename: string): string {
  const candidates = [
    join(__dirname, '..', 'desktop-shell', 'web', filename),
    join(__dirname, '..', '..', 'src', 'desktop-shell', 'web', filename),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`client-modules: 本地 client bundle 不存在: ${candidates.join(' / ')}`)
}

// ── 自动扫描 client 包（复刻官方 ClientModuleRegistry 内核，零端口、不依赖 webServer）──
// 官方 dsh-client-modules 节点从 Loader entries 扫描声明 dsh.client 的包；此处因禁用了
// modules/webserver，改为从 node_modules/@deepseek-ai 目录自动发现全部 dsh.client.platform==='web'
// 的包，复刻其 resolveMeta/orderByModuleGraph/compose 逻辑生成完整图谱（含全部 ui-* 客户端插件）。

/** 扫描范围：@deepseek-ai org（官方 client 插件均在此 scope 下）。 */
const SCAN_SCOPE_DIR = '@deepseek-ai'

interface ScannedClientMeta {
  /** client bundle 绝对路径。 */
  clientPath: string
  /** 包名依赖边（dsh.client.inject）。 */
  inject?: string[]
  /** 模块依赖（dsh.client.external）。 */
  external: string[]
  /** 阶段一预取标记。 */
  immediately: boolean
}

/** 解析 `exports["./client"]` 相对路径（accept 字符串与一层条件形式）。 */
function clientExportOf(pkgName: string, pkg: { exports?: Record<string, unknown> }): string | undefined {
  const client = pkg.exports?.['./client']
  if (client === undefined) return undefined
  if (typeof client === 'string') return client
  if (typeof client === 'object' && client !== null) {
    const fallback = (client as { default?: unknown }).default
    if (typeof fallback === 'string') return fallback
  }
  throw new Error(`client-modules: ${pkgName} exports["./client"] must be a string or an object with a string default`)
}

/** 解析某包是否声明 `dsh.client.platform==='web'`，返回其 client 元数据（否则 undefined）。 */
function scanClientMeta(pkgName: string, pkgDir: string): ScannedClientMeta | undefined {
  const pkgPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgPath)) return undefined
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    exports?: Record<string, unknown>
    dsh?: { client?: { platform?: string; inject?: string[]; external?: string[]; immediately?: boolean } }
  }
  const decl = pkg.dsh?.client
  if (decl === undefined || decl.platform !== 'web') return undefined
  const clientRel = clientExportOf(pkgName, pkg)
  if (clientRel === undefined) {
    throw new Error(`client-modules: ${pkgName} declares dsh.client but exports no "./client" bundle`)
  }
  return {
    clientPath: join(pkgDir, clientRel),
    ...(decl.inject !== undefined ? { inject: decl.inject } : {}),
    external: decl.external ?? [],
    immediately: decl.immediately === true,
  }
}

/**
 * 扫描 node_modules 下全部 `@deepseek-ai` 包，收集声明 `dsh.client.platform==='web'` 的包。
 * @returns 扫描到的 client 元数据表（id → meta）。
 */
function scanClientPackages(): Map<string, ScannedClientMeta> {
  const require = createRequire(__filename)
  // 通过已安装的任意 @deepseek-ai 包定位 node_modules 根，遍历其 scope 下所有包。
  const anchor = require.resolve('@deepseek-ai/dsh-client-modules/package.json')
  const scopeDir = join(dirname(anchor), '..') // .../node_modules/@deepseek-ai
  const table = new Map<string, ScannedClientMeta>()
  if (!existsSync(scopeDir)) return table
  for (const name of readdirSync(scopeDir)) {
    if (name.startsWith('.')) continue
    const pkgDir = join(scopeDir, name)
    const pkgName = `${SCAN_SCOPE_DIR}/${name}`
    const meta = scanClientMeta(pkgName, pkgDir)
    if (meta !== undefined) table.set(pkgName, meta)
  }
  return table
}

/** 按模块依赖图排序图谱行（复刻官方 orderByModuleGraph：external 前置、拓扑序）。 */
function orderByModuleGraph(entries: BootEntry[]): BootEntry[] {
  const rowsById = new Map<string, BootEntry>()
  for (const entry of entries) rowsById.set(entry.id, entry)
  const ordered: BootEntry[] = []
  const placed = new Set<string>()
  const open: string[] = []
  const visit = (entry: BootEntry): void => {
    if (placed.has(entry.id)) return
    const cycleStart = open.indexOf(entry.id)
    if (cycleStart !== -1) {
      throw new Error(`client-modules: module graph cycle ${[...open.slice(cycleStart), entry.id].join(' -> ')} — a requested package row must precede its consumers`)
    }
    open.push(entry.id)
    for (const name of entry.external ?? []) {
      const normalized = name.endsWith('/client') ? name.slice(0, -7) : name
      const dependency = rowsById.get(name) ?? rowsById.get(normalized)
      if (dependency === entry) throw new Error(`client-modules: "${entry.id}" requests module "${name}" that it answers itself`)
      if (dependency !== undefined) visit(dependency)
    }
    open.pop()
    placed.add(entry.id)
    ordered.push(entry)
  }
  for (const entry of entries) visit(entry)
  return ordered
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

// ── Manifest 图谱生成 ───────────────────────────────────────────────

/**
 * 生成完整的 `__DSH_BOOT__` 图谱。
 *
 * 自动扫描 node_modules/@deepseek-ai 下全部 `dsh.client.platform==='web'` 的包
 * （含全部 ui-* 客户端插件），复刻官方 ClientModuleRegistry 的 inject/external/
 * immediately + 模块依赖拓扑排序，生成完整图谱。
 *
 * 特殊处理：
 * - `@deepseek-ai/dsh-client-connection` **不入图谱**（D-9：官方驱动对图谱全量激活，
 *   会使官方 Web 传输 connection 抢走服务 → 404/retry），仅登记为预载注册模块。
 * - 桌面独占 `@lansi-ai/dsh-ipc-connection` 注入图谱，独占提供 connection 服务。
 * - 自动扫描结果与 extraBundles（含 ipc-connection 载波）合并后整体拓扑排序。
 *
 * @param rev 图谱版本号；省略时由条目内容哈希推导。
 * @param extraBundles 额外 client 插件 bundle 声明（不受扫描范围限制）。
 * @returns 经 zod 校验的完整图谱。
 */
export function generateBootGraph(rev?: string, extraBundles?: BootBundleDecl[]): BootGraph {
  // 1. 自动扫描全部 dsh.client 包 → bundle 声明（剔除 client-connection，见 D-9）。
  const scanned = scanClientPackages()
  const scannedDecls: BootBundleDecl[] = []
  for (const [id, meta] of scanned) {
    // 0.1.2 中 client-connection 正常入图谱：其 apply() 读 __DSH_TRANSPORT__ 提供 ctx.connection。
    if (CLIENT_EXCLUDE_IDS.has(id)) continue // 互斥副本排除（防止 single slot 双激活冲突）
    scannedDecls.push({
      id,
      path: meta.clientPath,
      ...(meta.inject !== undefined ? { inject: meta.inject } : {}),
      ...(meta.external.length > 0 ? { external: meta.external } : {}),
      ...(meta.immediately ? { immediately: true } : {}),
    })
  }

  // 2. 桌面载波 + 外部显式声明（扫描集之外，或覆盖扫描）。
  const desktopDecls: BootBundleDecl[] = [
    // 桌面 IPC 传输占位模块（0.1.2）：自持传输定义在 HTML boot 脚本 __DSH_TRANSPORT__，
    // 本条目仅为图谱激活占位（官方 client-connection 自行 provide ctx.connection）。
    { id: IPC_CONNECTION_ID, path: resolveLocalWebBundle('ipc-connection.js'), inject: [], immediately: true },
    // 桌面版布局插件：接管 root 槽位，提供三列布局（方案 B）
    { id: '@lansi-ai/dsh-desktop-layout', path: resolveLocalWebBundle('desktop-layout-client.js'), inject: ['slots', 'theme'], immediately: true },
    // 桌面自绘标题栏（v2：titlebar 收进布局，不再 body 级 fixed）：
    // 注册布局 root 槽位的 titlebar 行（拖拽区 + 窗控 + 下边线）；等待 slots + layout，
    // 借 layout 服务保证布局（root 槽位声明 titlebar）先 apply，规避子槽位未声明
    { id: '@lansi-ai/dsh-desktop-titlebar', path: resolveLocalWebBundle('desktop-titlebar-client.js'), inject: ['slots', 'layout'], immediately: true },
    // M6-P3 侧栏壳自研：接管 sidebar 槽位（fold + 新会话 + 5 子槽位声明），
    // 官方 workspaces/settings 注册者经子槽位无改动继续工作
    { id: '@lansi-ai/dsh-desktop-sidebar', path: resolveLocalWebBundle('desktop-sidebar-client.js'), inject: ['slots'], immediately: true },
    // M2-e 官方 UI 注入：桌面设置页面 + 桌面面板容器 + 命令面板（经 Slot 系统注入官方 UI）
    // 0.1.2：ctx.slots 由 @deepseek-ai/dsh-client-ui-renderer 提供（ui-slots 已并入），
    // external 边改为指向 renderer/client，保证其 bundle 先于消费方入图。
    { id: '@lansi-ai/dsh-desktop-settings', path: resolveLocalWebBundle('desktop-settings-client.js'), inject: [], external: ['@deepseek-ai/dsh-client-ui-renderer/client'], immediately: true },
    { id: '@lansi-ai/dsh-desktop-panel', path: resolveLocalWebBundle('desktop-panel-client.js'), inject: [], external: ['@deepseek-ai/dsh-client-ui-renderer/client'], immediately: true },
    // M3-a4 命令面板：Ctrl+K 面板 + 快速提问快捷入口（纯 DOM 浮层 + 官方运行时导航——坑 13/14/15）
    // entry.inject 是信息性包名依赖边（非服务注入）；服务等待只看插件返回对象的 exports.inject，
    // 故此处恒 []，ctx.sessions/workspaces 由插件 apply 后经 ctx.get 软查找。
    { id: '@lansi-ai/dsh-desktop-cmdpalette', path: resolveLocalWebBundle('desktop-cmdpalette-client.js'), inject: [], immediately: true },
    // M3-b2 审计查看器：会话审计日志查询 UI
    { id: '@lansi-ai/dsh-desktop-audit-viewer', path: resolveLocalWebBundle('desktop-audit-viewer-client.js'), inject: [], external: ['@deepseek-ai/dsh-client-ui-renderer/client'], immediately: true },
    // 对话区视觉层（子元素侧）：不接管 conversation 槽位（与官方 ui-conversation 单槽位互斥），
    // 仅注入样式给对话根节点（data-phase）圆角/裁剪——圆角归对话自身，非布局插件职责。
    { id: '@lansi-ai/dsh-desktop-conversation-visuals', path: resolveLocalWebBundle('desktop-conversation-visuals-client.js'), inject: [], immediately: true },
    ...(extraBundles ?? []),
  ]

  // 3. 合并 + 读取产物登记路径表 + 计算 rev → 图谱行（先登记 bundlePathMap 供 composeEntries 后路由使用）。
  const allMeta: Map<string, { path: string; inject?: string[]; external?: string[]; immediately?: boolean }> = new Map()
  for (const decl of scannedDecls) allMeta.set(decl.id, { path: decl.path, inject: decl.inject, external: decl.external, immediately: decl.immediately })
  for (const decl of desktopDecls) allMeta.set(decl.id, { path: decl.path, inject: decl.inject, external: decl.external, immediately: decl.immediately })

  // 4. 读取每个 bundle 内容计算 rev，登记路径表，生成图谱行。
  const rows: BootEntry[] = []
  for (const [id, meta] of allMeta) {
    if (!existsSync(meta.path)) throw new Error(`client-modules: ${id} 的 client bundle 不存在: ${meta.path}`)
    const entryRev = shortHash(readFileSync(meta.path))
    bundlePathMap.set(id, meta.path)
    rows.push(
      graphRow(
        { id, path: meta.path, ...(meta.inject !== undefined ? { inject: meta.inject } : {}), ...(meta.external !== undefined && meta.external.length > 0 ? { external: meta.external } : {}), ...(meta.immediately === true ? { immediately: true } : {}) },
        entryRev,
      ),
    )
  }

  // 5. 模块依赖拓扑排序（external 前置），保证每个请求的动态包先于其消费者。
  const entries = orderByModuleGraph(rows)

  // 6. 0.1.2 组合批次（batches 必填，每个条目恰属于一个 batch）。
  // 桌面按方案 A 单资源 bundle 直读，故每个条目独立成 batch：bootstrap 阶段承载
  // client-modules（解析器脚本），application 阶段承载其余全部。batches[].url 与
  // 对应 entry.url 一致（同一单资源端点，可被 dsh-ui://plugins/<id>/client.js 服务）。
  // 对齐官方 ClientModuleRegistry.compose() 的「bootstrap + application」两阶段语义。
  const batches: BootBatch[] = entries.map((entry) => ({
    phase: entry.id === CLIENT_MODULES_ID ? 'bootstrap' : 'application',
    url: entry.url,
    rev: entry.rev,
    entries: [entry.id],
  }))
  if (!batches.some((b) => b.phase === 'bootstrap')) {
    throw new Error(`client-modules: bootstrap 批次缺失 ${CLIENT_MODULES_ID}（/client.js 未入图谱）`)
  }

  const graphRev = rev ?? `desktop-m1-${shortHash(JSON.stringify(entries))}`
  return bootGraphSchema.parse({ rev: graphRev, entries, batches })
}

/**
 * 登记图谱外预载注册模块的 bundle 路径（`PRELOAD_ONLY_IDS`：client-connection 基类），
 * 供 bundle route（`dsh-ui://plugins/<id>/client.js`）直读其产物。
 *
 * 这些模块不入图谱 entries，只能被 HTML 预载 script 注册 factory；
 * 执行后可从 `resolveBundlePath` / `resolveBundleRequest` 查询。
 */
export function registerPreloadOnly(): void {
  for (const id of PRELOAD_ONLY_IDS) {
    bundlePathMap.set(id, resolveBuiltinClientBundle(id))
  }
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
 * 布局骨架 CSS（HTML 首帧预置，防裸窗口期）。
 *
 * 宿主面唯一真源：定义 html/body/#root 骨架（托盘色、主卡片圆角、四周边距），
 * 值经 `--dsd-*` 外观变量暴露契约（默认值内置）；二开者覆盖该变量即可改骨架，
 * 宿主源码零改动。变量默认值与 desktop-appearance.ts 的 resolveVars 保持一致。
 * 与布局插件（@lansi-ai/dsh-desktop-layout）职责分离：本处只做骨架，
 * 插件只管 .dsh-desktop-layout-* 布局引擎样式。
 * !important + html 前缀提特异性：官方 UI 运行时动态注入样式表晚于此，
 * 会以同特异性覆盖 position 导致底部溢出（实机 2026-08-27）。
 */
const LAYOUT_SKELETON_CSS = [
  ':root{--dsd-tray-bg:rgb(242 243 245);--dsd-card-radius:12px;--dsd-frame-gap:15px;--dsd-titlebar-h:50px}',
  // background 必须 !important：官方运行时动态样式表晚于此（body{background:--dsw-alias-bg-base,#fff}）
  // 会用同特异性把托盘色盖成白色（实机 2026-08-27：整窗白、卡片不浮起）。
  'html,body{background:var(--dsd-tray-bg)!important}',
  'body{overflow:hidden!important}',
  // 官方 #root 保持原生 height:100% 自适应缩放（不动它的定位，避免破坏放大跟随）。
  // 我们只做视觉垫层：内边距留出托盘边距 + 主卡片圆角（内层卡片由布局插件接管）。
  'html body>#root{box-sizing:border-box!important;padding:0!important;margin:0!important}',
  // 主卡片（官方 #root 内的 UI 容器）圆角 + 托盘分隔；不改变 #root 定位，缩放仍由官方自适应。
  'html body>#root>div:first-child{border-radius:var(--dsd-card-radius)!important;overflow:hidden!important}',
].join('')

/**
 * 生成官方格式的 boot 注入脚本（骨架 CSS + queue shim + parser 预载 script + `window.__DSH_BOOT__`）。
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
  // 图谱内预载：0.1.2 按 batch 阶段注入——bootstrap 阶段（client-modules）作
  // parser 阻塞 script，application 阶段作 preload。桌面单资源批 url 即 entry.url。
  const bootstrap = graph.batches.filter((batch) => batch.phase === 'bootstrap')
  const application = graph.batches.filter((batch) => batch.phase === 'application')
  const preload = application.map((batch) => `<link rel="modulepreload" href="${escapeHtmlAttribute(batch.url)}">`).join('')
  const bootstrapScripts = bootstrap.map((batch) => `<script src="${escapeHtmlAttribute(batch.url)}"></script>`).join('')
  return `<style>${LAYOUT_SKELETON_CSS}</style>${queue}${preload}${bootstrapScripts}<script>window.__DSH_BOOT__ = ${json}</script>`
}

/**
 * 生成完整的 boot 注入脚本（含 `__DSH_BOOT__` 图谱 + queue shim + parser 预载）。
 *
 * @param rev 图谱版本号。
 * @param extraBundles 额外 client 插件 bundle 声明（需包含待验证的样例/第三方插件）。
 * @returns HTML 注入脚本字符串。
 */
export function generateFullBootScript(rev?: string, extraBundles?: BootBundleDecl[]): string {
  registerPreloadOnly()
  return bootManifestInlineScript(generateBootGraph(rev, extraBundles))
}
