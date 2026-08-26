/**
 * dsh-desktop preload 脚本（Step 4·IPC 载波四件套·preload）。
 *
 * 在沙箱化 renderer 中暴露白名单 API `window.desktopBridge`。
 * 对齐 06-client-plugins.md §3 DesktopBridge 接口设计。
 *
 * 安全边界：
 * - contextIsolation: true（desktopBridge 不污染全局原型）
 * - sandbox: true（无 Node 泄漏）
 * - 仅暴露白名单方法，不暴露原始 ipcRenderer
 *
 * 注意：沙箱化 preload 无法使用 require() 解析相对路径模块，
 * 因此通道常量在此处内联定义（与 types/channels.ts 保持同步）。
 */

import { contextBridge, ipcRenderer } from 'electron'

// ── IPC 通道常量（内联，与 src/types/channels.ts 保持同步）──────────

/** IPC 通道名常量。 */
const IPC_CHANNELS = {
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
  /** 上行：桌面能力统一调用入口（快捷键/剪贴板/面板等）。 */
  DESKTOP_INVOKE: 'desktop:invoke',
  /** 下行：窗口事件（窗口创建/销毁/状态变化 → renderer onWindowEvent）。 */
  WINDOW_EVENT: 'desktop:window-event',
  /** 下行：会话上下文注入（窗口就绪后推送 sessionId → renderer onSessionContext）。 */
  SESSION_CONTEXT: 'desktop:session-context',
} as const

/**
 * 生成 UUID v4（兼容 preload 沙箱上下文，crypto.randomUUID 不可用）。
 * 使用 crypto.getRandomValues 或 Math.random 回退。
 */
