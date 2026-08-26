import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerDshUiProtocol, registerDshUiScheme } from './dsh-ui-protocol'
import { parseArgv } from './argv'
import { registerIpcBridge, cleanupWindowState, removeIpcHandlers } from '../desktop-host/bridge.js'
import { registerIpcCarrierServices } from '../desktop-host/manifest.js'
import {
  installMainCrashHandlers,
  installRendererCrashRecovery,
  isCircuitBroken,
  resetOnCleanQuit,
} from './relaunch'
import type { RpcRequest } from '../types/contract.js'
import type { DesktopCore } from '../types/desktop.js'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy' with { 'resolution-mode': 'import' }

/**
 * dsh-desktop 主进程入口（M1·步骤6：崩溃 relaunch 自愈 v0 + 零端口验证铺垫）。
 *
 * 启动时序：
 * 1. userData 重定向 → 单实例锁 → 熔断启动守卫
 * 2. app.whenReady() → registerDshUiProtocol() → registerIpcBridge() → bootDesktopHost() → createWindow()
 *
 * 崩溃自愈：主进程 uncaughtException 触发有限重启；渲染进程崩溃自动 reload 窗口；
 * 连续崩溃在窗口期内超限即熔断（详见 relaunch.ts）。
 */

// userData 重定向到项目内 .runtime/user-data：开发期避开系统 AppData（沙箱/残留垃圾易致
// Chromium 锁与缓存创建失败），且随仓库可整体清理。必须在 any app 事件前设置。
app.setPath('userData', join(__dirname, '..', '..', '.runtime', 'user-data'))

// 解析启动参数（Step 6·--serve 兼容模式 / 零端口红线切换）。
// Electron 把命令行参数挂在 app.commandLine，argv[1] 是 script 路径，
// parseArgv 内部会跳过前两项，因此直接传 process.argv 即可。
const launchOptions = parseArgv(process.argv)
if (launchOptions.serve) {
  console.warn(`[dsh-desktop] 启动参数：--serve=${launchOptions.servePort}（兼容模式，第三方 web 路由走 HTTP 原义）`)
} else {
  console.log('[dsh-desktop] 启动参数：默认零端口 IPC 载波模式（webserver/web-runtime/web-startup 禁用）')
}

// 注册 dsh-ui:// 协议方案特权（必须在 app.whenReady 前）
registerDshUiScheme()

// 崩溃自愈：主进程崩溃处理器 + 熔断启动守卫
installMainCrashHandlers()

if (isCircuitBroken()) {
  // 连续崩溃已达熔断上限：本次启动不再自动重启，避免无限重启循环
  console.error('[dsh-desktop] 连续崩溃已达熔断上限，暂停自动重启')
  app.exit(1)
} else {
  // 单实例锁：防止多开导致宿主与数据目录冲突（正式策略后续在 desktop-shell 收敛）
  const gotTheLock = app.requestSingleInstanceLock()
  if (!gotTheLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      const [win] = BrowserWindow.getAllWindows()
      if (win !== undefined) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })
    void bootstrap()
  }
}

// ── 预加载脚本路径 ───────────────────────────────────────────────────

/** preload 脚本绝对路径（在同样 tsconfig rootDir 下编译后位于 dist/desktop-shell/）。 */
const PRELOAD_PATH = join(__dirname, 'preload.js')

