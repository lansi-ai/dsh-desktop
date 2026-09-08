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
  dshProtocolSettingsSchema,
  dshProtocolActionSchema,
  type DshProtocolAction,
  type DshProtocolDecision,
  type DshProtocolDecisionResult,
  type DshProtocolSource,
  type ProtocolSourceAllowlistItem,
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
  /** 唤起来源标识（调用方按入口注入：argv / open-url / launch）。 */
  source: DshProtocolSource
  /** 协议来源白名单（命中 → allow 全量；未命中 → 受限默认 degrade）。 */
  allowlist?: readonly ProtocolSourceAllowlistItem[]
  /** 外部唤起总开关（false 时未命中白名单的来源直接 deny）。默认 true。 */
  externalEnabled?: boolean
}

/** dsh:// URL 总长上限（M4-a2 R10 防超长串注入）。 */
export const MAX_DSH_URL_LENGTH = 2048

// ── URL 解析 ─────────────────────────────────────────────────────────

/**
 * 解析 `dsh://` URL 为结构化路由。
 *
 * 支持的 URL 格式：
 *   - `dsh://open?session=abc123`
 *   - `dsh://ask?q=你好`
 *   - `dsh://settings`
 *
 * 安全（M4-a2 R10）：query 经 `URLSearchParams` 解析 + 各 action 的 zod
 * `.strict()` 白名单校验（拒绝未知 key / 非法格式 / 超长），`decodeURIComponent`
 * 异常与多余 pathname 一律拒绝。
 *
 * @param url 完整 URL（含 `dsh://` 前缀）。
 * @returns 解析结果；无效 URL 返回 null。
 */
export function parseDshUrl(url: string): ParsedDshUrl | null {
  if (url.length > MAX_DSH_URL_LENGTH) return null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // 仅接受 `dsh://` scheme，且不得携带多余 pathname
  if (parsed.protocol !== 'dsh:' || (parsed.pathname !== '' && parsed.pathname !== '/')) {
    return null
  }

  const action = parsed.hostname as DshProtocolAction
  const actionCheck = dshProtocolActionSchema.safeParse(action)
  if (!actionCheck.success) return null

  const params: Record<string, string> = Object.fromEntries(parsed.searchParams.entries())
  const schema = querySchemaForAction(action)
  const parsedParams = schema.safeParse(params)
  if (!parsedParams.success) return null

  return { action, params }
}

/** 按 action 取对应的 query 白名单 schema（含 `.strict()` 拒绝未知 key）。 */
function querySchemaForAction(
  action: DshProtocolAction,
): typeof dshProtocolOpenSchema | typeof dshProtocolAskSchema | typeof dshProtocolSettingsSchema {
  switch (action) {
    case 'open':
      return dshProtocolOpenSchema
    case 'ask':
      return dshProtocolAskSchema
    case 'settings':
      return dshProtocolSettingsSchema
  }
}

/**
 * 来源授权判定（M4-a2 R10）。
 *
 * OS 协议唤起拿不到可靠来源方，故采用「受限默认 + 白名单升级」：
 *   - 命中白名单 → `allow`（全量动作）；
 *   - 未命中且外部唤起开启 → `degrade`（受限默认：open 仅聚焦不新建）；
 *   - 未命中且外部唤起关闭 → `deny`。
 */
export function authorizeDshUrl(
  source: DshProtocolSource,
  allowlist: readonly ProtocolSourceAllowlistItem[],
  externalEnabled: boolean,
): DshProtocolDecisionResult {
  const allowed = allowlist.some((item) => item.source === source)
  if (allowed) {
    return { decision: 'allow', source, authorized: true }
  }
  if (!externalEnabled) {
    return { decision: 'deny', source, authorized: false, reason: '外部协议唤起已关闭' }
  }
  return {
    decision: 'degrade',
    source,
    authorized: false,
    reason: '来源未在协议白名单，按受限默认处理',
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
 *
 * 受限默认（decision='degrade'，未授权来源）：只允许聚焦已存在会话，
 * 拒绝新建会话窗口（防恶意链接凭空开窗）。
 */
function handleOpen(
  options: DshProtocolOptions,
  params: Record<string, string>,
  decision: DshProtocolDecision,
): DshProtocolResult {
  const parsed = dshProtocolOpenSchema.safeParse(params)
  if (!parsed.success) {
    return {
      success: false,
      action: 'open',
      message: '缺少 session 参数或参数格式非法',
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

  // 受限来源：仅允许聚焦已有会话，拒绝新建会话窗口
  if (decision === 'degrade') {
    return {
      success: false,
      action: 'open',
      sessionId,
      message: '受限来源：无法新建会话窗口（仅可聚焦已存在会话）',
    }
  }

  // 不存在则创建新窗口（仅 allow 白名单来源放行）
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

  // 来源授权（M4-a2 R10 ASTM）：命中白名单 → allow；未命中 → degrade/deny
  const auth = authorizeDshUrl(
    options.source,
    options.allowlist ?? [],
    options.externalEnabled ?? true,
  )
  if (auth.decision === 'deny') {
    options.desktop.log('protocol.deny', { source: auth.source, reason: auth.reason })
    return {
      success: false,
      action: parsed.action,
      message: `dsh:// 唤起被拒绝${auth.reason ? `：${auth.reason}` : ''}`,
    }
  }
  // 受限默认生效 → 审计留痕（degrade 不阻断，仅 open 削权不新建）
  if (auth.decision === 'degrade') {
    options.desktop.log('protocol.degrade', { source: auth.source, reason: auth.reason })
  }

  const { action, params } = parsed

  switch (action) {
    case 'open':
      return handleOpen(options, params, auth.decision)
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
    const stripped = arg.replace(/^"|"$/g, '')
    // 分别尝试原始参数与被引号包裹的变体
    for (const candidate of [arg, stripped]) {
      if (candidate.startsWith('dsh://')) {
        // 超长视为异常，拒绝提取（M4-a2 R10）
        return candidate.length > MAX_DSH_URL_LENGTH ? null : candidate
      }
    }
  }
  return null
}
