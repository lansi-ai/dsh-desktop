/**
 * dsh-desktop 命令面板 host 插件（M3-a4 command palette）。
 *
 * 职责：
 *   - 注册全局快捷键 `Cmd/Ctrl+Shift+P` → 唤起快速提问窗口
 *   - 管理命令面板 bridge 方法：openCommandPalette / quickAsk / switchSession
 *   - 通过 `desktop:event` 下行事件通知 renderer 打开面板
 *   - 命令面板 UI 由 renderer 侧 Slot 注入（desktop-cmdpalette-client.js）
 *
 * 架构：
 *   主进程全局快捷键 → 聚焦窗口 + 下行 desktop:event(quick-ask) → renderer 内快速提问 UI
 *   renderer Ctrl+K → client.js 捕获 → desktopBridge.openCommandPalette() → 主进程分发
 *
 * 安装时机：窗口已创建后（main.ts bootstrap）。返回清理函数。
 */

import { globalShortcut, BrowserWindow } from 'electron'
import type { DesktopCore } from '../types/desktop.js'
import {
  cmdPaletteOpenSchema,
  cmdPaletteQuickAskSchema,
  cmdPaletteSwitchSessionSchema,
} from '../types/desktop.js'
import type { WindowManager } from './window-manager.js'
import { log } from './log.js'
import { registerMethod, unregisterMethod } from './bridge.js'

// ── 类型定义 ─────────────────────────────────────────────────────────

/** 命令面板安装选项。 */
export interface DesktopCmdPaletteOptions {
  /** 获取主窗口。 */
  getWindow(): BrowserWindow | null
  /** `ctx.desktop` 聚合服务（审计 + 下行事件）。 */
  desktop: DesktopCore
  /** 窗口管理器（会话切换时聚焦/创建窗口）。 */
  windowManager: WindowManager | null
}

// ── 实现 ─────────────────────────────────────────────────────────────

/**
 * 唤起主窗口并聚焦。
 */
function focusPrimaryWindow(options: DesktopCmdPaletteOptions): void {
  const win = options.getWindow()
  if (win !== null) {
    if (!win.isVisible()) win.show()
    win.focus()
  }
}

/**
 * 向所有窗口下发桌面事件。
 */
function broadcastDesktopEvent(
  options: DesktopCmdPaletteOptions,
  action: string,
  payload?: unknown,
): void {
  options.desktop.sendDesktopEvent({ action, payload })
  options.desktop.emitAction('cmdpalette.trigger', { action, payload })
}

/**
 * 打开命令面板（通知 renderer 内的命令面板组件显示）。
 */
function openCommandPalette(options: DesktopCmdPaletteOptions, query?: string): void {
  focusPrimaryWindow(options)
  broadcastDesktopEvent(options, 'cmdpalette:open', { query: query ?? '' })
}

/**
 * 唤起快速提问（主进程全局快捷键触发）。
 */
function triggerQuickAsk(options: DesktopCmdPaletteOptions, question?: string): void {
  focusPrimaryWindow(options)
  broadcastDesktopEvent(options, 'quick-ask', { question: question ?? '' })
}

/**
 * 切换会话（聚焦对应窗口，不存在则创建）。
 */
function switchSession(
  options: DesktopCmdPaletteOptions,
  sessionId: string,
): { success: boolean; message?: string; sessionId?: string } {
  const wm = options.windowManager
  if (wm === null) {
    return { success: false, message: '窗口管理器未初始化' }
  }
  const result = wm.focusSessionWindow(sessionId) as { success: boolean; message?: string; sessionId?: string }
  if (!result.success && result.message?.includes('不存在')) {
    // 会话窗口不存在，创建新窗口
    wm.createSessionWindow({ sessionId })
    return { success: true, sessionId }
  }
  return result
}

/**
 * 安装命令面板（全局快捷键 + bridge 方法）。
 *
 * @param options 安装选项。
 * @returns 清理函数（注销快捷键 + 清理 bridge 方法）。
 */