function generateUuid(): string {
  const buf = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf)
  } else {
    for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  // 设置 UUID v4 标志位
  buf[6] = (buf[6] & 0x0f) | 0x40
  buf[8] = (buf[8] & 0x3f) | 0x80
  const hex = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ── 类型定义（与 06-client-plugins.md §3 对齐） ─────────────────────

/** 窗口控制接口。 */
interface WindowControl {
  focus(): Promise<void>
  minimize(): Promise<void>
  close(): Promise<void>
}

/** 快捷键操作接口。 */
interface DesktopShortcut {
  /** 注册全局快捷键。 */
  register(accelerator: string, action: string): Promise<{ registered: boolean }>
  /** 注销全局快捷键。 */
  unregister(accelerator: string): Promise<{ unregistered: boolean }>
}

/** 剪贴板操作接口。 */
interface DesktopClipboard {
  /** 读取剪贴板文本（免审批）。 */
  readText(): Promise<string>
  /** 写入剪贴板文本（需 approval 审批）。 */
  writeText(text: string): Promise<{ written: boolean }>
}

/** 平台信息。 */
interface PlatformInfo {
  platform: string
  version: string
  channel: string
}

/** 多窗口管理器接口。 */
interface DesktopWindowManager {
  /** 创建绑定会话的新窗口（若已存在则聚焦）。 */
  createSessionWindow(sessionId: string, bounds?: { x: number; y: number; width: number; height: number }): Promise<{
    success: boolean
    message?: string
    windowId?: number
    sessionId?: string
  }>
  /** 关闭指定会话的窗口。 */
  closeSessionWindow(sessionId: string): Promise<{ success: boolean; message?: string }>
  /** 关闭指定窗口 ID。 */
  closeWindowById(windowId: number): Promise<{ success: boolean; message?: string }>
  /** 聚焦指定会话的窗口。 */
  focusSessionWindow(sessionId: string): Promise<{ success: boolean; message?: string }>
  /** 列出所有活动会话窗口。 */
  listSessions(): Promise<Array<{ sessionId: string; windowId: number; state: string }>>
  /** 注册窗口事件监听器（窗口创建/销毁/状态变化/会话列表更新）。 */
  onWindowEvent(cb: (event: { type: string; payload: unknown; ts: number }) => void): () => void
  /** 注册会话上下文监听器（窗口就绪后自动注入）。 */
  onSessionContext(cb: (context: { sessionId: string; windowId: number; ts: number }) => void): () => void
}

/** 命令面板操作接口。 */
interface DesktopCmdPalette {
  /** 打开命令面板。 */
  open(query?: string): Promise<{ opened: boolean }>
  /** 关闭命令面板。 */
  close(): Promise<{ closed: boolean }>
  /** 唤起快速提问。 */
  quickAsk(question?: string): Promise<{ triggered: boolean }>
  /** 切换到指定会话。 */
  switchSession(sessionId: string): Promise<{ success: boolean; message?: string }>
  /** 获取活动会话列表。 */
  listSessions(): Promise<Array<{ sessionId: string; windowId: number; state: string; title?: string }>>
}

/** 审计查询操作接口。 */
interface DesktopAudit {
  /** 查询审计日志。 */
  query(params: {
    action?: string
    sessionId?: string
    from?: number
    to?: number
    limit?: number
    offset?: number
  }): Promise<{
    entries: Array<{ ts: number; action: string; payload?: unknown }>
    total: number
  }>
  /** 获取可用动作列表。 */
  listActions(): Promise<string[]>
}

/** 开机自启操作接口（M3-b3 新增）。 */
interface DesktopAutostart {
  /** 设置开机自启开关（OS 登录项为唯一真源）。 */
  setEnabled(enabled: boolean): Promise<{ enabled: boolean; supported: boolean; devMode: boolean; message?: string }>
  /** 读取开机自启当前状态（实时读取 OS 登录项）。 */
  getStatus(): Promise<{ enabled: boolean; supported: boolean; devMode: boolean; message?: string }>
}
export interface DesktopBridge {
  /** 上行 RPC 调用（替换 WebApiClient 的 doFetch）。 */
  rpc(method: string, body: unknown): Promise<unknown>
  /** 透传完整 RPC 信封（保留调用方 rpcId，不自动生成、不解包）；bridge 返回原始 {rpcId, data|error}。
   *  供官方 client-connection 的 IPC 子类 doFetch 对齐 server-response 协议。 */
  request(envelope: { rpcId: string; method: string; params: unknown }): Promise<unknown>
  /** 上行帧应答。 */
  respond(rpcId: string, body: unknown): Promise<{ accepted: boolean }>
  /** 注册下行帧监听器（session/event、approval 等）。返回注销函数。 */
  onFrame(cb: (frame: unknown) => void): () => void
  /** 注册桌面事件监听器。返回注销函数。 */
  onDesktopEvent(cb: (event: { action: string; payload?: unknown }) => void): () => void
  /** 窗口控制（当前窗口）。 */
  windowControl: WindowControl
  /** 多窗口管理器（M3 新增）。 */
  windowManager: DesktopWindowManager
  /** 命令面板操作（M3-a4 新增）。 */
  cmdPalette: DesktopCmdPalette
  /** 审计查询操作（M3-b2 新增）。 */
  audit: DesktopAudit
  /** 开机自启操作（M3-b3 新增）。 */
  autostart: DesktopAutostart
  /** 全局快捷键操作。 */
  desktopShortcut: DesktopShortcut
  /** 剪贴板操作。 */
  desktopClipboard: DesktopClipboard
  /** 获取平台信息。 */
  getPlatformInfo(): Promise<PlatformInfo>
  /** 打开桌面面板（IPC 驱动）。 */
  openDesktopPanel(): Promise<void>
  /** 关闭桌面面板（IPC 驱动）。 */
  closeDesktopPanel(): Promise<void>
}

// ── 桥实现 ──────────────────────────────────────────────────────────

function createDesktopBridge(): DesktopBridge {
  return {
    // ── RPC 调用 ──────────────────────────────────────────────────
    async rpc(method: string, body: unknown): Promise<unknown> {
      // bridge 返回 { rpcId, data: <result> }，自动解包 data
      const raw = await ipcRenderer.invoke(IPC_CHANNELS.RPC, {
        rpcId: generateUuid(),
        method,
        params: body,
      }) as { data?: unknown }
      return raw?.data ?? raw
    },

    // ── 信封透传（官方 IPC 载波子类 doFetch 用）────────────────────
    async request(envelope: { rpcId: string; method: string; params: unknown }): Promise<unknown> {
      // 原样透传信封（保留调用方 rpcId），返回 bridge 原始结果（不解包 data）
      return await ipcRenderer.invoke(IPC_CHANNELS.RPC, envelope)
    },

    // ── 帧应答 ────────────────────────────────────────────────────
    respond(rpcId: string, body: unknown): Promise<{ accepted: boolean }> {
      return ipcRenderer.invoke(IPC_CHANNELS.RESPOND, { rpcId, body })
    },

    // ── 帧监听 ────────────────────────────────────────────────────
    onFrame(cb: (frame: unknown) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, frame: unknown): void => {
        cb(frame)
      }
      ipcRenderer.on(IPC_CHANNELS.FRAME, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.FRAME, handler)
      }
    },

    // ── 桌面事件监听 ──────────────────────────────────────────────
    onDesktopEvent(cb: (event: { action: string; payload?: unknown }) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, desktopEvent: { action: string; payload?: unknown }): void => {
        cb(desktopEvent)
      }
      ipcRenderer.on('desktop:event', handler)
      return () => {
        ipcRenderer.removeListener('desktop:event', handler)
      }
    },

    // ── 窗口控制（当前窗口） ──────────────────────────────────────
    windowControl: {
      focus(): Promise<void> {
        return ipcRenderer.invoke(IPC_CHANNELS.RPC, {
          rpcId: generateUuid(),
          method: 'desktop.windowControl.focus',
          params: undefined,
        })
      },
      minimize(): Promise<void> {
        return ipcRenderer.invoke(IPC_CHANNELS.RPC, {
          rpcId: generateUuid(),
          method: 'desktop.windowControl.minimize',
          params: undefined,
        })
      },
      close(): Promise<void> {
        return ipcRenderer.invoke(IPC_CHANNELS.RPC, {
          rpcId: generateUuid(),
          method: 'desktop.windowControl.close',
          params: undefined,
        })
      },
    },

    // ── 多窗口管理器（M3 新增） ──────────────────────────────────
    windowManager: {
      async createSessionWindow(
        sessionId: string,
        bounds?: { x: number; y: number; width: number; height: number },
      ): Promise<{ success: boolean; message?: string; windowId?: number; sessionId?: string }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.window.create',
          params: { sessionId, bounds },
        }) as Promise<{ success: boolean; message?: string; windowId?: number; sessionId?: string }>
      },
      async closeSessionWindow(sessionId: string): Promise<{ success: boolean; message?: string }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.window.closeBySession',
          params: { sessionId },
        }) as Promise<{ success: boolean; message?: string }>
      },
      async closeWindowById(windowId: number): Promise<{ success: boolean; message?: string }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.window.closeById',
          params: { windowId },
        }) as Promise<{ success: boolean; message?: string }>
      },
      async focusSessionWindow(sessionId: string): Promise<{ success: boolean; message?: string }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.window.focusBySession',
          params: { sessionId },
        }) as Promise<{ success: boolean; message?: string }>
      },
      async listSessions(): Promise<Array<{ sessionId: string; windowId: number; state: string }>> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.window.listSessions',
          params: undefined,
        }) as Promise<Array<{ sessionId: string; windowId: number; state: string }>>
      },
      onWindowEvent(cb: (event: { type: string; payload: unknown; ts: number }) => void): () => void {
        const handler = (_event: Electron.IpcRendererEvent, windowEvent: { type: string; payload: unknown; ts: number }): void => {
          cb(windowEvent)
        }
        ipcRenderer.on(IPC_CHANNELS.WINDOW_EVENT, handler)
        return () => {
          ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_EVENT, handler)
        }
      },
      onSessionContext(
        cb: (context: { sessionId: string; windowId: number; ts: number }) => void,
      ): () => void {
        const handler = (_event: Electron.IpcRendererEvent, context: { sessionId: string; windowId: number; ts: number }): void => {
          cb(context)
        }
        ipcRenderer.on(IPC_CHANNELS.SESSION_CONTEXT, handler)
        return () => {
          ipcRenderer.removeListener(IPC_CHANNELS.SESSION_CONTEXT, handler)
        }
      },
    },

    // ── 命令面板操作（M3-a4 新增） ─────────────────────────────
    cmdPalette: {
      open(query?: string): Promise<{ opened: boolean }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.cmdpalette.open',
          params: { query },
        }) as Promise<{ opened: boolean }>
      },
      close(): Promise<{ closed: boolean }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.cmdpalette.close',
          params: undefined,
        }) as Promise<{ closed: boolean }>
      },
      quickAsk(question?: string): Promise<{ triggered: boolean }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.cmdpalette.quickAsk',
          params: { question },
        }) as Promise<{ triggered: boolean }>
      },
      switchSession(sessionId: string): Promise<{ success: boolean; message?: string }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.cmdpalette.switchSession',
          params: { sessionId },
        }) as Promise<{ success: boolean; message?: string }>
      },
      listSessions(): Promise<Array<{ sessionId: string; windowId: number; state: string; title?: string }>> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.cmdpalette.listSessions',
          params: undefined,
        }) as Promise<Array<{ sessionId: string; windowId: number; state: string; title?: string }>>
      },
    },

    // ── 审计查询操作（M3-b2 新增） ─────────────────────────────
    audit: {
      query(params: {
        action?: string
        sessionId?: string
        from?: number
        to?: number
        limit?: number
        offset?: number
      }): Promise<{ entries: Array<{ ts: number; action: string; payload?: unknown }>; total: number }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.audit.query',
          params,
        }) as Promise<{ entries: Array<{ ts: number; action: string; payload?: unknown }>; total: number }>
      },
      listActions(): Promise<string[]> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.audit.listActions',
          params: undefined,
        }) as Promise<string[]>
      },
    },

    // ── 开机自启操作（M3-b3 新增） ─────────────────────────────
    autostart: {
      setEnabled(enabled: boolean): Promise<{ enabled: boolean; supported: boolean; devMode: boolean; message?: string }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.autostart.setEnabled',
          params: { enabled },
        }) as Promise<{ enabled: boolean; supported: boolean; devMode: boolean; message?: string }>
      },
      getStatus(): Promise<{ enabled: boolean; supported: boolean; devMode: boolean; message?: string }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.autostart.getStatus',
          params: undefined,
        }) as Promise<{ enabled: boolean; supported: boolean; devMode: boolean; message?: string }>
      },
    },

    // ── 全局快捷键操作 ──────────────────────────────────────────
    desktopShortcut: {
      register(accelerator: string, action: string): Promise<{ registered: boolean }> {
        return ipcRenderer.invoke('desktop:invoke', {
          rpcId: generateUuid(),
          method: 'desktop.shortcut.register',
          params: { accelerator, action },
        })
      },
      unregister(accelerator: string): Promise<{ unregistered: boolean }> {
        return ipcRenderer.invoke('desktop:invoke', {
          rpcId: generateUuid(),
          method: 'desktop.shortcut.unregister',
          params: { accelerator },
        })
      },
    },

    // ── 剪贴板操作 ──────────────────────────────────────────────
    desktopClipboard: {
      readText(): Promise<string> {
        return ipcRenderer.invoke('desktop:invoke', {
          rpcId: generateUuid(),
          method: 'desktop.clipboard.readText',
          params: undefined,
        }) as Promise<string>
      },
      writeText(text: string): Promise<{ written: boolean }> {
        return ipcRenderer.invoke('desktop:invoke', {
          rpcId: generateUuid(),
          method: 'desktop.clipboard.writeText',
          params: { text },
        })
      },
    },

    // ── 平台信息 ──────────────────────────────────────────────────
    async getPlatformInfo(): Promise<PlatformInfo> {
      // bridge 返回 { rpcId, data: { platform, version, electronVersion, chromeVersion } }
      const raw = await ipcRenderer.invoke(IPC_CHANNELS.RPC, {
        rpcId: generateUuid(),
        method: 'desktop.getPlatformInfo',
        params: undefined,
      }) as { data?: { platform?: string; version?: string } }
      const info = raw?.data ?? raw as { platform?: string; version?: string }
      return {
        platform: info.platform ?? 'unknown',
        version: info.version ?? 'unknown',
        channel: 'stable',
      }
    },

    // ── 桌面面板控制 ──────────────────────────────────────────────
    async openDesktopPanel(): Promise<void> {
      await ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
        rpcId: generateUuid(),
        method: 'desktop.panel.open',
        params: undefined,
      })
    },
    async closeDesktopPanel(): Promise<void> {
      await ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
        rpcId: generateUuid(),
        method: 'desktop.panel.close',
        params: undefined,
      })
    },
  }
}

// ── 暴露白名单 API ──────────────────────────────────────────────────

contextBridge.exposeInMainWorld('desktopBridge', createDesktopBridge())

// ── 就绪通知 ────────────────────────────────────────────────────────

// 通知主进程当前窗口已就绪，可接收帧
ipcRenderer.send(IPC_CHANNELS.READY, {
  windowId: -1, // 主进程通过 BrowserWindow.fromWebContents 获取实际 ID
})

console.log('[dsh-preload] desktopBridge 已就绪')