/**
 * IPC 通道常量（dsh-desktop Step 4·IPC 载波四件套）。
 *
 * 通道命名遵守 Electron invoke/send 惯例：
 * - 'dsh:rpc'     → 上行 client-request（invoke，返回 server-response）
 * - 'dsh:respond' → 上行 respond 应答（invoke，返回确认）
 * - 'dsh:frame'   → 下行 server-request 帧（send，主进程→renderer）
 * - 'dsh:ready'   → renderer 就绪通知（send，renderer→主进程）
 */

/** IPC 通道名常量。 */
export const IPC_CHANNELS = {
  /** 上行：client-request fullForm → 返回 server-response。 */
  RPC: 'dsh:rpc',
  /** 上行：clientResponse 应答 → 返回 { accepted: boolean }。 */
  RESPOND: 'dsh:respond',
  /** 下行：服务端推送帧（session/event、approval/question requested）。 */
  FRAME: 'dsh:frame',
  /** 上行：renderer 就绪通知（窗口加载完成，可接收帧）。 */
  READY: 'dsh:ready',
  /** 下行：桌面事件（desktop/action 审计/通知 → renderer onDesktopEvent）。 */
  DESKTOP_EVENT: 'desktop:event',
  /** 上行：桌面能力统一调用入口（快捷键/剪贴板等 → bridge methodTable 分发）。 */
  DESKTOP_INVOKE: 'desktop:invoke',
} as const satisfies Record<string, string>

/** IPC 通道名联合类型。 */
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]