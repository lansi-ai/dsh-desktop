/**
 * dsh-desktop roster/manifest 覆盖（Step 4·IPC 载波四件套·manifest）。
 *
 * 职责：
 * 1. 提供 IPC 载波变体的 Cordis 服务注册（connection + client-runtime 替换）
 * 2. 生成 `__DSH_BOOT__` 客户端 manifest 图谱（含 IPC 载波条目）
 * 3. 集成 bridge 宿主端桥，将 IPC 调用路由到 Cordis apiProxy
 *
 * 覆盖关系（对齐 04-architecture.md §4 官方三层模型映射）：
 *   connection (WebSocket)    → IPC 载波（doFetch/rpc 经由 Electron IPC）
 *   client-runtime (HTTP)     → IPC 载波（openMux/openHost 经由 Electron IPC）
 */

import { type WebContents } from 'electron'
import type { Frame } from '../types/contract.js'
import { sendFrame, broadcastFrame } from './bridge.js'

// ── 类型定义 ─────────────────────────────────────────────────────────

/** IPC 载波变体服务接口。 */
export interface IpcCarrierService {
  /** 发送帧到指定窗口。 */
  sendFrame(webContents: WebContents, frame: Frame): boolean
  /** 广播帧到所有窗口。 */
  broadcastFrame(frame: Frame): void
}

/** __DSH_BOOT__ manifest 图谱。 */
export interface DshBootGraph {
  rev: string
  entries: DshBootEntry[]
}

/** Manifest 条目。 */
export interface DshBootEntry {
  id: string
  name: string
  config?: Record<string, unknown>
}

// ── Manifest 图谱生成 ───────────────────────────────────────────────

/**
 * 生成完整的 __DSH_BOOT__ manifest 图谱。
 *
 * 当前：返回空条目列表，让 DSH 客户端使用默认初始化流程。
 * IPC 载波通过 preload.desktopBridge 独立提供。
 *
 * @param rev 图谱版本号。
 * @param extraEntries 额外条目（如 client 插件地址）。
 * @returns 完整 manifest 图谱。
 */
export function generateBootGraph(
  rev: string = `desktop-m1-${Date.now()}`,
  extraEntries?: DshBootEntry[],
): DshBootGraph {
  const entries: DshBootEntry[] = extraEntries ?? []

  return { rev, entries }
}

/**
 * 生成 boot manifest 注入脚本（HTML <head> 注入用）。
 *
 * @param graph 完整 manifest 图谱。
 * @param extraScript 额外脚本代码（可选）。
 * @returns 完整 <script> 标签注入内容。
 */
export function generateBootManifestScript(
  graph: DshBootGraph,
  extraScript?: string,
): string {
  const script = `window.__DSH_BOOT__ = ${JSON.stringify(graph)}`
  return `<script>${script}</script>${extraScript ?? ''}`
}

// ── IPC 载波服务注册 ────────────────────────────────────────────────

/**
 * 创建 IPC 载波服务实例。
 *
 * 在 Cordis Host 上下文中注册，提供 `connection` 和 `client-runtime`
 * 的 IPC 载波变体。
 *
 * @returns IPC 载波服务实例。
 */
export function createIpcCarrierService(): IpcCarrierService {
  return {
    sendFrame(webContents: WebContents, frame: Frame): boolean {
      return sendFrame(webContents, frame)
    },
    broadcastFrame(frame: Frame): void {
      broadcastFrame(frame)
    },
  }
}

/**
 * 在 Cordis 上下文中注册 IPC 载波服务。
 *
 * 此函数在 Cordis 插件初始化时调用，向 ctx 注册 desktop 专属服务。
 *
 * @param ctx Cordis 上下文。
 * @param apiProxy apiProxy 处理器（用于处理 RPC 调用）。
 */
export function registerIpcCarrierServices(
  ctx: unknown,
  apiProxy: {
    handleRpc: (request: { rpcId: string; method: string; params: unknown }) => Promise<unknown>
    handleRespond: (response: { rpcId: string; body: unknown }) => Promise<{ accepted: boolean }>
  },
): void {
  const cordisCtx = ctx as Record<string, unknown>

  // 注册 ipc-carrier 服务
  cordisCtx['ipc-carrier'] = createIpcCarrierService()

  // 注册 apiProxy 转发服务
  cordisCtx['api-proxy'] = {
    handleRpc: apiProxy.handleRpc.bind(apiProxy),
    handleRespond: apiProxy.handleRespond.bind(apiProxy),
  }

  console.log('[dsh-manifest] IPC 载波服务已注册')
}

// ── 补丁条目（供 Cordis patch 系统使用） ─────────────────────────────

/**
 * 获取 IPC 载波变体的 Cordis patch 条目。
 *
 * 禁用官方 WebSocket/HTTP 传输层（connection + client-runtime），
 * 这些服务由 IPC 载波变体在 bridge.ts 和 manifest.ts 层面替代。
 *
 * 注意：IPC 载波服务不是 Cordis 插件，而是通过 registerIpcCarrierServices()
 * 在 TypeScript 层直接注册到 Cordis 上下文。
 *
 * @returns Cordis patch 条目数组（仅禁用条目）。
 */
export function getIpcCarrierPatchEntries(): unknown[] {
  return [
    // 禁用官方 WebSocket/HTTP 传输层
    // IPC 载波变体由 bridge.ts + manifest.ts 在 TypeScript 层提供
    { id: 'connection', disabled: true },
    { id: 'client-runtime', disabled: true },
  ]
}

// ── Boot manifest 注入整合 ──────────────────────────────────────────

/**
 * 生成完整的 boot manifest 注入脚本（含 queueLoader shim）。
 *
 * 当前策略：注入空 __DSH_BOOT__（无自定义条目），让官方 UI 按默认流程初始化。
 * IPC 载波由 preload.desktopBridge 独立提供，不通过 DSH 客户端模块系统加载。
 *
 * 后续步骤：创建 @dsh-desktop/ipc-connection 客户端模块工厂，
 * 通过 queueLoader.load() 注册到 DSH 模块系统。
 *
 * @param rev 图谱版本号。
 * @param extraEntries 额外 client 插件条目。
 * @returns HTML 注入脚本字符串。
 */
export function generateFullBootScript(
  rev?: string,
  extraEntries?: DshBootEntry[],
): string {
  // 空 manifest — 让 DSH 客户端使用默认初始化流程
  const graph = generateBootGraph(rev, extraEntries)
  const queueLoader = `(()=>{
const pendingQueue=[]
window.__ModuleLoader__={
  mode:"queue",
  pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(options){
    if(this.mode!=="queue")throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot")
    const index=pendingQueue.findIndex(registration=>registration.id==="@deepseek-ai/dsh-client-modules/client.js")
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
})()`
  return `<script>${queueLoader}</script><script>window.__DSH_BOOT__ = ${JSON.stringify(graph)}</script>`
}