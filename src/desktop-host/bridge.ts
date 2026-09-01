/**
 * dsh-desktop IPC 桥宿主端（Step 4·IPC 载波四件套·桥）。
 *
 * 职责：
 * 1. unary 表分发：维护方法名→处理器映射，支持桌面专属方法与 apiProxy 代理
 * 2. respond 回填：renderer 上行 respond → 路由回 apiProxy.handleRespond
 * 3. 帧路由 per-window：宿主帧 → 指定窗口的 webContents.send('dsh:frame')
 * 4. 窗口就绪追踪：记录每个窗口的 ready 状态，避免过早推送
 *
 * 数据流（对齐 04-architecture.md §3）：
 *   renderer → IPC invoke('dsh:rpc') → bridge → ctx.apiProxy → 返回响应
 *   ctx 事件 → bridge.sendFrame() → webContents.send('dsh:frame') → renderer
 */

import { ipcMain, BrowserWindow, type WebContents } from 'electron'
import { IPC_CHANNELS } from '../types/channels.js'
import {
  rpcRequestSchema,
  clientResponseSchema,
  readyNotificationSchema,
  frameSchema,
  streamOpenSchema,
} from '../types/contract.js'
import type {
  RpcRequest,
  RpcSuccess,
  RpcError,
  Frame,
} from '../types/contract.js'
import { AppError, ErrorCodes } from '../types/errors.js'
import { logVerbose } from './log.js'

// ── 类型定义 ─────────────────────────────────────────────────────────

/** RPC 方法处理器签名。 */
export type RpcHandler = (
  params: unknown,
  context: { windowId: number },
) => unknown | Promise<unknown>

/** 帧处理器（监听宿主发起的帧事件）。 */
export type FrameHandler = (frame: Frame) => void

/** 桥配置选项。 */
export interface BridgeOptions {
  /** 默认 API 代理处理器（接收所有未匹配 unary 表的方法）。 */
  apiProxyHandler?: (request: RpcRequest) => unknown | Promise<unknown>
  /** 初始 unary 方法表。 */
  methods?: Record<string, RpcHandler>
  /** WindowManager 引用（用于 READY 通知后自动注入会话上下文）。 */
  windowManager?: { sendSessionContextToWindow: (windowId: number) => void }
}

// ── 内部状态 ─────────────────────────────────────────────────────────

/** unary 方法表。 */
const methodTable = new Map<string, RpcHandler>()

/** 默认 API 代理处理器。 */
let defaultApiProxyHandler: ((request: RpcRequest) => unknown | Promise<unknown>) | null = null

/**
 * 0.1.2 host 连接传输背板：逻辑流经 `typertGateway.wireStream.open` 订阅。
 * unary 仍走既有 defaultApiProxyHandler（main.bootstrap 装配为 connection fetch）。
 * 由 main.bootstrap 在完成 boot（typertGateway 就绪）后注入。
 */
interface HostConnectionTransport {
  /** host 端逻辑流 opener（返回 AsyncIterable 或 Promise<AsyncIterable>，yield 值）。 */
  openStream(endpoint: string, payload: unknown, signal: AbortSignal): AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>
}
let connectionTransport: HostConnectionTransport | null = null

/**
 * 已激活的逻辑流（streamId → 运行中的流句柄）。
 * 流帧经 webContents.send 推给对应窗口；流结束/错误发 stream-close。
 */
interface ActiveStream {
  webContents: WebContents
  ac: AbortController
  iterator: AsyncIterator<unknown>
  ended: boolean
  onDestroyed: () => void
}
const activeStreams = new Map<string, ActiveStream>()

/** WindowManager 引用（供 READY 通知后注入会话上下文）。 */
let windowManagerRef: { sendSessionContextToWindow: (windowId: number) => void } | null = null

/** 窗口就绪状态。 */
const windowStates = new Map<number, { ready: boolean }>()

/** 宿主帧事件监听器（用于宿主内其他模块订阅帧事件）。 */
const frameListeners = new Set<FrameHandler>()

// ── 桌面专属方法（unary 表） ─────────────────────────────────────────

/** 桌面平台信息。 */
interface PlatformInfo {
  platform: NodeJS.Platform
  version: string
  electronVersion: string
  chromeVersion: string
}

