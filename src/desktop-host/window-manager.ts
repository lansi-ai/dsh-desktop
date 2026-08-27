/**
 * dsh-desktop 窗口管理器（M3-a1·WindowManager 基建）。
 *
 * 职责：
 * 1. 窗口注册表：维护 windowId → WindowRecord + sessionId → windowId 双向绑定
 * 2. 窗口创建/销毁/聚焦 API：供 bridge methodTable 和 main.ts bootstrap 调用
 * 3. 窗口间广播帧：会话列表变化 → 广播到所有就绪窗口
 * 4. 窗口状态持久化预留：bounds/会话绑定存 settings-file（M3-a3 实现）
 *
 * 数据流：
 *   renderer → IPC invoke('desktop:invoke', 'desktop.window.*') → bridge → WindowManager
 *   WindowManager → broadcastFrame() → bridge.broadcastFrame() → 所有就绪窗口 webContents.send
 */

import { BrowserWindow, screen } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  WindowRecord,
  WindowState as WindowStateType,
  WindowBounds,
  ActiveSession,
  WindowOperationResponse,
  WindowBroadcastFrame,
  CreateWindowRequest,
  WindowPersistState,
  PersistWindowEntry,
} from '../types/window.js'
import {
  WindowEvent,
  WindowState,
  windowPersistStateSchema,
} from '../types/window.js'
import { IPC_CHANNELS } from '../types/channels.js'
import { broadcastWindowEvent, cleanupWindowState } from './bridge.js'
import { isVerbose } from './log.js'
import type { DownlinkEventStream, DownlinkRelay } from './carrier-relay.js'
import { startDownlinkRelay } from './carrier-relay.js'

// ── 配置常量 ────────────────────────────────────────────────────────

/** 默认窗口边界（1200×800，从主窗口级联偏移）。 */
const DEFAULT_BOUNDS: WindowBounds = { x: 100, y: 80, width: 1200, height: 800 }

/** 级联偏移量（新窗口相对上一个窗口的像素偏移）。 */
const CASCADE_OFFSET = 30

// ── 窗口管理器接口 ─────────────────────────────────────────────────

/** 窗口管理器对外 API。 */
export interface WindowManager {
  /**
   * 创建绑定会话的新窗口。
   * 若会话已绑定窗口则聚焦而非重复创建。
   */
  createSessionWindow(request: CreateWindowRequest): WindowOperationResponse
  /**
   * 关闭指定会话的窗口。
   */
  closeSessionWindow(sessionId: string): WindowOperationResponse
  /**
   * 关闭指定窗口 ID。
   */
  closeWindowById(windowId: number): WindowOperationResponse
  /**
   * 聚焦指定会话的窗口。
   */
  focusSessionWindow(sessionId: string): WindowOperationResponse
  /**
   * 聚焦指定窗口 ID。
   */
  focusWindowById(windowId: number): WindowOperationResponse
  /**
   * 列出所有活动会话窗口。
   */
  listActiveSessions(): ActiveSession[]
  /**
   * 获取指定会话的窗口记录（不存在返回 undefined）。
   */
  getWindowBySession(sessionId: string): WindowRecord | undefined
  /**
   * 获取指定窗口 ID 的窗口记录（不存在返回 undefined）。
   */
  getWindowById(windowId: number): WindowRecord | undefined
  /**
   * 获取所有窗口记录快照。
   */
  getAllWindows(): WindowRecord[]
  /**
   * 更新窗口状态（焦点/最小化/隐藏）。
   */
  updateWindowState(windowId: number, state: WindowStateType): void
  /**
   * 更新窗口边界。
   */
  updateWindowBounds(windowId: number, bounds: WindowBounds): void
  /**
   * 从窗口注册表中移除窗口（窗口销毁时调用）。
   */
  removeWindow(windowId: number): void
  /**
   * 向指定窗口推送会话上下文（窗口就绪后自动注入）。
   */
  sendSessionContextToWindow(windowId: number): void
  /**
   * 向所有窗口广播会话列表更新（Host 侧会话变化时调用）。
   */
  syncSessionListToAllWindows(): void
  /**
   * 立即保存窗口状态到持久化文件（应用退出前调用）。
   */
  saveState(): Promise<void>
  /**
   * 加载已持久化的窗口状态（启动时调用）。
   */
  loadState(): Promise<WindowPersistState | null>
  /**
   * 恢复已持久化的会话窗口（在 Host 就绪后调用）。
   */
  restorePersistedWindows(state: WindowPersistState): void
  /**
   * 初始化 WindowManager（在 bootstrap 中调用一次）。
   */
  initialize(): void
  /**
   * 释放所有窗口管理器资源（应用退出时调用）。
   */
  dispose(): void
}

