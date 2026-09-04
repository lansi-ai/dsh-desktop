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
  /** 上行：打开逻辑流载波（renderer openStream → host typertGateway.wireStream.open）。 */
  STREAM_OPEN: 'dsh:stream-open',
  /** 下行：逻辑流帧（stream-item 的 value → renderer openStream yield）。 */
  STREAM_FRAME: 'dsh:stream-frame',
  /** 下行：逻辑流结束/错误（renderer openStream 终止）。 */
  STREAM_CLOSE: 'dsh:stream-close',
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
  /** 最大化/还原切换（自绘标题栏窗控）。 */
  maximize(): Promise<void>
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

/** 应用自动更新操作接口（关于页检查更新）。 */
interface DesktopUpdater {
  /** 手动检查更新（后台进行，状态经 onStatus 事件推送）。 */
  check(): Promise<{ ok: boolean }>
  /** 获取当前更新状态。 */
  getStatus(): Promise<{
    phase: string
    currentVersion: string
    newVersion?: string
    percent?: number
    error?: string
  }>
  /** 重启并安装已下载更新。 */
  install(): Promise<{ ok: boolean }>
  /** 订阅更新状态变更（action='app-update:status' 的下行桌面事件）。返回注销函数。 */
  onStatus(cb: (state: { phase: string; currentVersion: string; newVersion?: string; percent?: number; error?: string }) => void): () => void
}

/**
 * 图标槽位状态视图（真源 = types/desktop.ts `iconSlotStatusSchema`；
 * 沙箱化 preload 不能 require 相对模块，故此处本地声明保持同步）。
 */
interface IconSlotStatusView {
  id: string
  /** 用途名（如「标题栏品牌 logo」）。 */
  label: string
  /** 消费方用途域（如「设置面板」）。 */
  group: string
  /** 消费方插件/模块标识（如 `@lansi-ai/dsh-desktop-settings-shell`）。 */
  plugin: string
  /** 归属：global=userData/icons（应用/托盘/品牌 logo，不随包切换）；pack=激活包 icons/。 */
  scope: 'global' | 'pack'
  /** 相对归属目录的规范文件名（global：`app-icon-light.png`；pack：`icons/xxx.svg`）。 */
  file: string
  format: 'svg' | 'png'
  size: number
  /** 缺失时的回退行为说明。 */
  fallback: string
  /** 归属目录是否已提供该文件（空文件等同未提供）。 */
  provided: boolean
}

/** iconTheme.list 下发结构（真源 = types/desktop.ts `iconThemeListResultSchema`）。 */
interface IconThemeListView {
  themes: Array<{ id: string; name: string; color?: string; current: boolean; icons: string[] }>
  current: string
  slots: IconSlotStatusView[]
  /** 当前激活包的写入目录（pack 槽位上传落盘位置；内置包为其本地克隆目标）。 */
  uploadDir: string
  /** 全局图标目录（global 槽位上传落盘位置，与图标包无关）。 */
  globalDir: string
}

/** 桌面图标主题操作接口（图标主题与颜色主题为两个独立设置项；颜色主题后续版本）。 */
interface DesktopIconTheme {
  /** 列出可用图标主题（激活标记 + 包内图标索引）+ 槽位需求清单 + 上传落盘目录。 */
  list(): Promise<IconThemeListView>
  /** 切换图标主题（主进程持久化后经 settings 联动自动应用图标）。 */
  set(id: string): Promise<{ ok: boolean; current?: string; message?: string }>
  /** 新建图标包（用户主题目录建空包，建完即激活 → 后续上传直接落该包）。 */
  create(id: string, name: string): Promise<{ ok: boolean; id?: string; current?: string; message?: string }>
  /** 按槽位上传图标（global 槽位写 userData/icons；pack 槽位写当前激活包）。 */
  upload(slotId: string): Promise<{ ok: boolean; imported?: string[]; scope?: 'global' | 'pack'; themeId?: string; cloned?: boolean; message?: string }>
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
  /** 打开逻辑流载波（0.1.2 __DSH_TRANSPORT__.openStream 的 IPC 背板）。 */
  openStream(streamId: string, endpoint: string, payload: unknown): Promise<void>
  /** 注册逻辑流帧监听。收到归入对应 streamId 的 yield 值。 */
  onStreamFrame(cb: (frame: { streamId: string; value: unknown }) => void): () => void
  /** 注册逻辑流关闭监听（正常结束或带错误 message）。 */
  onStreamClose(cb: (frame: { streamId: string; message: string | null }) => void): () => void
  /** 关闭逻辑流（renderer 侧 abort/GC）。 */
  closeStream(streamId: string): void
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
  /** 应用自动更新操作（关于页检查更新）。 */
  updater: DesktopUpdater
  /** 桌面图标主题操作（图标主题与颜色主题独立设置，颜色主题后续版本）。 */
  iconTheme: DesktopIconTheme
  /** 全局快捷键操作。 */
  desktopShortcut: DesktopShortcut
  /** 剪贴板操作。 */
  desktopClipboard: DesktopClipboard
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