/** 注册桌面专属 unary 方法。 */
function registerDesktopMethods(): void {
  // desktop.getPlatformInfo
  methodTable.set('desktop.getPlatformInfo', async (_params: unknown): Promise<PlatformInfo> => {
    const { app } = await import('electron')
    return {
      platform: process.platform,
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
    }
  })

  // desktop.windowControl.focus
  methodTable.set('desktop.windowControl.focus', async (_params: unknown, context: { windowId: number }): Promise<void> => {
    const win = BrowserWindow.fromId(context.windowId)
    if (win !== null) {
      win.focus()
    }
  })

  // desktop.windowControl.minimize
  methodTable.set('desktop.windowControl.minimize', async (_params: unknown, context: { windowId: number }): Promise<void> => {
    const win = BrowserWindow.fromId(context.windowId)
    if (win !== null) {
      win.minimize()
    }
  })

  // desktop.windowControl.close
  methodTable.set('desktop.windowControl.close', async (_params: unknown, context: { windowId: number }): Promise<void> => {
    const win = BrowserWindow.fromId(context.windowId)
    if (win !== null) {
      win.close()
    }
  })

  // desktop.windowControl.maximize（自绘标题栏用：已最大化则还原）
  methodTable.set('desktop.windowControl.maximize', async (_params: unknown, context: { windowId: number }): Promise<void> => {
    const win = BrowserWindow.fromId(context.windowId)
    if (win !== null) {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    }
  })
}

// ── IPC 处理器注册 ───────────────────────────────────────────────────

/**
 * 注册 IPC 桥所有处理器。
 *
 * 必须在 app.whenReady() 后、创建 BrowserWindow 前调用。
 *
 * @param options 桥配置选项。
 */
