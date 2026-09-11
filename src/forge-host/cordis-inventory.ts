/**
 * dsh-forge 插件清单数据面（设置 → 插件 → 「插件列表」Tab）。
 *
 * 历史：官方 ui-cordis 面板经 `ctx.remote.dynamicCordisRunner.inventory()` 读 Cordis
 * 插件清单，而宿主半 `cordis-host-runner` 曾未装载 → 该 API 域 404，本模块提供最小
 * inventory 等价面保证面板/设置页仍能列出插件。
 *
 * **2026-09-10 起（创造模式 · dogfood #23）**：官方 `@deepseek-ai/dsh-cordis-host-runner`
 * 已装载，`dynamicCordisRunner` 域由官方实现提供 —— 本模块只保留自研「插件列表」Tab
 * 所需的 `pluginInventory/list` 只读快照，不再注册 `dynamicCordisRunner/inventory`
 * （bridge 的 unary 表分发优先于 apiProxy，继续注册会遮蔽官方实现）。
 *
 * **M6-P6 起（插件列表界面与数据全自研）**：快照来源由「仅客户端资源图谱」升级为
 * **三源合并**：
 *   - 主进程半 = `ctx.loader.entries()` 的真实 Cordis Loader 条目（含 tool-pwsh /
 *     pwsh-sandbox 等宿主平面插件）；
 *   - 界面半 = boot-graph 的 client bundle 清单；
 *   - 预设组成 = `ctx.agentPresets.compositionInventory()` 的每个预设行。
 * 此前只读图谱 → 宿主侧插件在列表与搜索中完全缺失（搜 `pwsh` 必然为空）。
 * 同名模块同时出现在两侧 → `half: 'both'`（对齐官方 hasHostHalf/hasClientHalf 语义）。
 */

import { generateBootGraph, buildThirdPartyBundles } from './boot-graph.js'
import { log } from './log.js'
import { registerMethod } from './bridge.js'

// ── 类型 ───────────────────────────────────────────────────────────

/** 插件承载半身：主进程（Cordis Loader 条目）/ 界面（客户端 bundle）/ 双半 / 仅预设提供。 */
export type PluginHalf = 'host' | 'client' | 'both' | 'preset'

/** 插件来源（按包 scope 判定；预设行名是 cordis 插件名而非包名，单列『预设』）。 */
export type PluginSource = '官方' | '自研' | '第三方' | '预设'

/** 真实 fiber 相位（对齐官方 FIBER_PHASE；disposed 与无 fiber 均归 null）。 */
export type PluginFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** 快照行：一个模块（全局平面按模块名归并双半；预设组成行按 entryId 独立成行）。 */
export interface PluginInventoryEntry {
  entryId: string
  moduleName: string
  /** 全局平面为布尔（Loader 真实状态）；预设组成行可带 `'conditional'`（`!!js` 未求值）。 */
  enabled: boolean | 'conditional'
  fiberPhase: PluginFiberPhase
  half: PluginHalf
  source: PluginSource
  /** 启用该模块的预设显示名（全局已启用时为空数组）。 */
  presetProviders: string[]
  /** 预设组成行所属预设 id（全局平面行为 undefined）——UI 按 id 精确分组，避免同名预设串组。 */
  presetId?: string
  /** 该行自带的 `!!js disabled` 表达式原文（仅预设组成行可能有；解释「条件启用」用）。 */
  condition?: string
}

/** 预设组成行（对齐官方 AgentPresetCompositionRow 的可序列化面）。 */
export interface PluginInventoryPresetRow {
  entryId: string | null
  moduleName: string
  enabled: boolean | 'conditional'
  condition?: string
  fiberPhase: PluginFiberPhase
}

/** 一个 Agent 预设的组成清单。 */
export interface PluginInventoryPreset {
  id: string
  name: string
  isDefault: boolean
  broken?: string
  rows: PluginInventoryPresetRow[]
}

/** `pluginInventory/list` 快照（自研「插件列表」Tab 的唯一数据面）。 */
export interface PluginInventorySnapshot {
  entries: PluginInventoryEntry[]
  agentPresets: PluginInventoryPreset[]
}

// ── 宿主服务最小结构面（只取清单所需字段，不 import 官方内部类型）──────

/** Cordis Loader 条目面。 */
interface LoaderEntryLike {
  id: string
  options: { name?: string; group?: boolean | null }
  disabled: boolean
  fiber?: { state?: number }
}

