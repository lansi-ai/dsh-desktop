/**
 * dsh-forge Cordis inventory 兼容（M2·c 旧插件门禁·插件列表显示）。
 *
 * 历史：官方 ui-cordis 面板经 `ctx.remote.dynamicCordisRunner.inventory()` 读 Cordis
 * 插件清单，而宿主半 `cordis-host-runner` 曾未装载 → 该 API 域 404，本模块提供最小
 * inventory 等价面保证面板/设置页仍能列出插件。
 *
 * **2026-09-10 起（创造模式 · dogfood #23）**：官方 `@deepseek-ai/dsh-cordis-host-runner`
 * 已装载，`dynamicCordisRunner` 域由官方实现提供 —— 本模块**只保留自研设置页所需的
 * `pluginInventory/list` 只读快照**（官方没有该端点），不再注册
 * `dynamicCordisRunner/inventory`：bridge 的 unary 表分发优先于 apiProxy，继续注册会
 * 遮蔽官方实现，让 ui-cordis 面板读到合成清单而非真实运行时。
 *
 * 清单来源：`__DSH_BOOT__` 图谱（boot-graph）生成的已装载 client 插件清单。
 */

import { generateBootGraph, buildThirdPartyBundles } from './boot-graph.js'
import { log } from './log.js'
import { registerMethod } from './bridge.js'

// ── 类型 ───────────────────────────────────────────────────────────

/** inventory 行最小结构（对齐 DynamicCordisInventoryRow 字段面）。 */
export interface CordisInventoryRow {
  pluginId: string
  agentId: string
  packages: Array<{
    packageId: string
    name: string
    purpose: string
    hasHostHalf: boolean
    hasClientHalf: boolean
  }>
  currentPackageId?: string
}

/** pluginInventory/list 快照行（对齐 PluginInventorySnapshot.entries 契约）。 */
export interface PluginInventoryEntry {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase: 'active'
}

// ── 实现 ───────────────────────────────────────────────────────────

/** 图谱中应排除的基础设施条目（非用户可见插件）。 */
const INFRA_IDS = new Set([
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-runtime',
  '@lansi-ai/dsh-ipc-connection',
])

/** 按包 scope 分类插件来源（官方 = @deepseek-ai，自研 = @lansi-ai，其余 = 第三方）。 */
function classifyPlugin(id: string): '官方' | '自研' | '第三方' {
  if (id.startsWith('@deepseek-ai/')) return '官方'
  if (id.startsWith('@lansi-ai/')) return '自研'
  return '第三方'
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
 * 生成当前已装载插件的 inventory 行（从 __DSH_BOOT__ 图谱派生）。
 * 图谱外基础设施（client-modules/runtime/ipc-connection）不视为插件。
 * 与 HTML 注入同源加载第三方插件（buildThirdPartyBundles），保证装配与列表一致。
 */
export function buildCordisInventory(): CordisInventoryRow[] {
  const graph = generateBootGraph(undefined, buildThirdPartyBundles())
  return graph.entries
    .filter((entry) => !INFRA_IDS.has(entry.id))
    .map((entry) => {
      const packageId = `${entry.id}@desktop`
      return {
        pluginId: entry.id,
        agentId: 'forge-host',
        packages: [
          {
            packageId,
            name: entry.id,
            purpose: '已装载 client 插件',
            hasHostHalf: false,
            hasClientHalf: true,
          },
        ],
        currentPackageId: packageId,
      }
    })
}

/** 由图谱生成 `pluginInventory.list` 快照（设置页「插件列表」Tab：只读当前 Loader inventory）。 */
export function buildPluginInventorySnapshot(): { entries: PluginInventoryEntry[] } {
  const graph = generateBootGraph(undefined, buildThirdPartyBundles())
  const entries = graph.entries
    .filter((entry) => !INFRA_IDS.has(entry.id))
    .map((entry) => ({
      entryId: entry.id,
      moduleName: entry.id,
      enabled: true,
      fiberPhase: 'active' as const,
    }))
  return { entries }
}

/**
 * 注册插件清单等价面到 bridge unary 表（host 端，main.ts 装配段调用，bridge 已注册后）。
 *
 * 只注册 `pluginInventory/list`（自研设置页「插件列表」Tab 的只读快照）。
 * 官方 `dynamicCordisRunner/inventory` 自 2026-09-10 起由已装载的官方宿主半提供
 * （创造模式 · dogfood #23），**本兼容面不再注册它**——unary 表优先于 apiProxy，
 * 重复注册会遮蔽官方实现。
 */
export function registerCordisInventoryCompat(): () => void {
  const rows = buildCordisInventory()
  const pluginInventoryReply = async () => buildPluginInventorySnapshot()
  registerMethod('pluginInventory/list', pluginInventoryReply)

  // 启动日志：汇总 + 按来源（官方/自研/第三方）逐名列出全部插件
  const groups: Record<'官方' | '自研' | '第三方', string[]> = { 官方: [], 自研: [], 第三方: [] }
  for (const row of rows) groups[classifyPlugin(row.pluginId)].push(row.pluginId)
  log.ok(`[dsh-cordis-inventory] 插件清单等价面已注册（共 ${rows.length} 个：官方 ${groups.官方.length} / 自研 ${groups.自研.length} / 第三方 ${groups.第三方.length}）`)
  for (const [label, ids] of Object.entries(groups) as Array<['官方' | '自研' | '第三方', string[]]>) {
    if (ids.length === 0) continue
    log.info(`[dsh-cordis-inventory] ${label}插件（${ids.length}）：\n${formatPluginNames(ids)}`)
  }
  return () => {
    // 卸载由 bridge.removeIpcHandlers 统一清空，无需单独操作
  }
}