export function registerIpcBridge(options?: BridgeOptions): void {
  if (options?.apiProxyHandler !== undefined) {
    defaultApiProxyHandler = options.apiProxyHandler
  }
  if (options?.windowManager !== undefined) {
    windowManagerRef = options.windowManager
  }

  // 注册桌面专属方法
  registerDesktopMethods()

  // 合并用户提供的初始方法表
  if (options?.methods !== undefined) {
    for (const [method, handler] of Object.entries(options.methods)) {
      methodTable.set(method, handler)
    }
  }

  // ── dsh:rpc — 上行 client-request ────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.RPC, async (event, raw: unknown): Promise<RpcSuccess | RpcError> => {
    logVerbose('dsh-bridge', '收到 RPC 请求:', typeof raw === 'object' && raw !== null ? (raw as { method?: string }).method : String(raw))
    // 校验请求格式
    const parsed = rpcRequestSchema.safeParse(raw)
    if (!parsed.success) {
      return makeRpcError(
        new AppError(ErrorCodes.INVALID_ARGUMENT, 'RPC 请求格式无效', parsed.error.issues),
        'unknown',
      )
    }

    const request = parsed.data
    const window = BrowserWindow.fromWebContents(event.sender)
    const windowId = window?.id ?? -1

    try {
      // unary 表分发：先查桌面专属方法，再 fallback 到 apiProxy
      const handler = methodTable.get(request.method)
      if (handler !== undefined) {
        const result = await handler(request.params, { windowId })
        logVerbose('dsh-bridge', `RPC 成功: ${request.method}`)
        return { rpcId: request.rpcId, data: result }
      }
      logVerbose('dsh-bridge', `RPC 未命中 unary 表，fallback apiProxy: ${request.method}`)

      // fallback 到默认 apiProxy 处理器
      if (defaultApiProxyHandler !== null) {
        const result = await defaultApiProxyHandler(request)
        logVerbose('dsh-bridge', `RPC (apiProxy) 成功: ${request.method}`)
        return { rpcId: request.rpcId, data: result }
      }

      // 无处理器
      throw new AppError(ErrorCodes.METHOD_NOT_FOUND, `未找到 RPC 方法: ${request.method}`)
    } catch (error) {
      // 失败必显：终端只保留错误，便于定位断链
      console.error(`[dsh-bridge] RPC 失败 (${request.method}):`, error)
      return makeRpcError(error, request.rpcId)
    }
  })

  // ── dsh:respond — 上行帧应答 ─────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.RESPOND, async (_event, raw: unknown): Promise<{ accepted: boolean }> => {
    const parsed = clientResponseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AppError(ErrorCodes.INVALID_ARGUMENT, 'Respond 格式无效', parsed.error.issues)
    }

    // 委托给 apiProxy 处理 respond 回填
    if (defaultApiProxyHandler !== null) {
      await defaultApiProxyHandler({
        rpcId: parsed.data.rpcId,
        method: 'respond',
        params: parsed.data.body,
      })
      return { accepted: true }
    }

    console.warn(`[dsh-bridge] 无 apiProxy 处理器，respond 被丢弃 (rpcId: ${parsed.data.rpcId})`)
    return { accepted: false }
  })

  // ── dsh:stream-open — 打开逻辑流载波（0.1.2 renderer openStream 背板）──
  ipcMain.handle(IPC_CHANNELS.STREAM_OPEN, async (event, raw: unknown): Promise<{ opened: boolean }> => {
    const parsed = streamOpenSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AppError(ErrorCodes.INVALID_ARGUMENT, 'stream-open 格式无效', parsed.error.issues)
    }
    const { streamId, endpoint, payload } = parsed.data

    // 上行挂起（renderer closeStream 的 `__abort__` 哨兵）：中止对应流。
    if (endpoint === '__abort__') {
      abortStream(streamId)
      return { opened: false }
    }
    if (connectionTransport === null) {
      throw new AppError(ErrorCodes.METHOD_NOT_FOUND, 'host 逻辑流载波未就绪（typertGateway.wireStream.open 缺失）')
    }
    if (activeStreams.has(streamId)) {
      throw new AppError(ErrorCodes.INVALID_ARGUMENT, `逻辑流已激活: ${streamId}`)
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === null || window.webContents.isDestroyed()) {
      return { opened: false }
    }
    const webContents = window.webContents
    const ac = new AbortController()
    const stream = await connectionTransport.openStream(endpoint, payload, ac.signal)
    const iterator = stream[Symbol.asyncIterator]()
    const onDestroyed = (): void => abortStream(streamId)
    activeStreams.set(streamId, { webContents, ac, iterator, ended: false, onDestroyed })
    webContents.once('destroyed', onDestroyed)
    void pumpStream(streamId)
    return { opened: true }
  })

  // ── dsh:ready — renderer 就绪通知 ────────────────────────────────
  ipcMain.on(IPC_CHANNELS.READY, (_event, raw: unknown) => {
    const parsed = readyNotificationSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn('[dsh-bridge] 收到无效的 ready 通知:', parsed.error.issues)
      return
    }
    const windowId = parsed.data.windowId
    windowStates.set(windowId, { ready: true })
    console.log(`[dsh-bridge] 窗口 ${windowId} 就绪`)

    // 自动注入会话上下文（若 WindowManager 已设置）
    if (windowManagerRef !== null) {
      windowManagerRef.sendSessionContextToWindow(windowId)
    }
  })

  // ── desktop:invoke — 桌面能力统一调用入口 ──────────────────────
  ipcMain.handle(IPC_CHANNELS.DESKTOP_INVOKE, async (event, raw: unknown): Promise<unknown> => {
    const parsed = rpcRequestSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AppError(ErrorCodes.INVALID_ARGUMENT, 'desktop:invoke 格式无效', parsed.error.issues)
    }
    const request = parsed.data
    const window = BrowserWindow.fromWebContents(event.sender)
    const windowId = window?.id ?? -1

    try {
      const handler = methodTable.get(request.method)
      if (handler !== undefined) {
        const result = await handler(request.params, { windowId })
        console.log(`[dsh-desktop-invoke] 成功: ${request.method}`)
        return result
      }
      throw new AppError(ErrorCodes.METHOD_NOT_FOUND, `未找到桌面方法: ${request.method}`)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(ErrorCodes.METHOD_ERROR, error instanceof Error ? error.message : String(error))
    }
  })
}

// ── 方法注册/注销 ───────────────────────────────────────────────────

/**
 * 注册一个 unary 方法。
 *
 * @param method 方法名。
 * @param handler 处理器。
 */
export function registerMethod(method: string, handler: RpcHandler): void {
  methodTable.set(method, handler)
}

/**
 * 注销一个 unary 方法。
 *
 * @param method 方法名。
 */
export function unregisterMethod(method: string): void {
  methodTable.delete(method)
}

/**
 * 设置默认 API 代理处理器。
 *
 * @param handler 处理器。
 */
export function setApiProxyHandler(handler: (request: RpcRequest) => unknown | Promise<unknown>): void {
  defaultApiProxyHandler = handler
}