/** Cordis Loader 服务面。 */
interface LoaderLike {
  entries(): Iterable<LoaderEntryLike>
}

/** Agent 预设组成行面。 */
interface PresetRowLike {
  entryId: string | null
  moduleName: string
  enabled: boolean | 'conditional'
  condition?: string
  fiberState?: number
}

/** Agent 预设组成面。 */
interface PresetCompositionLike {
  id: string
  name?: string
  isDefault: boolean
  broken?: string
  rows: readonly PresetRowLike[]
}

/** dsh-agent-presets 服务面。 */
interface AgentPresetsLike {
  compositionInventory(): Promise<readonly PresetCompositionLike[]>
}

/** 宿主上下文最小面（boot 完成后由 main.ts 传入）。 */
interface HostContextLike {
  get(name: string): unknown
}

// ── 实现 ───────────────────────────────────────────────────────────

/** 图谱中应排除的基础设施条目（非用户可见插件）。 */
const INFRA_IDS = new Set([
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-runtime',
  '@lansi-ai/dsh-ipc-connection',
])

/** 绑定后的宿主服务面（boot 完成后由 bindCordisInventoryHost 注入）。 */
let boundLoader: LoaderLike | undefined
let boundPresets: AgentPresetsLike | undefined

/** 按包 scope 分类插件来源（官方 = @deepseek-ai，自研 = @lansi-ai，其余 = 第三方）。 */
function classifyPlugin(id: string): PluginSource {
  if (id.startsWith('@deepseek-ai/')) return '官方'
  if (id.startsWith('@lansi-ai/')) return '自研'
  return '第三方'
}

/** 来源排序权重（桌面定制口径：官方 → 自研 → 第三方 → 预设提供）。 */
const SOURCE_ORDER: Record<PluginSource, number> = { 官方: 0, 自研: 1, 第三方: 2, 预设: 3 }

/**
 * FiberState 数字 → 官方相位字符串（对齐 dsh-host-plugin-inventory 的 FIBER_PHASE）。
 * 0 PENDING / 1 LOADING / 2 ACTIVE / 3 FAILED / 4 DISPOSED → null / 5 UNLOADING。
 */
function toFiberPhase(state: number | undefined): PluginFiberPhase {
  switch (state) {
    case 0:
      return 'pending'
    case 1:
      return 'loading'
    case 2:
      return 'active'
    case 3:
      return 'failed'
    case 5:
      return 'unloading'
    default:
      return null
  }
}

/** 名称列表排版：单行超宽自动折行并缩进对齐，避免终端单行超长刷屏。 */
function formatPluginNames(ids: string[], width = 96, indent = '  '): string {
  const lines: string[] = []
  let current = ''
  for (const id of ids) {
    const piece = current === '' ? id : `, ${id}`
    if (current !== '' && current.length + piece.length > width) {
      lines.push(current)
      current = indent + id
    } else {
      current += piece
    }
  }
  if (current !== '') lines.push(current)
  return lines.join('\n')
}

/**
 * 把 Loader 条目合并进总表（主进程半）。
 * 同名已存在（同时有客户端 bundle）→ 原地升级为 `both`，并以真实
 * `enabled` / `fiberPhase` / Loader 条目 id 覆盖图谱侧的乐观值。
 */
function mergeLoaderEntries(merged: Map<string, PluginInventoryEntry>): void {
  if (boundLoader === undefined) return
  for (const entry of boundLoader.entries()) {
    if (entry.options.group === true) continue
    const moduleName = entry.options.name
    if (moduleName === undefined || INFRA_IDS.has(moduleName)) continue
    const existing = merged.get(moduleName)
    if (existing !== undefined) {
      existing.half = 'both'
      existing.entryId = entry.id
      existing.enabled = !entry.disabled
      existing.fiberPhase = toFiberPhase(entry.fiber?.state)
      continue
    }
    merged.set(moduleName, {
      entryId: entry.id,
      moduleName,
      enabled: !entry.disabled,
      fiberPhase: toFiberPhase(entry.fiber?.state),
      half: 'host',
      source: classifyPlugin(moduleName),
      presetProviders: [],
    })
  }
}

/** 排序：失败置顶 → 来源（官方/自研/第三方）→ 包名。 */
function compareEntries(a: PluginInventoryEntry, b: PluginInventoryEntry): number {
  const failedA = a.fiberPhase === 'failed' ? 0 : 1
  const failedB = b.fiberPhase === 'failed' ? 0 : 1
  if (failedA !== failedB) return failedA - failedB
  const sourceDiff = SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]
  if (sourceDiff !== 0) return sourceDiff
  return a.moduleName.localeCompare(b.moduleName)
}

