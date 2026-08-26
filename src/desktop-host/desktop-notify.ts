/**
 * dsh-desktop 桌面能力·系统通知（M2·通知闭环）。
 *
 * 项目内模块（M2 阶段，prepare/main 装配，暂不拆独立包）。消费 host apiProxy 的
 * `events.mux` 会话事件流，按帧类型触发三类系统通知：
 *   - 审批：`approval/requested` → 提醒用户处理审批
 *   - 错误：帧类型含 `error`（如 `session/error`/`host/agent-error`）
 *   - 完成：`session/event` 的会话完成消息（精确判定待实机校准）
 * 窗口可见时不打扰；通知点击 → 定位并聚焦主窗口。审计经 `ctx.desktop.emitAction('notify.*')`。
 *
 * 安装时机：窗口创建后（main.ts bootstrap），复用 `apiProxy.events.mux`（独立冷流，
 * 与下行帧中继并存，各自消费互不影响）。返回清理函数（中止流）。
 *
 * 注意：Windows 未签名 dev 下系统 toast 可能受限（最坏仅审计 + 窗口前置，见 R-06 风险）。
 */

import { Notification, BrowserWindow } from 'electron'
import type { DownlinkEventStream } from './carrier-relay.js'
import type { DesktopCore } from '../types/desktop.js'

// ── 类型 ───────────────────────────────────────────────────────────

/** 通知安装选项。 */
export interface DesktopNotifyOptions {
  /** `ctx.desktop` 聚合服务（审计动作 + 下行事件）。 */
  desktop: DesktopCore
  /** host apiProxy 事件流（复用 `events.mux`，独立冷流次消费）。 */
  events: DownlinkEventStream
  /** 取当前主窗口（通知点击定位）。 */
  getWindow(): BrowserWindow | null
}

/**
 * 安装系统通知（消费 host 会话事件流）。仅在窗口创建后调用一次。
 *
 * @param options 安装选项。
 * @returns 清理函数（中止事件流）。
 */
export function installDesktopNotify(options: DesktopNotifyOptions): () => void {
  const { desktop, events, getWindow } = options
  const ac = new AbortController()

  /** 触发一条系统通知；点击定位主窗口。 */
  const notify = (title: string, body: string, action: string): void => {
    const win = getWindow()
    // 窗口可见时不打扰（后台驻留时才提醒）。
    if (win !== null && win.isVisible() && win.isFocused()) return
    desktop.emitAction(action, { title, body })
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, silent: true })
    n.on('click', () => {
      const target = getWindow()
      if (target !== null) {
        target.show()
        target.focus()
      }
    })
    n.show()
  }

  void (async () => {
    try {
      for await (const envelope of events.events.mux({}, ac.signal)) {
        const frame = envelope.payload as { type?: string; payload?: unknown } | undefined
        const frameType = frame?.type ?? ''
        if (frameType === 'approval/requested') {
          notify('需要审批', '会话请求你的审批，请前往处理。', 'notify.approval')
        } else if (frameType.includes('error')) {
          notify('会话错误', '任务执行出错。', 'notify.error')
        } else if (frameType === 'session/event') {
          // 完成判定精确化待实机校准：当前保守视为会话有事件推进 → 免打扰策略由窗口可见性兜底。
          notify('会话有新进展', '会话正在推进，点击查看。', 'notify.session')
        }
      }
    } catch {
      // 流关闭（应用退出/窗口销毁）——静默。
    }
  })()

  return () => ac.abort()
}