/**
 * 装配 0.1.2 host 连接传输背板（unary fetch + 逻辑流 opener）。
 * 由 main.bootstrap 在完成 boot（connection/typertGateway 就绪）后调用。
 *
 * @param transport 传输背板。
 */
export function setConnectionTransport(transport: HostConnectionTransport): void {
  connectionTransport = transport
}

/**
 * 泵取一条逻辑流的帧，逐帧推送对应窗口，至流结束/错误/中断。
 *
 * @param streamId 流标识。
 */
async function pumpStream(streamId: string): Promise<void> {
  const record = activeStreams.get(streamId)
  if (record === undefined) return
  const { webContents, iterator } = record
  try {
    while (!record.ended && !webContents.isDestroyed()) {
      const next = await iterator.next()
      if (next.done === true || record.ended || webContents.isDestroyed()) return
      webContents.send(IPC_CHANNELS.STREAM_FRAME, { streamId, value: next.value })
    }
  } catch (error) {
    if (record.ended || webContents.isDestroyed()) return
    finishStream(streamId, error instanceof Error ? error.message : String(error))
    return
  }
  finishStream(streamId, null)
}

/**
 * 中止一条逻辑流（renderer abort / 窗口销毁 / 应用退出）。
 *
 * @param streamId 流标识。
 */
function abortStream(streamId: string): void {
  activeStreams.get(streamId)?.ac.abort()
}

/**
 * 收尾一条逻辑流：中止、移除监听、清空记录，并向 renderer 发 stream-close。
 *
 * @param streamId 流标识。
 * @param message 错误消息；null 表示正常结束。
 */
function finishStream(streamId: string, message: string | null): void {
  const record = activeStreams.get(streamId)
  if (record === undefined) return
  activeStreams.delete(streamId)
  record.ac.abort()
  record.webContents.removeListener('destroyed', record.onDestroyed)
  if (!record.webContents.isDestroyed()) {
    record.webContents.send(IPC_CHANNELS.STREAM_CLOSE, { streamId, message })
  }
}

/**
 * 动态设置 WindowManager 引用（供 bootstrap 在 bridge 注册后调用）。
 *
 * @param wm WindowManager 实例。
 */
export function setWindowManager(wm: { sendSessionContextToWindow: (windowId: number) => void }): void {
  windowManagerRef = wm
}

// ── 帧管理 ──────────────────────────────────────────────────────────

/**
 * 向指定窗口推送下行帧。
 *
 * @param webContents 目标窗口的 WebContents。
 * @param frame 帧对象。
 * @returns 是否发送成功。
 */
export function sendFrame(webContents: WebContents, frame: Frame): boolean {
  // 校验帧格式
  const parsed = frameSchema.safeParse(frame)
  if (!parsed.success) {
    console.error('[dsh-bridge] 帧格式校验失败:', parsed.error.issues)
    return false
  }

  // 通知本地帧监听器
  for (const listener of frameListeners) {
    try {
      listener(frame)
    } catch {
      // 单个监听器异常不应影响帧发送
    }
  }

  // 发送到 renderer
  if (!webContents.isDestroyed()) {
    webContents.send(IPC_CHANNELS.FRAME, frame)
    return true
  }
  return false
}

/**
 * 向所有就绪窗口广播帧。
 *
 * @param frame 帧对象。
 */
export function broadcastFrame(frame: Frame): void {
  for (const [windowId, state] of windowStates) {
    if (!state.ready) continue
    const win = BrowserWindow.fromId(windowId)
    if (win === null || win.webContents.isDestroyed()) {
      windowStates.delete(windowId)
      continue
    }
    sendFrame(win.webContents, frame)
  }
}

/**
 * 注册宿主端帧监听器（用于宿主内模块订阅帧事件）。
 *
 * @param handler 帧处理器。
 * @returns 注销函数。
 */
export function onFrame(handler: FrameHandler): () => void {
  frameListeners.add(handler)
  return () => {
    frameListeners.delete(handler)
  }
}

// ── 窗口状态管理 ────────────────────────────────────────────────────

/**
 * 标记窗口为就绪状态。
 *
 * @param windowId 窗口 ID。
 */
export function markWindowReady(windowId: number): void {
  windowStates.set(windowId, { ready: true })
}

/**
 * 清理窗口状态（窗口关闭时调用）。
 *
 * @param windowId 窗口 ID。
 */
export function cleanupWindowState(windowId: number): void {
  windowStates.delete(windowId)
}

// ── 窗口事件广播 ────────────────────────────────────────────────────

