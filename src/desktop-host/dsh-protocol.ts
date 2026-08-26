/**
 * dsh-desktop 系统协议路由（M3-b1 `dsh://` 协议）。
 *
 * 支持的 action：
 *   - `dsh://open?session=xxx` → 聚焦/创建指定会话窗口（窗口去重）
 *   - `dsh://ask?q=xxx` → 唤起快速提问窗口 + 预填问题
 *   - `dsh://settings` → 打开桌面设置面板
 *
 * 架构：
 *   Electron `app.setAsDefaultProtocolClient('dsh')` → 系统 URL 唤起
 *   → `app.on('open-url')` / second-instance 参数
 *   → parseDshUrl() → routeDshProtocol() → 对应桌面动作
 *
 * 安全（R10）：当前版本信任本地系统协议调用来源。后续版本可加白名单校验。
 */

import { BrowserWindow } from 'electron'
import type { DesktopCore } from '../types/desktop.js'
import {
  dshProtocolOpenSchema,
  dshProtocolAskSchema,
  dshProtocolActionSchema,
  type DshProtocolAction,
  type DshProtocolResult,
} from '../types/desktop.js'
import type { WindowManager } from './window-manager.js'

// ── 类型定义 ─────────────────────────────────────────────────────────

/** dsh:// 协议已解析的路由。 */
export interface ParsedDshUrl {
  /** 协议 action（open / ask / settings）。 */
  action: DshProtocolAction
  /** 查询参数。 */
  params: Record<string, string>
}

/** dsh:// 协议路由选项。 */
export interface DshProtocolOptions {
  /** 获取主窗口。 */
  getWindow(): BrowserWindow | null
  /** `ctx.desktop` 聚合服务（审计 + 下行事件）。 */
  desktop: DesktopCore
  /** 窗口管理器（会话聚焦/创建）。 */
  windowManager: WindowManager | null
}

// ── URL 解析 ─────────────────────────────────────────────────────────

/**
 * 解析 `dsh://` URL 为结构化路由。
 *
 * 支持的 URL 格式：
 *   - `dsh://open?session=abc123`
 *   - `dsh://ask?q=你好`
 *   - `dsh://settings`
 *
 * @param url 完整 URL（含 `dsh://` 前缀）。
 * @returns 解析结果；无效 URL 返回 null。
 */
export function parseDshUrl(url: string): ParsedDshUrl | null {
  try {
    // 去除协议前缀
    const withoutProtocol = url.replace(/^dsh:\/\//, '')

    // 分离 action 和 query
    const [pathPart, queryPart = ''] = withoutProtocol.split('?')
    const action = pathPart.trim() as DshProtocolAction

    // 验证 action
    dshProtocolActionSchema.parse(action)

    // 解析查询参数
    const params: Record<string, string> = {}
    if (queryPart.length > 0) {
      for (const pair of queryPart.split('&')) {
        const [key, value = ''] = pair.split('=')
        if (key.length > 0) {
          params[decodeURIComponent(key)] = decodeURIComponent(value)
        }
      }
    }

    return { action, params }
  } catch {
    return null
  }
}

// ── 路由处理 ───────────────────────────────────────────────────────────

/**
 * 聚焦/显示主窗口。
 */
function focusPrimaryWindow(options: DshProtocolOptions): void {
  const win = options.getWindow()
  if (win !== null) {
    if (!win.isVisible()) win.show()
    win.focus()
  }
}

/**
 * 处理 `dsh://open` → 聚焦/创建指定会话窗口。
 */
function handleOpen(
  options: DshProtocolOptions,
  params: Record<string, string>,
): DshProtocolResult {
  const parsed = dshProtocolOpenSchema.safeParse(params)
  if (!parsed.success) {
    return {
      success: false,
      action: 'open',
      message: '缺少 session 参数',
    }
  }

  const { session: sessionId } = parsed.data
  const { windowManager, desktop } = options

  if (windowManager === null) {
    return {
      success: false,
      action: 'open',
      message: '窗口管理器未初始化',
      sessionId,
    }
  }

  // 窗口去重：已存在会话 → 聚焦而非重复创建
  const existing = windowManager.focusSessionWindow(sessionId)
  if (existing.success) {
    desktop.emitAction('protocol.open.focus', { sessionId })
    return {
      success: true,
      action: 'open',
      sessionId,
      message: '已聚焦现有会话窗口',
    }
  }

  // 不存在则创建新窗口
  windowManager.createSessionWindow({ sessionId })
  desktop.emitAction('protocol.open.create', { sessionId })
  return {
    success: true,
    action: 'open',
    sessionId,
    message: '已创建新会话窗口',
  }
}

/**
 * 处理 `dsh://ask` → 唤起快速提问窗口。
 */
function handleAsk(
  options: DshProtocolOptions,
  params: Record<string, string>,
): DshProtocolResult {
  const parsed = dshProtocolAskSchema.safeParse(params)
  const question = parsed.success ? parsed.data.q : undefined

  focusPrimaryWindow(options)
  options.desktop.sendDesktopEvent({
    action: 'quick-ask',
    payload: { question: question ?? '' },
  })
  options.desktop.emitAction('protocol.ask', { question })

  return {
    success: true,
    action: 'ask',
    message: question ? `已唤起快速提问：${question}` : '已唤起快速提问',
  }
}

/**
 * 处理 `dsh://settings` → 打开桌面设置面板。
 */
function handleSettings(options: DshProtocolOptions): DshProtocolResult {
  focusPrimaryWindow(options)
  options.desktop.sendDesktopEvent({
    action: 'desktop-settings:open',
    payload: {},
  })
  options.desktop.emitAction('protocol.settings', {})

  return {
    success: true,
    action: 'settings',
    message: '已打开桌面设置面板',
  }
}

// ── 主路由函数 ─────────────────────────────────────────────────────────

/**
 * 路由 `dsh://` URL 到对应桌面动作。
 *
 * @param rawUrl 原始 URL（`dsh://...`）。
 * @param options 路由选项。
 * @returns 路由结果。
 */
export function routeDshProtocol(
  rawUrl: string,
  options: DshProtocolOptions,
): DshProtocolResult {
  const parsed = parseDshUrl(rawUrl)
  if (parsed === null) {
    return {
      success: false,
      action: 'settings', // fallback
      message: `无效的 dsh:// URL: ${rawUrl}`,
    }
  }

  const { action, params } = parsed

  switch (action) {
    case 'open':
      return handleOpen(options, params)
    case 'ask':
      return handleAsk(options, params)
    case 'settings':
      return handleSettings(options)
    default:
      return {
        success: false,
        action: 'settings',
        message: `未知的协议动作: ${action}`,
      }
  }
}

/**
 * 从命令行参数中提取 `dsh://` URL。
 *
 * @param argv process.argv
 * @returns 找到的 `dsh://` URL，未找到返回 null。
 */
export function extractDshUrlFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith('dsh://')) {
      return arg
    }
    // Windows 协议唤起可能带引号
    const trimmed = arg.replace(/^"|"$/g, '')
    if (trimmed.startsWith('dsh://')) {
      return trimmed
    }
  }
  return null
}
