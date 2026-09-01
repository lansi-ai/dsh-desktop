/**
 * dsh-desktop roster/manifest 覆盖宿主面（Step 4·IPC 载波四件套 + Step 5·零端口 bundle 装载）。
 *
 * `__DSH_BOOT__` 图谱纯逻辑已抽至 `boot-graph.ts`（不依赖 Electron，可沙箱验证），
 * 本模块 re-export 该能力并保留需要 Electron 的 IPC 载波服务注册。
 *
 * 覆盖关系（对齐 04-architecture.md §4 官方三层模型映射）：
 *   connection (WebSocket) → IPC 载波（doFetch/rpc 经由 Electron IPC）
 *   client-runtime (HTTP) → IPC 载波（openMux/openHost 经由 Electron IPC）
 */

import type { WebContents } from 'electron'
import type { Frame } from '../types/contract.js'
import { sendFrame, broadcastFrame } from './bridge.js'
import { log } from './log.js'
import {
  generateBootGraph,
  generateFullBootScript,
  registerPreloadOnly,
  resolveBundlePath,
  resolveBundleRequest,
  buildThirdPartyBundleDecl,
  buildThirdPartyBundles,
  THIRD_PARTY_CLIENT_IDS,
  type BootBundleDecl,
} from './boot-graph.js'

export {
  generateBootGraph,
  generateFullBootScript,
  registerPreloadOnly,
  resolveBundlePath,
  resolveBundleRequest,
  buildThirdPartyBundleDecl,
  buildThirdPartyBundles,
  THIRD_PARTY_CLIENT_IDS,
}
export type { BootBundleDecl }

// ── 类型定义 ─────────────────────────────────────────────────────────

/** IPC 载波变体服务接口。 */
export interface IpcCarrierService {
  /** 发送帧到指定窗口。 */
  sendFrame(webContents: WebContents, frame: Frame): boolean
  /** 广播帧到所有窗口。 */
  broadcastFrame(frame: Frame): void
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

  log.ok('[dsh-manifest] IPC 载波服务已注册')
}

// ── 补丁条目（供 Cordis patch 系统使用） ─────────────────────────────

/**
 * 获取 0.1.2 IPC 载波变体的 Cordis patch 条目。
 *
 * 0.1.2 中不再禁用官方 connection——官方 host connection 提供
 * `ctx.connection.createSharedFetchHandler('/api')`，是桌面传输背板的核心；
 * `client-runtime` 包已删除（无此行可禁）。载波由 renderer `__DSH_TRANSPORT__`
 * + bridge 转发到 connection/typertGateway（见 main.ts 第 4 步）。
 *
 * 保留本函数仅作兼容面（历史调用点 boot.ts 已移除），返回空数组。
 *
 * @returns Cordis patch 条目数组（0.1.2 为空）。
 */
export function getIpcCarrierPatchEntries(): unknown[] {
  return []
}
