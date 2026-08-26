/**
 * dsh-desktop Cordis inventory 兼容（M2·c 旧插件门禁·插件列表显示）。
 *
 * 官方 ui-cordis 插件面板经 `ctx.remote.dynamicCordisRunner.inventory()` 读
 * Cordis 插件清单。host 端因禁用 `cordis-host-runner`（与零端口 IPC 载波架构冲突）
 * 无该 API 域 → 404。本模块提供最小 inventory 等价面：
 *
 *   从 `__DSH_BOOT__` 图谱（boot-graph）生成的已装载 client 插件清单，
 *   使官方插件面板可显示列表（运行/停止动态插件等完整能力不在本范围）。
 *
 * 调用路径（对齐官方 TypertClientRemote）：
 *   ctx.remote.dynamicCordisRunner.inventory() → connection.rpc.call('/api',
 *   'dynamicCordisRunner/inventory') → bridge methodTable 分发（unary 优先于 apiProxy）。
 */

import { generateBootGraph } from './boot-graph.js'
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

// ── 实现 ───────────────────────────────────────────────────────────

/** 图谱中应排除的基础设施条目（非用户可见插件）。 */
const INFRA_IDS = new Set([
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-runtime',
  '@dsh-desktop/ipc-connection',
])

/**
 * 生成当前已装载插件的 inventory 行（从 __DSH_BOOT__ 图谱派生）。
 * 图谱外基础设施（client-modules/runtime/ipc-connection）不视为插件。
 */
export function buildCordisInventory(): CordisInventoryRow[] {
  const graph = generateBootGraph()
  return graph.entries
    .filter((entry) => !INFRA_IDS.has(entry.id))
    .map((entry) => {
      const packageId = `${entry.id}@desktop`
      return {
        pluginId: entry.id,
        agentId: 'desktop-host',
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

/**
 * 注册 `dynamicCordisRunner/inventory` 到 bridge unary 表（host 端 inventory 等价面）。
 * 在 main.ts 装配段调用（bridge 已注册后）。
 *
 * typert remote 存在 direct（`dynamicCordisRunner/inventory`）与 scoped
 * （`agent:dynamicCordisRunner/inventory`）两种 endpoint 形态，此处双注册提高命中。
 */
export function registerCordisInventoryCompat(): () => void {
  const rows = buildCordisInventory()
  const reply = async () => rows
  registerMethod('dynamicCordisRunner/inventory', reply)
  registerMethod('agent:dynamicCordisRunner/inventory', reply)
  console.log(`[dsh-cordis-inventory] 插件清单等价面已注册（${rows.length} 个插件，direct+scoped 双 endpoint）`)
  return () => {
    // 卸载由 bridge.removeIpcHandlers 统一清空，无需单独操作
  }
}