    // ── 逻辑流载波（0.1.2 __DSH_TRANSPORT__.openStream 背板）───────
    async openStream(streamId: string, endpoint: string, payload: unknown): Promise<void> {
      await ipcRenderer.invoke(IPC_CHANNELS.STREAM_OPEN, { streamId, endpoint, payload })
    },
    onStreamFrame(cb: (frame: { streamId: string; value: unknown }) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, frame: { streamId: string; value: unknown }): void => {
        cb(frame)
      }
      ipcRenderer.on(IPC_CHANNELS.STREAM_FRAME, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.STREAM_FRAME, handler)
      }
    },
    onStreamClose(cb: (frame: { streamId: string; message: string | null }) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, frame: { streamId: string; message: string | null }): void => {
        cb(frame)
      }
      ipcRenderer.on(IPC_CHANNELS.STREAM_CLOSE, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.STREAM_CLOSE, handler)
      }
    },
    closeStream(streamId: string): void {
      // 尽力而为：host 侧已持有该流；重复关闭/未知 id 静默忽略。
      ipcRenderer.invoke(IPC_CHANNELS.STREAM_OPEN, { streamId, endpoint: '__abort__', payload: undefined }).catch(() => {})
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
      maximize(): Promise<void> {
        return ipcRenderer.invoke(IPC_CHANNELS.RPC, {
          rpcId: generateUuid(),
          method: 'desktop.windowControl.maximize',
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

    // ── 应用自动更新操作（关于页检查更新） ──────────────────────
    updater: {
      check(): Promise<{ ok: boolean }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.updater.check',
          params: undefined,
        }) as Promise<{ ok: boolean }>
      },
      getStatus() {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.updater.status',
          params: undefined,
        }) as Promise<{
          phase: string
          currentVersion: string
          newVersion?: string
          percent?: number
          error?: string
        }>
      },
      install(): Promise<{ ok: boolean }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.updater.install',
          params: undefined,
        }) as Promise<{ ok: boolean }>
      },
      onStatus(cb) {
        // 复用下行桌面事件通道：主进程 auto-updater 经 sendDesktopEvent 推送
        // action='app-update:status'，这里过滤后回调。
        const handler = (_event: Electron.IpcRendererEvent, desktopEvent: { action: string; payload?: { phase: string; currentVersion: string; newVersion?: string; percent?: number; error?: string } }): void => {
          if (desktopEvent.action === 'app-update:status' && desktopEvent.payload) cb(desktopEvent.payload)
        }
        ipcRenderer.on(IPC_CHANNELS.DESKTOP_EVENT, handler)
        return () => {
          ipcRenderer.removeListener(IPC_CHANNELS.DESKTOP_EVENT, handler)
        }
      },
    },

    // ── 桌面图标主题操作（图标主题 / 颜色主题独立设置 · 图标侧） ──
    iconTheme: {
      list(): Promise<IconThemeListView> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.iconTheme.list',
          params: undefined,
        }) as Promise<IconThemeListView>
      },
      set(id: string): Promise<{ ok: boolean; current?: string; message?: string }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.iconTheme.set',
          params: { id },
        }) as Promise<{ ok: boolean; current?: string; message?: string }>
      },
      create(id: string, name: string): Promise<{ ok: boolean; id?: string; current?: string; message?: string }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.iconTheme.create',
          params: { id, name },
        }) as Promise<{ ok: boolean; id?: string; current?: string; message?: string }>
      },
      upload(slotId: string): Promise<{ ok: boolean; imported?: string[]; scope?: 'global' | 'pack'; themeId?: string; cloned?: boolean; message?: string }> {
        return ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_INVOKE, {
          rpcId: generateUuid(),
          method: 'desktop.iconTheme.upload',
          params: { slotId },
        }) as Promise<{ ok: boolean; imported?: string[]; scope?: 'global' | 'pack'; themeId?: string; cloned?: boolean; message?: string }>
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