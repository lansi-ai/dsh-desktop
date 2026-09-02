/**
 * dsh-desktop 桌面能力·全局快捷键（M2·d3 shortcuts/clipboard）。
 *
 * 项目内模块（M2 阶段，main.ts bootstrap 装配，暂不拆独立包）。职责：
 *   - **全局快捷键注册/注销**：经 Electron `globalShortcut` 注册系统级热键；
 *     触发时写审计（`desktop.emitAction`）+ 下行桌面事件（`sendDesktopEvent`）。
 *   - **预置快捷键**：`Alt+Shift+Q`（唤起/聚焦窗口）、`Alt+Shift+Space`（快速问答）。
 *   - 审计：快捷键触发动作经 `ctx.desktop.emitAction('shortcut.*')`（R-15）。
 *
 * 安装时机：窗口已创建后（main.ts bootstrap），因需 getWindow 引用。返回清理函数。
 */

import { globalShortcut, BrowserWindow } from 'electron'
import type { DesktopCore } from '../types/desktop.js'
import { shortcutRegisterSchema, shortcutUnregisterSchema } from '../types/desktop.js'
import { AppError, ErrorCodes } from '../types/errors.js'
import { log } from './log.js'

// ── 类型 ───────────────────────────────────────────────────────────

/** 快捷键安装选项。 */
export interface DesktopShortcutsOptions {
  /** 获取当前主窗口。 */
  getWindow(): BrowserWindow | null
  /** `ctx.desktop` 聚合服务（审计 + 下行事件）。 */
  desktop: DesktopCore
}

/** 已注册快捷键的跟踪状态。 */
interface RegisteredShortcut {
  accelerator: string
  action: string
}

// ── 实现 ───────────────────────────────────────────────────────────

/** 已注册快捷键表（accelerator → tracking）。 */
const registered = new Map<string, RegisteredShortcut>()

/**
 * 注册一个全局快捷键。
 *
 * @param options 安装选项。
 * @param accelerator Electron Accelerator 字符串。
 * @param action 触发时的桌面动作名。
 * @throws `AppError` (SHORTCUT_REGISTER_FAILED) 若注册失败。
 */
function registerShortcut(
  options: DesktopShortcutsOptions,
  accelerator: string,
  action: string,
): void {
  const parsed = shortcutRegisterSchema.parse({ accelerator, action })

  // 若已注册同一 accelerator，先注销旧的
  if (registered.has(parsed.accelerator)) {
    globalShortcut.unregister(parsed.accelerator)
  }

  const success = globalShortcut.register(parsed.accelerator, () => {
    options.desktop.emitAction('shortcut.trigger', { accelerator: parsed.accelerator, action: parsed.action })
    options.desktop.sendDesktopEvent({ action: parsed.action, payload: { accelerator: parsed.accelerator } })

    // 唤起/聚焦窗口特化：当 action 为 window-show 时自动显示并聚焦窗口
    if (parsed.action === 'window-show' || parsed.action === 'quick-ask') {
      const win = options.getWindow()
      if (win !== null) {
        win.show()
        win.focus()
      }
    }
  })

  if (!success) {
    throw new AppError(ErrorCodes.SHORTCUT_REGISTER_FAILED, `快捷键注册失败: ${parsed.accelerator}`)
  }

  registered.set(parsed.accelerator, { accelerator: parsed.accelerator, action: parsed.action })
  options.desktop.emitAction('shortcut.register', { accelerator: parsed.accelerator, action: parsed.action })
}

/**
 * 注销一个全局快捷键。
 *
 * @param options 安装选项。
 * @param accelerator 要注销的 Accelerator 字符串。
 * @throws `AppError` (SHORTCUT_NOT_REGISTERED) 若未注册。
 */
function unregisterShortcut(
  options: DesktopShortcutsOptions,
  accelerator: string,
): void {
  const parsed = shortcutUnregisterSchema.parse({ accelerator })

  if (!registered.has(parsed.accelerator)) {
    throw new AppError(ErrorCodes.SHORTCUT_NOT_REGISTERED, `快捷键未注册: ${parsed.accelerator}`)
  }

  globalShortcut.unregister(parsed.accelerator)
  registered.delete(parsed.accelerator)
  options.desktop.emitAction('shortcut.unregister', { accelerator: parsed.accelerator })
}

/**
 * 安装全局快捷键（预置 + 动态注册能力）。仅在窗口创建后调用。
 *
 * 预置快捷键失败降级为告警继续（dogfood #7）：全局热键是增强能力，被系统上
 * 其他应用占用（globalShortcut.register 返回 false）不应致命——此前抛 AppError
 * 打断 bootstrap → app.quit() → before-quit 拆桥 → 托盘关窗拦截中止退出，
 * 应用残留成「活着但 IPC 桥已卸」的僵尸态，renderer 全部报 No handler registered。
 *
 * @param options 安装选项。
 * @returns 清理函数（注销所有快捷键）。
 */
export function installDesktopShortcuts(options: DesktopShortcutsOptions): () => void {
  // ── 预置快捷键 ──────────────────────────────────────────────────
  const preset: ReadonlyArray<readonly [string, string]> = [
    ['Alt+Shift+Q', 'window-show'],
    ['Alt+Shift+Space', 'quick-ask'],
  ]
  const ok: string[] = []
  for (const [accelerator, action] of preset) {
    try {
      registerShortcut(options, accelerator, action)
      ok.push(accelerator)
    } catch (error) {
      log.warn(`[dsh-shortcuts] 预置快捷键注册失败（可能被其他应用占用，已跳过）: ${accelerator}`, error)
      options.desktop.emitAction('shortcut.register-failed', { accelerator, action })
    }
  }
  if (ok.length > 0) log.ok(`[dsh-shortcuts] 预置快捷键已注册：${ok.join(' ')}`)
  else log.warn('[dsh-shortcuts] 预置快捷键全部注册失败（增强能力降级，应用功能不受影响）')

  // ── 清理 ─────────────────────────────────────────────────────────
  return () => {
    globalShortcut.unregisterAll()
    registered.clear()
    log.info('[dsh-shortcuts] 全局快捷键已注销')
  }
}

/** 获取当前已注册快捷键数（供内部检查）。 */
export function getRegisteredShortcutCount(): number {
  return registered.size
}

/** 动态注册快捷键（bridge unary 方法调用入口）。 */
export function handleShortcutRegister(
  options: DesktopShortcutsOptions,
  params: unknown,
): { registered: boolean } {
  const parsed = shortcutRegisterSchema.parse(params)
  registerShortcut(options, parsed.accelerator, parsed.action)
  return { registered: true }
}

/** 动态注销快捷键（bridge unary 方法调用入口）。 */
export function handleShortcutUnregister(
  options: DesktopShortcutsOptions,
  params: unknown,
): { unregistered: boolean } {
  const parsed = shortcutUnregisterSchema.parse(params)
  unregisterShortcut(options, parsed.accelerator)
  return { unregistered: true }
}