/** 窗口事件通道名（preload 同步）。 */
const WINDOW_EVENT_CHANNEL = IPC_CHANNELS.WINDOW_EVENT

/**
 * 向所有就绪窗口广播窗口事件帧。
 *
 * @param frame 窗口事件帧。
 */
export function broadcastWindowEvent(frame: { type: string; payload: unknown; ts: number }): void {
  for (const [windowId, state] of windowStates) {
    if (!state.ready) continue
    const win = BrowserWindow.fromId(windowId)
    if (win === null || win.webContents.isDestroyed()) {
      windowStates.delete(windowId)
      continue
    }
    win.webContents.send(WINDOW_EVENT_CHANNEL, frame)
  }
}

// ── 窗口管理器方法注册 ──────────────────────────────────────────────

/**
 * 注册窗口管理器方法到 unary 表。
 *
 * @param windowManager WindowManager 实例。
 */
export function registerWindowManagerMethods(
  windowManager: {
    createSessionWindow: (request: { sessionId: string; bounds?: { x: number; y: number; width: number; height: number } }) => { success: boolean; message?: string; windowId?: number; sessionId?: string }
    closeSessionWindow: (sessionId: string) => { success: boolean; message?: string }
    closeWindowById: (windowId: number) => { success: boolean; message?: string }
    focusSessionWindow: (sessionId: string) => { success: boolean; message?: string }
    listActiveSessions: () => Array<{ sessionId: string; windowId: number; state: string }>
  },
): void {
  // desktop.window.create
  methodTable.set('desktop.window.create', async (params: unknown): Promise<{ success: boolean; message?: string; windowId?: number; sessionId?: string }> => {
    const p = params as { sessionId: string; bounds?: { x: number; y: number; width: number; height: number } }
    return windowManager.createSessionWindow({ sessionId: p.sessionId, bounds: p.bounds })
  })

  // desktop.window.closeBySession
  methodTable.set('desktop.window.closeBySession', async (params: unknown): Promise<{ success: boolean; message?: string }> => {
    const p = params as { sessionId: string }
    return windowManager.closeSessionWindow(p.sessionId)
  })

  // desktop.window.closeById
  methodTable.set('desktop.window.closeById', async (params: unknown): Promise<{ success: boolean; message?: string }> => {
    const p = params as { windowId: number }
    return windowManager.closeWindowById(p.windowId)
  })

  // desktop.window.focusBySession
  methodTable.set('desktop.window.focusBySession', async (params: unknown): Promise<{ success: boolean; message?: string }> => {
    const p = params as { sessionId: string }
    return windowManager.focusSessionWindow(p.sessionId)
  })

  // desktop.window.listSessions
  methodTable.set('desktop.window.listSessions', async (): Promise<Array<{ sessionId: string; windowId: number; state: string }>> => {
    return windowManager.listActiveSessions()
  })

  console.log('[dsh-bridge] 窗口管理器方法已注册')
}

/**
 * 移除所有 IPC 处理器并清理状态（应用退出时调用）。
 */
export function removeIpcHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.RPC)
  ipcMain.removeHandler(IPC_CHANNELS.RESPOND)
  ipcMain.removeHandler(IPC_CHANNELS.STREAM_OPEN)
  ipcMain.removeHandler(IPC_CHANNELS.DESKTOP_INVOKE)
  ipcMain.removeAllListeners(IPC_CHANNELS.READY)
  // 中止全部激活的逻辑流（应用退出清理）。
  for (const streamId of [...activeStreams.keys()]) {
    const record = activeStreams.get(streamId)
    activeStreams.delete(streamId)
    record?.webContents.removeListener('destroyed', record.onDestroyed)
    record?.ac.abort()
  }
  methodTable.clear()
  windowStates.clear()
  frameListeners.clear()
  defaultApiProxyHandler = null
  connectionTransport = null
}

// ── 内部工具 ─────────────────────────────────────────────────────────

/** 将任意错误转换为 RpcError 响应。 */
function makeRpcError(error: unknown, rpcId: string): RpcError {
  if (error instanceof AppError) {
    return {
      rpcId,
      error: {
        code: error.code,
        message: error.message,
        ...(error.data !== undefined ? { data: error.data } : {}),
      },
    }
  }
  return {
    rpcId,
    error: {
      code: ErrorCodes.METHOD_ERROR,
      message: error instanceof Error ? error.message : String(error),
    },
  }
}