/** 桌面能力句柄（退出前清理）：托盘 + 通知。 */
let desktopTrayHandle: (() => void) | null = null
let desktopNotifyHandle: (() => void) | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    // 去掉 Electron 默认原生菜单栏（File/Edit/View/Window），避免与官方 UI 顶部布局冲突
    autoHideMenuBar: true,
    // 官方 UI 经 dsh-ui:// 自定义协议加载（dist 直读，零 HTTP 端口）
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  // 移除窗口菜单（含开发默认菜单），彻底隐藏原生菜单栏
  win.setMenuBarVisibility(false)
  win.removeMenu()

  // 页面加载完成
  win.webContents.on('did-finish-load', () => {
    console.log('[dsh-desktop] 页面加载完成，URL:', win.webContents.getURL())
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[dsh-desktop] 页面加载失败 (${errorCode}): ${errorDescription} URL: ${validatedURL}`)
  })

  // 渲染进程崩溃自愈：自动 reload 窗口，超次升级整体重启
  installRendererCrashRecovery(win)

  // 捕获 renderer 日志转发到主进程
  // Electron console-message level: 0=verbose, 1=info, 2=warning, 3=error
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const prefix = level === 3 ? '[renderer-ERROR]' : level === 2 ? '[renderer-WARN]' : level === 1 ? '[renderer-INFO]' : '[renderer-VERBOSE]'
    console.log(`${prefix} ${message} (line ${line}, ${sourceId})`)
  })

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    cleanupWindowState(win.id)
  })
  // 官方 dist 资源使用根绝对路径（/assets/...）。页面用固定虚拟 host dsh-ui://app 布局，
  // 使这些绝对路径解析为 dsh-ui://app/assets/...；resolveRelative 仅取 pathname 映射到
  // dist 根（R5 修复：空 host 会被 Electron 规范化为 dsh-ui://index.html/ 导致资源 404）。
  void win.loadURL('dsh-ui://app/index.html')
  return win
}

/** 主进程启动流程（仅当未熔断时调用）。 */
async function bootstrap(): Promise<void> {
  try {
    await app.whenReady()

    // 1. 协议注册（必须在 boot 前：boot 期间可能触发 dsh-ui:// 加载）
    registerDshUiProtocol()

    // 2. 注册 IPC 桥（必须在 Host 启动前，确保 renderer 就绪通知可接收）
    registerIpcBridge()

    // 3. 启动 Cordis Host（desktop profile 装配 + 插件树挂载；--serve 控制 Web 传输层启用）
    const { bootDesktopHost } = await import('../desktop-host/boot.js')
    console.log('[dsh-desktop] 启动 Cordis Host...')
    const hostCtx = await bootDesktopHost({
      // 开发模式：bareModuleBaseUrl 指向项目 node_modules（生产模式由打包配置覆盖）
      bareModuleBaseUrl: join(__dirname, '..', '..', 'node_modules'),
      // Step 6·--serve 兼容模式：默认 false = 零端口 IPC 载波；显式 --serve 时恢复 HTTP loopback
      serveMode: launchOptions.serve,
      servePort: launchOptions.servePort,
    })
    console.log('[dsh-desktop] Cordis Host 已就绪:', hostCtx)

    // 4. 连接 IPC 桥与 Cordis Host 的 apiProxy
    const { setApiProxyHandler } = await import('../desktop-host/bridge.js')
    const { toFetchHandler } = await import('@deepseek-ai/dsh-host-apiproxy')
    const apiProxy = (hostCtx as Record<string, unknown>)['apiProxy'] as ApiProxy | undefined
    if (apiProxy === undefined) {
      throw new Error('Cordis Host 未装配 apiProxy（检查 boot.ts 的 api-gateway/dsh-host-apiproxy）')
    }
    // host 侧 RPC 的正确入口是官方 toFetchHandler(api)：把 client-request envelope 经
    // `/api/<method>`（host 内虚拟路由，不真正走网络）分发给 api[domain][method]。
    // 我们协议用 {rpcId, method, params} 而非 HTTP，因此桥把 method 映射为路径。
    const apiFetch = toFetchHandler(apiProxy)
    // 解包官方 server-response 信封：result.ok 为真返回 result.value（bridge 包成 {rpcId,data}），
    // result.ok 为假抛错（bridge catch → {rpcId, error}），使 renderer 端 ipcRpcCall 正确分流。
    // 注意：非 2xx（如 404）是纯文本 "not found"，需先判 ok，否则 res.json 会抛 SyntaxError。
    const unpackServerResponse = async (res: Response): Promise<unknown> => {
      if (!res.ok) throw new Error(`api 调用失败: HTTP ${res.status} ${res.statusText}`)
      const body = (await res.json()) as { type?: string; result?: { ok: boolean; value?: unknown; error?: { message?: string; code?: string } } }
      const result = body.result
      if (result === undefined) return body
      if (!result.ok) throw new Error(result.error?.message ?? `api 调用失败 (${result.error?.code ?? 'unknown'})`)
      return result.value
    }
    setApiProxyHandler(async (request: RpcRequest) => {
      const envelope = {
        type: 'client-request' as const,
        rpcId: request.rpcId,
        method: request.method,
        payload: request.params,
      }
      // 官方 toFetchHandler 内部用 new URL(req.url) 取 pathname，相对路径会抛
      // "Failed to parse URL"；这里用 http://local 作虚拟 base，fetch 只读 pathname。
      const res = await apiFetch.fetch(
        new Request(`http://local/api/${request.method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) }),
      )
      return await unpackServerResponse(res)
    })

    // 5. 注册 IPC 载波服务到 Cordis 上下文
    registerIpcCarrierServices(hostCtx, {
      handleRpc: async (request: RpcRequest) => {
        const envelope = {
          type: 'client-request' as const,
          rpcId: request.rpcId,
          method: request.method,
          payload: request.params,
        }
        const res = await apiFetch.fetch(
          new Request(`http://local/api/${request.method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) }),
        )
        return await unpackServerResponse(res)
      },
      handleRespond: async (response: { rpcId: string; body: unknown }) => {
        const res = await apiFetch.fetch(
          new Request(`http://local/api/respond`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rpcId: response.rpcId, body: response.body }) }),
        )
        return (await res.json()) as { accepted: boolean }
      },
    })

    // 6. 创建窗口并加载官方 UI
    const win = createWindow()

    // 7. 启动 host 会话事件 → renderer 下行帧中继（攻坚第 2 批：session/event 等
    //    server-request 帧经 bridge 下发，使官方 UI 完成端到端对话）
    // apiProxy 已在步骤 4 取到（转 DownlinkEventStream，复用其 events.mux/host）。
    const downlinkProxy = apiProxy as unknown as import('../desktop-host/carrier-relay.js').DownlinkEventStream
    if (downlinkProxy?.events?.mux !== undefined) {
      const { startDownlinkRelay } = await import('../desktop-host/carrier-relay.js')
      const relayState = { relay: null as import('../desktop-host/carrier-relay.js').DownlinkRelay | null }
      relayState.relay = startDownlinkRelay(downlinkProxy, win.webContents)
      win.on('closed', () => {
        relayState.relay?.stop()
        relayState.relay = null
      })
      console.log('[dsh-desktop] host 会话事件下行帧中继已启动')
    } else {
      console.warn('[dsh-desktop] 未找到 host apiProxy，跳过下行帧中继（官方 UI 对话将不可用）')
    }

    // 8. 桌面能力（M2）：托盘（关窗驻留 + 快速问答）+ 系统通知。
    // 依赖 ctx.desktop 聚合服务（boot() prepare 注入）；需窗口已创建后安装。
    const desktopCore = (hostCtx as Record<string, unknown>)['desktop'] as DesktopCore | undefined
    if (desktopCore !== undefined) {
      const { installDesktopTray } = await import('../desktop-host/desktop-tray.js')
      const { installDesktopNotify } = await import('../desktop-host/desktop-notify.js')
      const getWindow = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null
      desktopTrayHandle = installDesktopTray({ getWindow, desktop: desktopCore })
      desktopNotifyHandle = installDesktopNotify({ desktop: desktopCore, events: downlinkProxy, getWindow })
      console.log('[dsh-desktop] 桌面能力已装配：tray(关窗驻留+快速问答) + notify(审批/错误/进展)')
    } else {
      console.warn('[dsh-desktop] ctx.desktop 未就绪，跳过托盘/通知')
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } catch (error: unknown) {
    console.error('[dsh-desktop] 启动失败:', error)
    app.quit()
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  desktopNotifyHandle?.()
  desktopTrayHandle?.()
  removeIpcHandlers()
  resetOnCleanQuit()
})