// ── 依赖注入接口 ────────────────────────────────────────────────────

/** WindowManager 创建选项。 */
export interface WindowManagerOptions {
  /** 获取主窗口（无会话绑定时的窗口）。 */
  getMainWindow: () => BrowserWindow | null
  /** 获取应用图标路径。 */
  getAppIconPath: () => string
  /** 宿主 apiProxy（用于 per-window 下行帧中继）。 */
  apiProxy?: DownlinkEventStream
  /**
   * 获取窗口状态持久化文件路径（绝对路径）。
   * 若未提供则跳过持久化功能。
   */
  getStateFilePath?: () => string
}

// ── 内部状态 ────────────────────────────────────────────────────────

/** 窗口注册表：windowId → WindowRecord。 */
const windowRegistry = new Map<number, WindowRecord>()

/** 会话绑定表：sessionId → windowId。 */
const sessionToWindow = new Map<string, number>()

/** 窗口下行帧中继句柄表：windowId → DownlinkRelay。 */
const windowRelays = new Map<number, DownlinkRelay>()

/** 管理器是否已初始化。 */
let initialized = false

/** 持久化文件路径（由 getStateFilePath 注入）。 */
let stateFilePath: string | null = null

/** 持久化 debounce 定时器（避免窗口拖动时频繁写盘）。 */
let persistTimer: ReturnType<typeof setTimeout> | null = null

/** Debounce 间隔（ms）：窗口停止变化后再写盘。 */
const PERSIST_DEBOUNCE_MS = 500

/** 当前 WindowManager 选项（供 restorePersistedWindows 使用）。 */
let currentOptions: WindowManagerOptions | null = null

/** 获取级联边界（新窗口相对上一个窗口偏移）。 */
function cascadeBounds(): WindowBounds {
  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  if (windows.length === 0) return { ...DEFAULT_BOUNDS }
  const last = windows[windows.length - 1]
  const b = last.getBounds()
  // 级联偏移 + 边界保护
  let nx = b.x + CASCADE_OFFSET
  let ny = b.y + CASCADE_OFFSET
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  if (nx + DEFAULT_BOUNDS.width > sw) nx = 0
  if (ny + DEFAULT_BOUNDS.height > sh) ny = 0
  return { x: nx, y: ny, width: DEFAULT_BOUNDS.width, height: DEFAULT_BOUNDS.height }
}

// ── 持久化存储 ──────────────────────────────────────────────────────

/**
 * 调度 debounce 写盘。窗口位置/大小变化时调用，debounce 500ms 后实际写盘。
 */
function schedulePersist(): void {
  if (stateFilePath === null) return
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void savePersistState()
  }, PERSIST_DEBOUNCE_MS)
}

/**
 * 立即保存窗口状态（不 debounce，用于窗口关闭/应用退出时）。
 */
