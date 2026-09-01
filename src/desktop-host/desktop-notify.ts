/**
 * dsh-desktop 桌面能力·系统通知（0.1.2 迁移 · host 事件直订阅）。
 *
 * 项目内模块（M2 阶段，prepare/main 装配，暂不拆独立包）。消费 host 侧 Cordis
 * 事件（官方转发白名单成员，主进程同进程 host 直订阅，替代旧 apiProxy.events.mux），
 * 按事件类型触发三类系统通知：
 *   - 审批：`approval/request`（waterfall，须委派 next()）→ 提醒用户处理审批
 *   - 错误：`api-session/error` → 会话执行出错
 *   - 会话进展：`api-session/status`（running）→ 会话推进
 * 窗口可见时不打扰；通知点击 → 定位并聚焦主窗口。审计经 `ctx.desktop.emitAction('notify.*')`。
 *
 * 安装时机：窗口创建后（main.ts bootstrap）。返回清理函数（注销事件监听）。
 *
 * 注意：Windows 未签名 dev 下系统 toast 可能受限（最坏仅审计 + 窗口前置，见 R-06 风险）。
 */

import { Notification, BrowserWindow } from 'electron'
import type { DesktopCore } from '../types/desktop.js'

/** 0.1.2 host 上下文（仅订阅所需事件的最小面）。 */
export interface NotifyHostContext {
  on(event: 'approval/request', listener: (req: unknown, next: () => unknown) => unknown): () => boolean
  on(event: 'api-session/error', listener: (sessionId: string, message: string) => void): () => boolean
  on(event: 'api-session/status', listener: (sessionId: string, running: boolean) => void): () => boolean
}

/** 通知安装选项。 */
export interface DesktopNotifyOptions {
  /** `ctx.desktop` 聚合服务（审计动作 + 下行事件）。 */
  desktop: DesktopCore
  /** 0.1.2 Cordis Host 上下文（host 事件直订阅）。 */
  hostCtx: NotifyHostContext
  /** 取当前主窗口（通知点击定位）。 */
  getWindow(): BrowserWindow | null
}

/**
 * 安装系统通知（消费 host 会话事件）。仅在窗口创建后调用一次。
 *
 * @param options 安装选项。
 * @returns 清理函数（注销事件监听）。
 */
export function installDesktopNotify(options: DesktopNotifyOptions): () => void {
  const { desktop, hostCtx, getWindow } = options
  let stopped = false

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

  // 审批请求：waterfall 事件，必须委派 next()，否则视为 veto 阻断审批。
  const offApproval = hostCtx.on('approval/request', (_req, next) => {
    if (stopped) return next()
    notify('需要审批', '会话请求你的审批，请前往处理。', 'notify.approval')
    return next()
  })
  // 会话错误。
  const offError = hostCtx.on('api-session/error', () => {
    if (stopped) return
    notify('会话错误', '任务执行出错。', 'notify.error')
  })
  // 会话推进（running 状态变化 → 有活动）。
  const offStatus = hostCtx.on('api-session/status', (_sessionId, running) => {
    if (stopped || !running) return
    notify('会话有新进展', '会话正在推进，点击查看。', 'notify.session')
  })

  return (): void => {
    stopped = true
    offApproval()
    offError()
    offStatus()
  }
}