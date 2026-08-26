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

/** 平台信息。 */
interface PlatformInfo {
  platform: string
  version: string
  channel: string
}

/** Renderer 侧桌面桥接 API。 */
export interface DesktopBridge {
  /** 上行 RPC 调用（替换 WebApiClient 的 doFetch）。 */
  rpc(method: string, body: unknown): Promise<unknown>
  /** 上行帧应答。 */
  respond(rpcId: string, body: unknown): Promise<{ accepted: boolean }>
  /** 注册下行帧监听器（session/event、approval 等）。返回注销函数。 */
  onFrame(cb: (frame: unknown) => void): () => void
  /** 注册桌面事件监听器。返回注销函数。 */
  onDesktopEvent(cb: (event: { action: string; payload?: unknown }) => void): () => void
  /** 窗口控制。 */
  windowControl: WindowControl
  /** 获取平台信息。 */
  getPlatformInfo(): Promise<PlatformInfo>
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

    // ── 窗口控制 ──────────────────────────────────────────────────
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