async function savePersistState(): Promise<void> {
  if (stateFilePath === null) return
  try {
    // 收集当前窗口快照
    const windows: PersistWindowEntry[] = Array.from(windowRegistry.values())
      .filter((w) => w.state !== WindowState.DESTROYED && w.sessionId.length > 0)
      .map((w, idx) => ({
        sessionId: w.sessionId,
        bounds: w.bounds,
        zIndex: idx,
        state: w.state,
        savedAt: Date.now(),
      }))

    // 主窗口边界
    const mainWin = BrowserWindow.getAllWindows()[0]
    const mainBounds = mainWin !== undefined ? mainWin.getBounds() : undefined

    const state: WindowPersistState = {
      version: 1,
      windows,
      mainWindowBounds: mainBounds,
      savedAt: Date.now(),
    }

    const dir = join(stateFilePath, '..')
    await mkdir(dir, { recursive: true })
    await writeFile(stateFilePath, JSON.stringify(state, null, 2), 'utf-8')
    console.log(`[dsh-window-manager] 窗口状态已持久化: ${windows.length} 个会话窗口`)
  } catch (err) {
    console.error('[dsh-window-manager] 窗口状态持久化失败:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * 加载已持久化的窗口状态（启动时调用）。
 * @returns 持久化状态或 null（无存档或解析失败）。
 */
async function loadPersistState(): Promise<WindowPersistState | null> {
  if (stateFilePath === null) return null
  try {
    const raw = await readFile(stateFilePath, 'utf-8')
    const parsed = windowPersistStateSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      console.warn('[dsh-window-manager] 窗口状态持久化文件格式无效:', parsed.error.issues)
      return null
    }
    console.log(`[dsh-window-manager] 已加载持久化窗口状态: ${parsed.data.windows.length} 个会话窗口`)
    return parsed.data
  } catch {
    // 文件不存在或读取失败 → 返回 null（首次启动场景）
    console.log('[dsh-window-manager] 无持久化窗口状态（首次启动或文件不存在）')
    return null
  }
}

// ── 广播辅助 ────────────────────────────────────────────────────────

/** 向所有就绪窗口广播窗口事件帧（委托给 bridge）。 */
function broadcastToAllWindows(frame: WindowBroadcastFrame): void {
  broadcastWindowEvent({
    type: frame.type,
    payload: frame.payload,
    ts: frame.ts,
  })
}

/** 广播会话列表更新。 */
function broadcastSessionListUpdated(): void {
  const sessions = Array.from(windowRegistry.values())
    .filter((w) => w.state !== WindowState.DESTROYED && w.sessionId.length > 0)
    .map((w) => ({
      sessionId: w.sessionId,
      windowId: w.windowId,
      state: w.state,
      unreadCount: 0,
    }))

  broadcastToAllWindows({
    type: WindowEvent.SESSION_LIST_UPDATED,
    payload: { sessions },
    ts: Date.now(),
  })
}

// ── 创建/销毁浏览器窗口 ────────────────────────────────────────────

/**
 * 创建新的 BrowserWindow 并加载 dsh-ui://app/index.html。
 *
 * @param sessionId 绑定的会话 ID。
 * @param bounds 初始边界。
 * @param options 管理器选项。
 * @param apiProxy 宿主 apiProxy（可选，用于 per-window 帧中继）。
 * @returns 新创建的 BrowserWindow。
 */
function createBrowserWindow(
  sessionId: string,
  bounds: WindowBounds,
  options: WindowManagerOptions,
  apiProxy?: DownlinkEventStream,
): BrowserWindow {
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    show: false,
    icon: options.getAppIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: undefined, // preload 路径在 bootstrap 中设置
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  win.setMenuBarVisibility(false)
  win.removeMenu()

  // 开发快捷键：Ctrl+Shift+I 打开 DevTools
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools()
    }
  })

  win.webContents.on('did-finish-load', () => {
    console.log(`[dsh-window-manager] 会话窗口加载完成: ${sessionId} (windowId=${win.id})`)
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[dsh-window-manager] 会话窗口加载失败 (${errorCode}): ${errorDescription} URL: ${validatedURL}`)
  })

  // 渲染进程日志转发（终端降噪：默认仅 WARN/ERROR，DSH_VERBOSE=1 全量）
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (!isVerbose() && level < 2) return
    const prefix = level === 3 ? '[renderer-ERROR]' : level === 2 ? '[renderer-WARN]' : level === 1 ? '[renderer-INFO]' : '[renderer-VERBOSE]'
    console.log(`${prefix} ${message} (line ${line}, ${sourceId})`)
  })

  // 窗口生命周期事件
  win.once('ready-to-show', () => win.show())

  win.on('focus', () => {
    updateWindowState(win.id, WindowState.ACTIVE)
    const rec = windowRegistry.get(win.id)
    if (rec !== undefined) {
      rec.lastFocusedAt = Date.now()
      broadcastToAllWindows({
        type: WindowEvent.WINDOW_STATE_CHANGED,
        payload: { windowId: win.id, state: WindowState.ACTIVE, sessionId: rec.sessionId },
        ts: Date.now(),
      })
    }
  })

  win.on('blur', () => {
    const rec = windowRegistry.get(win.id)
    if (rec !== undefined && rec.state === WindowState.ACTIVE) {
      updateWindowState(win.id, WindowState.INACTIVE)
    }
  })

  win.on('minimize', () => {
    updateWindowState(win.id, WindowState.MINIMIZED)
  })

  win.on('restore', () => {
    updateWindowState(win.id, WindowState.INACTIVE)
  })

  // 窗口移动/缩放时更新 bounds 并触发 debounce 持久化
  win.on('move', () => {
    const bounds = win.getBounds()
    updateWindowBounds(win.id, bounds)
  })

  win.on('resize', () => {
    const bounds = win.getBounds()
    updateWindowBounds(win.id, bounds)
  })

  win.on('closed', () => {
    const rec = windowRegistry.get(win.id)
    if (rec !== undefined) {
      // 清理中继
      const relay = windowRelays.get(win.id)
      if (relay !== undefined) {
        relay.stop()
        windowRelays.delete(win.id)
      }
      removeWindow(win.id)
      cleanupWindowState(win.id)
      console.log(`[dsh-window-manager] 窗口已关闭: ${rec.sessionId} (windowId=${win.id})`)
    }
  })

  // 加载官方 UI
  void win.loadURL('dsh-ui://app/index.html')

  // 启动 per-window 下行帧中继
  if (apiProxy !== undefined) {
    const relay = startDownlinkRelay(apiProxy, win.webContents)
    windowRelays.set(win.id, relay)
    console.log(`[dsh-window-manager] 窗口下行帧中继已启动: windowId=${win.id}`)
  }

  return win
}

// ── 状态操作 ────────────────────────────────────────────────────────

/** 更新窗口状态并广播变化。 */
function updateWindowState(windowId: number, state: WindowStateType): void {
  const rec = windowRegistry.get(windowId)
  if (rec === undefined || rec.state === state) return
  rec.state = state
  broadcastToAllWindows({
    type: WindowEvent.WINDOW_STATE_CHANGED,
    payload: { windowId, state, sessionId: rec.sessionId },
    ts: Date.now(),
  })
}

/** 更新窗口边界并记录。 */
function updateWindowBounds(windowId: number, bounds: WindowBounds): void {
  const rec = windowRegistry.get(windowId)
  if (rec !== undefined) {
    rec.bounds = bounds
    schedulePersist()
  }
}

/** 从注册表移除窗口。 */
function removeWindow(windowId: number): void {
  const rec = windowRegistry.get(windowId)
  if (rec !== undefined) {
    sessionToWindow.delete(rec.sessionId)
    windowRegistry.delete(windowId)
    broadcastSessionListUpdated()
    schedulePersist()
  }
}

/**
 * 向指定窗口推送会话上下文。
 * 窗口就绪后由 bridge READY 通知自动调用，将 sessionId 注入 renderer。
 */
function sendSessionContextToWindow(windowId: number): void {
  const rec = windowRegistry.get(windowId)
  if (rec === undefined || rec.sessionId.length === 0) {
    // 无会话绑定的窗口（主窗口），跳过
    return
  }
  const win = BrowserWindow.fromId(windowId)
  if (win === null || win.isDestroyed()) {
    return
  }
  // 推送会话上下文到 renderer
  win.webContents.send(IPC_CHANNELS.SESSION_CONTEXT, {
    sessionId: rec.sessionId,
    windowId: rec.windowId,
    ts: Date.now(),
  })
  console.log(`[dsh-window-manager] 会话上下文已推送: ${rec.sessionId} (windowId=${windowId})`)
}

/**
 * 向所有窗口广播会话列表更新。
 * 供 Host 侧会话变化（新建/删除会话）时主动同步。
 */
function syncSessionListToAllWindows(): void {
  broadcastSessionListUpdated()
}

// ── 主 API 实现 ─────────────────────────────────────────────────────

/** 创建绑定会话的窗口。 */
function createSessionWindow(
  request: CreateWindowRequest,
  options: WindowManagerOptions,
): WindowOperationResponse {
  const { sessionId } = request

  // 去重：会话已绑定窗口 → 聚焦
  const existingWindowId = sessionToWindow.get(sessionId)
  if (existingWindowId !== undefined) {
    const existingWin = BrowserWindow.fromId(existingWindowId)
    if (existingWin !== null && !existingWin.isDestroyed()) {
      if (existingWin.isMinimized()) existingWin.restore()
      existingWin.focus()
      console.log(`[dsh-window-manager] 会话窗口已存在，聚焦: ${sessionId} (windowId=${existingWindowId})`)
      return { success: true, message: '聚焦已有窗口', windowId: existingWindowId, sessionId }
    }
    // 窗口已销毁，清理旧绑定
    sessionToWindow.delete(sessionId)
    windowRegistry.delete(existingWindowId)
  }

  // 创建新窗口
  const bounds = request.bounds ?? cascadeBounds()
  const win = createBrowserWindow(sessionId, bounds, options, options.apiProxy)

  // 注册到注册表
  const now = Date.now()
  const record: WindowRecord = {
    windowId: win.id,
    sessionId,
    state: WindowState.ACTIVE,
    bounds,
    createdAt: now,
    lastFocusedAt: now,
  }
  windowRegistry.set(win.id, record)
  sessionToWindow.set(sessionId, win.id)

  // 标记为就绪（等待 renderer ready 通知）
  // 注意：markWindowReady 在 preload 发送 READY 通知时由 bridge 处理

  console.log(`[dsh-window-manager] 会话窗口已创建: ${sessionId} (windowId=${win.id})`)

  // 广播窗口创建事件
  broadcastToAllWindows({
    type: WindowEvent.WINDOW_CREATED,
    payload: { windowId: win.id, sessionId },
    ts: now,
  })
  broadcastSessionListUpdated()
  schedulePersist()

  return { success: true, message: '窗口已创建', windowId: win.id, sessionId }
}

/** 关闭指定会话的窗口。 */
function closeSessionWindow(sessionId: string): WindowOperationResponse {
  const windowId = sessionToWindow.get(sessionId)
  if (windowId === undefined) {
    return { success: false, message: `会话无绑定窗口: ${sessionId}`, sessionId }
  }
  return closeWindowById(windowId)
}

/** 关闭指定窗口 ID。 */
function closeWindowById(windowId: number): WindowOperationResponse {
  const win = BrowserWindow.fromId(windowId)
  if (win === null || win.isDestroyed()) {
    removeWindow(windowId)
    return { success: false, message: `窗口不存在或已销毁: ${windowId}`, windowId }
  }
  win.close()
  return { success: true, message: '窗口已关闭', windowId }
}

/** 聚焦指定会话的窗口。 */
function focusSessionWindow(sessionId: string): WindowOperationResponse {
  const windowId = sessionToWindow.get(sessionId)
  if (windowId === undefined) {
    return { success: false, message: `会话无绑定窗口: ${sessionId}`, sessionId }
  }
  return focusWindowById(windowId)
}

/** 聚焦指定窗口 ID。 */
function focusWindowById(windowId: number): WindowOperationResponse {
  const win = BrowserWindow.fromId(windowId)
  if (win === null || win.isDestroyed()) {
    return { success: false, message: `窗口不存在或已销毁: ${windowId}`, windowId }
  }
  if (win.isMinimized()) win.restore()
  win.focus()
  return { success: true, message: '窗口已聚焦', windowId }
}

/** 列出所有活动会话窗口。 */
function listActiveSessions(): ActiveSession[] {
  return Array.from(windowRegistry.values())
    .filter((w) => w.state !== WindowState.DESTROYED && w.sessionId.length > 0)
    .map((w) => ({
      sessionId: w.sessionId,
      windowId: w.windowId,
      state: w.state,
      unreadCount: 0,
    }))
}

/** 获取指定会话的窗口记录。 */
function getWindowBySession(sessionId: string): WindowRecord | undefined {
  const windowId = sessionToWindow.get(sessionId)
  return windowId !== undefined ? windowRegistry.get(windowId) : undefined
}

/** 获取指定窗口 ID 的窗口记录。 */
function getWindowById(windowId: number): WindowRecord | undefined {
  return windowRegistry.get(windowId)
}

/** 获取所有窗口记录快照。 */
function getAllWindows(): WindowRecord[] {
  return Array.from(windowRegistry.values())
}

// ── 初始化/销毁 ────────────────────────────────────────────────────

/** 初始化 WindowManager（在 bootstrap 中调用）。 */
/** 初始化（由工厂函数传入 options）。 */
function initializeWithOptions(options: WindowManagerOptions): void {
  if (initialized) {
    console.warn('[dsh-window-manager] 已初始化，忽略重复调用')
    return
  }
  // 保存当前选项供 restorePersistedWindows 使用
  currentOptions = options
  // 设置持久化路径
  if (options.getStateFilePath !== undefined) {
    stateFilePath = options.getStateFilePath()
  }
  initialized = true
  console.log('[dsh-window-manager] WindowManager 已初始化')
}

/** 释放所有窗口管理器资源。 */
function dispose(): void {
  // 先保存当前状态
  void savePersistState()
  for (const relay of windowRelays.values()) {
    relay.stop()
  }
  windowRelays.clear()
  windowRegistry.clear()
  sessionToWindow.clear()
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  initialized = false
  console.log('[dsh-window-manager] WindowManager 已释放')
}

/** 恢复已持久化的会话窗口。 */
function restorePersistedWindows(state: WindowPersistState): void {
  if (currentOptions === null) {
    console.warn('[dsh-window-manager] currentOptions 未初始化，跳过窗口恢复')
    return
  }

  const mainWin = BrowserWindow.getAllWindows()[0]
  if (mainWin !== undefined && state.mainWindowBounds !== undefined) {
    mainWin.setBounds(state.mainWindowBounds)
    console.log('[dsh-window-manager] 主窗口边界已恢复')
  }

  // 按 zIndex 排序恢复窗口
  const sorted = [...state.windows].sort((a, b) => a.zIndex - b.zIndex)
  for (const entry of sorted) {
    console.log(`[dsh-window-manager] 恢复会话窗口: ${entry.sessionId}`)
    const win = createBrowserWindow(
      entry.sessionId,
      entry.bounds,
      currentOptions,
      currentOptions.apiProxy,
    )
    const now = Date.now()
    windowRegistry.set(win.id, {
      windowId: win.id,
      sessionId: entry.sessionId,
      state: entry.state ?? WindowState.INACTIVE,
      bounds: entry.bounds,
      createdAt: now,
      lastFocusedAt: now,
    })
    sessionToWindow.set(entry.sessionId, win.id)
  }
  broadcastSessionListUpdated()
  console.log(`[dsh-window-manager] 已恢复 ${sorted.length} 个会话窗口`)
}

// ── 导出工厂函数 ────────────────────────────────────────────────────

/**
 * 创建 WindowManager 实例。
 *
 * @param options 管理器选项。
 * @returns WindowManager API 对象。
 */
export function createWindowManager(options: WindowManagerOptions): WindowManager {
  return {
    createSessionWindow: (request: CreateWindowRequest): WindowOperationResponse => {
      if (!initialized) initializeWithOptions(options)
      return createSessionWindow(request, options)
    },
    closeSessionWindow,
    closeWindowById,
    focusSessionWindow,
    focusWindowById,
    listActiveSessions,
    getWindowBySession,
    getWindowById,
    getAllWindows,
    updateWindowState,
    updateWindowBounds,
    removeWindow,
    sendSessionContextToWindow,
    syncSessionListToAllWindows,
    saveState: savePersistState,
    loadState: loadPersistState,
    restorePersistedWindows,
    initialize: () => initializeWithOptions(options),
    dispose,
  }
}

// ── 便利：更新窗口状态/边界（供外部模块调用） ──────────────────────

/** 供 bridge/main 调用的窗口状态更新（导出方便测试）。 */
export function __updateWindowState(windowId: number, state: WindowStateType): void {
  updateWindowState(windowId, state)
}

/** 供 bridge/main 调用的窗口边界更新。 */
export function __updateWindowBounds(windowId: number, bounds: WindowBounds): void {
  updateWindowBounds(windowId, bounds)
}