export function installDesktopCmdPalette(
  options: DesktopCmdPaletteOptions,
): () => void {
  const { desktop } = options

  // ── 注册全局快捷键 Cmd/Ctrl+Shift+P → 快速提问 ─────────────────
  const QUICK_ASK_ACCELERATOR = 'CommandOrControl+Shift+P'

  const registered = globalShortcut.register(QUICK_ASK_ACCELERATOR, () => {
    desktop.emitAction('shortcut.trigger', {
      accelerator: QUICK_ASK_ACCELERATOR,
      action: 'quick-ask',
    })
    triggerQuickAsk(options)
  })

  if (!registered) {
    log.warn(`[dsh-cmdpalette] 全局快捷键注册失败: ${QUICK_ASK_ACCELERATOR}（可能已被其他应用占用）`)
  } else {
    desktop.emitAction('shortcut.register', {
      accelerator: QUICK_ASK_ACCELERATOR,
      action: 'quick-ask',
    })
    log.ok(`[dsh-cmdpalette] 全局快捷键已注册: ${QUICK_ASK_ACCELERATOR} → 快速提问`)
  }

  // ── Bridge 方法处理器 ──────────────────────────────────────────

  /** 命令面板打开请求（renderer Ctrl+K → host）。 */
  const handleOpen = (params: unknown): { opened: boolean } => {
    const parsed = cmdPaletteOpenSchema.parse(params)
    openCommandPalette(options, parsed.query)
    return { opened: true }
  }

  /** 快速提问请求（renderer → host 或全局快捷键触发）。 */
  const handleQuickAsk = (params: unknown): { triggered: boolean } => {
    const parsed = cmdPaletteQuickAskSchema.parse(params)
    triggerQuickAsk(options, parsed.question)
    return { triggered: true }
  }

  /** 会话切换请求（命令面板内选择会话 → host 聚焦/创建）。 */
  const handleSwitchSession = (params: unknown): { success: boolean; message?: string } => {
    const parsed = cmdPaletteSwitchSessionSchema.parse(params)
    return switchSession(options, parsed.sessionId)
  }

  /** 命令面板关闭请求。 */
  const handleClose = (_params: unknown): { closed: boolean } => {
    broadcastDesktopEvent(options, 'cmdpalette:close')
    return { closed: true }
  }

  /** 获取当前活动会话列表（供命令面板渲染）。 */
  const handleListSessions = (): Array<{ sessionId: string; windowId: number; state: string; title?: string }> => {
    const wm = options.windowManager
    if (wm === null) return []
    return wm.listActiveSessions()
  }

  // ── 注册到 bridge ──────────────────────────────────────────────

  registerMethod('desktop.cmdpalette.open', handleOpen)
  registerMethod('desktop.cmdpalette.quickAsk', handleQuickAsk)
  registerMethod('desktop.cmdpalette.switchSession', handleSwitchSession)
  registerMethod('desktop.cmdpalette.close', handleClose)
  registerMethod('desktop.cmdpalette.listSessions', handleListSessions)

  log.ok('[dsh-cmdpalette] 命令面板方法已注册')

  // ── 清理函数 ──────────────────────────────────────────────────
  return () => {
    if (registered) {
      globalShortcut.unregister(QUICK_ASK_ACCELERATOR)
      desktop.emitAction('shortcut.unregister', { accelerator: QUICK_ASK_ACCELERATOR })
    }
    unregisterMethod('desktop.cmdpalette.open')
    unregisterMethod('desktop.cmdpalette.quickAsk')
    unregisterMethod('desktop.cmdpalette.switchSession')
    unregisterMethod('desktop.cmdpalette.close')
    unregisterMethod('desktop.cmdpalette.listSessions')
    log.info('[dsh-cmdpalette] 命令面板已清理')
  }
}