/**
 * 收集 Agent 预设组成行（对齐官方 compositionInventory 口径）。
 *
 * 关键口径（v3 修正，此前三处偏差导致 minimal 只列出 3/6 行）：
 *   1. **不按模块名跨预设归并**：`minimal` 的 bash/pwsh 双栈同名同为
 *      `@deepseek-ai/dsh-terminal-bash`（仅 entryId 不同），按模块名归并会把
 *      「已停用」的 bash 行吞掉；故按 `预设id|entryId` 独立成行，保持**组成顺序**。
 *   2. **不丢停用行**：官方会话插件分组照列 `已停用` 行（`minimal` 6 行里有 2 行停用），
 *      过滤 `enabled !== true` 会让「win32 上 bash 栈关停」这条信息彻底消失。
 *   3. **不并进全局平面**：同名模块（如 `@deepseek-ai/dsh-persona`）在全局平面已有行时，
 *      预设行若被吸收就永远看不到——预设分组回答的是「该预设挂了哪些行」。
 * 全局平面行仍按模块名补 `presetProviders`（等价官方 enabledIn：仅 `enabled === true`）。
 */
function collectPresetRows(
  presets: PluginInventoryPreset[],
  byName: Map<string, PluginInventoryEntry>,
): PluginInventoryEntry[] {
  const rows: PluginInventoryEntry[] = []
  const seen = new Set<string>()
  for (const preset of presets) {
    for (const row of preset.rows) {
      const globalRow = byName.get(row.moduleName)
      if (globalRow !== undefined && row.enabled === true && !globalRow.presetProviders.includes(preset.name)) {
        globalRow.presetProviders.push(preset.name)
      }
      const key = `${preset.id}|${row.entryId ?? row.moduleName}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        entryId: row.entryId ?? row.moduleName,
        moduleName: row.moduleName,
        enabled: row.enabled,
        fiberPhase: row.fiberPhase,
        half: 'preset',
        source: '预设',
        presetProviders: [preset.name],
        presetId: preset.id,
        ...(row.condition !== undefined ? { condition: row.condition } : {}),
      })
    }
  }
  return rows
}

/**
 * 归并界面半（客户端图谱 id 列表）与主进程半（Loader 条目）为单表，并追加预设组成行。
 * 全局平面行按 失败优先 → 来源 → 模块名 排序；预设组成行**保持组成顺序**附在其后
 * （与官方「该预设挂了哪些行」的阅读顺序一致），由 UI 侧按预设分组消费。
 */
function mergeEntries(
  clientIds: Iterable<string>,
  presets: PluginInventoryPreset[],
): PluginInventoryEntry[] {
  const merged = new Map<string, PluginInventoryEntry>()
  for (const id of clientIds) {
    if (INFRA_IDS.has(id)) continue
    merged.set(id, {
      entryId: id,
      moduleName: id,
      enabled: true,
      fiberPhase: 'active',
      half: 'client',
      source: classifyPlugin(id),
      presetProviders: [],
    })
  }
  mergeLoaderEntries(merged)
  const globalRows = [...merged.values()].sort(compareEntries)
  return [...globalRows, ...collectPresetRows(presets, merged)]
}

/** 仅主进程半的清单行（启动日志用；不重扫客户端图谱文件）。 */
function loaderOnlyEntries(): PluginInventoryEntry[] {
  const merged = new Map<string, PluginInventoryEntry>()
  mergeLoaderEntries(merged)
  return [...merged.values()].sort(compareEntries)
}

/** 读 Agent 预设组成清单（服务未装载或读取失败时返回空数组，不阻塞列表）。 */
async function readPresets(): Promise<PluginInventoryPreset[]> {
  if (boundPresets === undefined) return []
  try {
    const compositions = await boundPresets.compositionInventory()
    return compositions.map((composition) => ({
      id: composition.id,
      name: composition.name ?? composition.id,
      isDefault: composition.isDefault,
      ...(composition.broken !== undefined ? { broken: composition.broken } : {}),
      rows: composition.rows.map((row) => ({
        entryId: row.entryId,
        moduleName: row.moduleName,
        enabled: row.enabled,
        ...(row.condition !== undefined ? { condition: row.condition } : {}),
        fiberPhase: toFiberPhase(row.fiberState),
      })),
    }))
  } catch (error) {
    log.error('[dsh-cordis-inventory] Agent 预设组成读取失败:', error)
    return []
  }
}

/** 三源合并快照（自研「插件列表」Tab 的单一数据面）。 */
export async function buildPluginInventorySnapshot(): Promise<PluginInventorySnapshot> {
  const graph = generateBootGraph(undefined, buildThirdPartyBundles())
  const agentPresets = await readPresets()
  const entries = mergeEntries(
    graph.entries.map((entry) => entry.id),
    agentPresets,
  )
  return { entries, agentPresets }
}

/**
 * 绑定宿主服务面（boot 完成后由 main.ts 调用）。
 *
 * `pluginInventory/list` 在「插件列表」Tab 打开时才被调用，故「先注册、后绑定」
 * 不构成竞态；未绑定时快照退回仅客户端图谱（宿主侧插件缺失，日志会显式告警）。
 *
 * @param ctx 已就绪的 Cordis Context（`ctx.get(name)` 取服务）。
 */
export function bindCordisInventoryHost(ctx: HostContextLike): void {
  boundLoader = ctx.get('loader') as LoaderLike | undefined
  boundPresets = ctx.get('agentPresets') as AgentPresetsLike | undefined
  if (boundLoader === undefined) {
    log.error(
      '[dsh-cordis-inventory] 未取到 Cordis loader 服务——插件列表将退回仅客户端图谱（宿主侧插件缺失）',
    )
    return
  }
  const rows = loaderOnlyEntries()
  const groups: Record<PluginSource, string[]> = { 官方: [], 自研: [], 第三方: [], 预设: [] }
  for (const row of rows) groups[row.source].push(row.moduleName)
  log.ok(
    `[dsh-cordis-inventory] 宿主插件树已绑定（Loader 条目 ${rows.length} 个：官方 ${groups.官方.length} / 自研 ${groups.自研.length} / 第三方 ${groups.第三方.length}${boundPresets === undefined ? '；agentPresets 未装载，预设分组为空' : ''}）`,
  )
  for (const [label, ids] of Object.entries(groups) as Array<[PluginSource, string[]]>) {
    if (ids.length === 0) continue
    log.info(`[dsh-cordis-inventory] 宿主${label}插件（${ids.length}）：\n${formatPluginNames(ids)}`)
  }
}

/**
 * 注册插件清单数据面到 bridge unary 表（host 端，main.ts 装配段调用，bridge 已注册后）。
 *
 * 只注册 `pluginInventory/list`（自研「插件列表」Tab 的只读快照）。官方
 * `dynamicCordisRunner/inventory` 自 2026-09-10 起由已装载的官方宿主半提供
 * （创造模式 · dogfood #23），本兼容面**不再注册它**——unary 表优先于 apiProxy，
 * 重复注册会遮蔽官方实现。
 */
export function registerCordisInventoryCompat(): () => void {
  const pluginInventoryReply = async (): Promise<PluginInventorySnapshot> => buildPluginInventorySnapshot()
  registerMethod('pluginInventory/list', pluginInventoryReply)

  // 启动日志：界面半（客户端图谱）汇总 + 按来源逐名列出。主进程半在 boot 完成后的
  // bindCordisInventoryHost 中另报（此时 Loader 尚不可用）。
  const graph = generateBootGraph(undefined, buildThirdPartyBundles())
  const groups: Record<PluginSource, string[]> = { 官方: [], 自研: [], 第三方: [], 预设: [] }
  for (const entry of graph.entries) {
    if (INFRA_IDS.has(entry.id)) continue
    groups[classifyPlugin(entry.id)].push(entry.id)
  }
  const total = groups.官方.length + groups.自研.length + groups.第三方.length
  log.ok(
    `[dsh-cordis-inventory] 插件清单数据面已注册（界面半 client bundle ${total} 个：官方 ${groups.官方.length} / 自研 ${groups.自研.length} / 第三方 ${groups.第三方.length}）`,
  )
  for (const [label, ids] of Object.entries(groups) as Array<[PluginSource, string[]]>) {
    if (ids.length === 0) continue
    log.info(`[dsh-cordis-inventory] 界面半${label}插件（${ids.length}）：\n${formatPluginNames(ids)}`)
  }
  return () => {
    // 卸载由 bridge.removeIpcHandlers 统一清空，无需单独操作
  }
}
