import { app, BrowserWindow, nativeImage, nativeTheme } from 'electron'
import { join } from 'node:path'
import { registerDshUiProtocol, registerDshUiScheme } from './dsh-ui-protocol'
import { parseArgv } from './argv'
import { registerIpcBridge, cleanupWindowState, removeIpcHandlers, registerWindowManagerMethods } from '../desktop-host/bridge.js'
import type { WindowManager } from '../desktop-host/window-manager.js'
import { createWindowManager, attachWindowMaximizedStateBroadcast } from '../desktop-host/window-manager.js'
import { registerIpcCarrierServices } from '../desktop-host/manifest.js'
import { isVerbose } from '../desktop-host/log.js'
import {
  installMainCrashHandlers,
  installRendererCrashRecovery,
  isCircuitBroken,
  resetOnCleanQuit,
} from './relaunch'
import type { RpcRequest } from '../types/contract.js'
import type { DesktopCore } from '../types/desktop.js'
import { extractDshUrlFromArgv, routeDshProtocol } from '../desktop-host/dsh-protocol.js'
import { refreshTrayIcon } from '../desktop-host/desktop-tray.js'
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
// 打包模式（app.isPackaged）下 asar 只读，跳过重定向，使用 Electron 默认 userData（可写）。
if (!app.isPackaged) {
  app.setPath('userData', join(__dirname, '..', '..', '.runtime', 'user-data'))
}

// 解析启动参数（Step 6·--serve 兼容模式 / 零端口红线切换）。
// Electron 把命令行参数挂在 app.commandLine，argv[1] 是 script 路径，
// parseArgv 内部会跳过前两项，因此直接传 process.argv 即可。
const launchOptions = parseArgv(process.argv)
if (launchOptions.serve) {
  console.warn(`[dsh-desktop] 启动参数：--serve=${launchOptions.servePort}（兼容模式，第三方 web 路由走 HTTP 原义）`)
} else {
  console.log('[dsh-desktop] 启动参数：默认零端口 IPC 载波模式（webserver/web-runtime/web-startup 禁用）')
}
// M3-b3：--hidden 静默启动（开机自启登录后驻留托盘，不弹主窗口）
if (launchOptions.hidden) {
  console.log('[dsh-desktop] 启动参数：--hidden（静默模式，主窗口不显示，驻留托盘）')
}

// 注册 dsh-ui:// 协议方案特权（必须在 app.whenReady 前）
registerDshUiScheme()

// 注册 dsh:// 系统协议（M3-b1，必须在 app.whenReady 前）
app.setAsDefaultProtocolClient('dsh')

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
    app.on('second-instance', (_event, commandLine) => {
      // M3-b1：从 second-instance 参数中提取 dsh:// URL 并路由
      const dshUrl = extractDshUrlFromArgv(commandLine)
      if (dshUrl !== null) {
        // 延迟到 bootstrap 完成后再路由
        pendingDshUrl = dshUrl
        return
      }
      // 默认行为：聚焦窗口
      const [win] = BrowserWindow.getAllWindows()
      if (win !== undefined) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })

    // M3-b1：macOS open-url 事件（协议唤起）
    app.on('open-url', (_event, url) => {
      pendingDshUrl = url
    })

    void bootstrap()
  }
}

// ── 预加载脚本路径 ───────────────────────────────────────────────────

/** preload 脚本绝对路径（在同样 tsconfig rootDir 下编译后位于 dist/desktop-shell/）。 */
const PRELOAD_PATH = join(__dirname, 'preload.js')

/** 桌面能力句柄（退出前清理）：托盘 + 通知 + 快捷键 + 剪贴板 + 命令面板 + 审计查看器 + 开机自启。 */
let desktopTrayHandle: (() => void) | null = null
let desktopNotifyHandle: (() => void) | null = null
let desktopShortcutsHandle: (() => void) | null = null
let desktopClipboardHandle: (() => void) | null = null
let desktopCmdPaletteHandle: (() => void) | null = null
let desktopAuditViewerHandle: (() => void) | null = null
/** 开机自启句柄（退出前清理）。 */
let desktopAutostartHandle: (() => void) | null = null

/** 骨架外观句柄（宿主面：:root 外观变量注入，主窗口 + 会话窗口共用）。 */
let desktopAppearanceHandle: import('../desktop-host/desktop-appearance.js').DesktopAppearanceHandle | null = null

/** 主题联动句柄（退出前清理，M3-b4 主题体验）。 */
let themeSyncHandle: import('../desktop-host/theme-sync.js').ThemeSyncHandle | null = null

/** 窗口管理器句柄（M3·多窗口）。 */
let windowManager: WindowManager | null = null

/** M3-b1：待处理的 dsh:// 协议 URL（second-instance/open-url 先缓存，bootstrap 完成后路由）。 */
let pendingDshUrl: string | null = null

/** 应用/窗口图标（官方 harness logo，黑白双版随 nativeTheme 切换；缺失回退另一版）。 */
function loadAppIcon(): Electron.NativeImage {
  const dark = nativeTheme.shouldUseDarkColors
  const primary = nativeImage.createFromPath(join(__dirname, 'web', dark ? 'app-icon-dark.png' : 'app-icon-light.png'))
  const fallback = nativeImage.createFromPath(join(__dirname, 'web', dark ? 'app-icon-light.png' : 'app-icon-dark.png'))
  return primary.isEmpty() ? fallback : primary
}

/** 主题切换时刷新全部窗口/托盘图标（黑白双版，与官方 favicon 行为对齐）。 */
function refreshAppIcons(): void {
  const icon = loadAppIcon()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setIcon(icon)
  }
  if (process.platform === 'darwin') app.dock?.setIcon(icon)
  refreshTrayIcon()
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    // 窗口/任务栏图标（官方 harness logo 黑白双版）
    icon: loadAppIcon(),
    // 自绘标题栏（M3-b4：去 Windows 原生标题栏；拖拽条+窗控由 titlebar.ts 注入，
    // 保留系统窗控语义——双击拖拽条最大化、Win+方向键、任务栏交互均正常）
    titleBarStyle: 'hidden',
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

  // 开发调试：Ctrl+Shift+I 打开 DevTools（菜单隐藏后默认快捷键失效）
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools()
    }
  })

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
  // 终端降噪：默认仅转发 WARN/ERROR；设 DSH_VERBOSE=1 时全量转发（排障用）
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (!isVerbose() && level < 2) return
    const prefix = level === 3 ? '[renderer-ERROR]' : level === 2 ? '[renderer-WARN]' : level === 1 ? '[renderer-INFO]' : '[renderer-VERBOSE]'
    console.log(`${prefix} ${message} (line ${line}, ${sourceId})`)
  })

  // M3-b3：--hidden 静默模式下不显示主窗口（开机自启登录后驻留托盘）
  win.once('ready-to-show', () => {
    if (!launchOptions.hidden) win.show()
  })
  win.on('closed', () => {
    cleanupWindowState(win.id)
  })
  // 主窗口也需挂载最大化状态广播（自绘标题栏最大化/还原图标切换依赖它），
  // 否则主窗口最大化后事件不下发、图标不切换（会话窗口由 window-manager 自带）。
  attachWindowMaximizedStateBroadcast(win)
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

    // 0. 应用图标：Windows 任务栏分组标识 + macOS dock 图标（同 harness logo）。
    // dev 模式跳过 AUMID：系统里不存在携带该 AUMID 的快捷方式（打包版才由 NSIS
    // 安装生成），此时 Windows 任务栏会回退显示宿主 exe（electron.exe）的
    // Electron 图标、忽略窗口图标；dev 不设 AUMID 可让任务栏直接用窗口图标
    // （harness logo 黑白双版）。代价仅 dev 态系统通知显示为 Electron 归属，可接受。
    if (app.isPackaged) app.setAppUserModelId('deepseek-harness.desktop')
    if (process.platform === 'darwin') app.dock?.setIcon(loadAppIcon())

    // 1. 协议注册（必须在 boot 前：boot 期间可能触发 dsh-ui:// 加载）
    registerDshUiProtocol()

    // 2. 注册 IPC 桥（必须在 Host 启动前，确保 renderer 就绪通知可接收）
    registerIpcBridge()

    // 2.5. 注册 Cordis inventory 等价面（M2·c 插件列表显示）。
    // 必须早于 createWindow()：ui-cordis 面板在客户端插件挂载时会立即读取
    // `dynamicCordisRunner/inventory`，若晚于窗口创建注册，首次读取会 404 并被缓存。
    // 该方法不依赖 desktopCore，独立于 step 8 的桌面能力守卫。
    const { registerCordisInventoryCompat } = await import('../desktop-host/cordis-inventory.js')
    registerCordisInventoryCompat()

    // 3. 启动 Cordis Host（desktop profile 装配 + 插件树挂载；--serve 控制 Web 传输层启用）
    const { bootDesktopHost } = await import('../desktop-host/boot.js')
    const auditLogFilePath = join(app.getPath('userData'), 'audit.jsonl')
    console.log('[dsh-desktop] 启动 Cordis Host...')
    const hostCtx = await bootDesktopHost({
      // 开发模式：bareModuleBaseUrl 指向项目 node_modules（生产模式由打包配置覆盖）
      bareModuleBaseUrl: join(__dirname, '..', '..', 'node_modules'),
      // Step 6·--serve 兼容模式：默认 false = 零端口 IPC 载波；显式 --serve 时恢复 HTTP loopback
      serveMode: launchOptions.serve,
      servePort: launchOptions.servePort,
      // M3-b2 审计日志路径
      auditLogPath: auditLogFilePath,
    })
    console.log('[dsh-desktop] Cordis Host 已就绪:', hostCtx)

    // 3.5 启动期 Agent 预设诊断（失败必显）：设置页 Agent 预设空白类问题的第一现场。
    // 服务注册名是 camelCase "agentPresets"（坑 12 纪律），list() 为纯目录扫描可安全重入；
    // 页面侧对"空 roster"与"渲染异常"均静默不渲染，只有这里能留下终端痕迹。
    try {
      const presetsService = (hostCtx as { get(name: string): unknown }).get('agentPresets') as
        | { list(): Promise<Array<{ id: string; broken?: string }>> }
        | undefined
      if (presetsService === undefined) {
        console.error('[dsh-boot] Agent 预设服务未装载（agentPresets undefined）——设置页 Agent 预设将为空白')
      } else {
        const scanned = await presetsService.list()
        console.log(
          `[dsh-boot] Agent 预设扫描：${scanned.length} 个 [${scanned.map((p) => p.id + (p.broken !== undefined ? '(broken)' : '')).join(', ')}]`,
        )
        if (scanned.length === 0) {
          console.error('[dsh-boot] Agent 预设扫描结果为空——设置页将为纯空白，请检查构建产物 dist/resources/agent-presets')
        }
      }
    } catch (error) {
      console.error('[dsh-boot] Agent 预设扫描探针失败:', error)
    }

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
    // 统一 host RPC 调用入口：桥 fallback 与启动期预热共用同一通路
    // Typert remote 端点（commands/list、fileReferences/list 等）不在 apiProxy
    // unary 表内（上游经 connection.rpc.intercept('/api') 认领），零端口下由
    // typert-gateway.invokeRpc 兜底，避免 HTTP 404。
    const typertGateway = (hostCtx as { get(name: string): unknown }).get('typertGateway') as
      | { invokeRpc(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: boolean; value?: unknown; error?: { code?: string; message?: string } }> }
      | undefined
    const callApi = async (method: string, params: unknown): Promise<unknown> => {
      const envelope = {
        type: 'client-request' as const,
        rpcId: `rewarm-${method}-${Date.now()}`,
        method,
        payload: params,
      }
      // 官方 toFetchHandler 内部用 new URL(req.url) 取 pathname，相对路径会抛
      // "Failed to parse URL"；这里用 http://local 作虚拟 base，fetch 只读 pathname。
      const res = await apiFetch.fetch(
        new Request(`http://local/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) }),
      )
      if (res.status === 404 && typertGateway !== undefined) {
        // Typert remote 形态：payload 为 {args}，返回 {ok, value | error}
        const result = await typertGateway.invokeRpc(method, params)
        if (result.ok) return result.value
        throw new Error(result.error?.message ?? `typert 调用失败 (${result.error?.code ?? 'unknown'})`)
      }
      return await unpackServerResponse(res)
    }
    setApiProxyHandler(async (request: RpcRequest) => callApi(request.method, request.params))

    // 4.5 宿主骨架外观：先安装句柄（主窗口 + 会话窗口共用），窗口创建后 attach。
    // :root 外观变量注入（托盘色/圆角/边距），二开可经配置或插件覆盖，宿主源码零改动。
    const { installDesktopAppearance } = await import('../desktop-host/desktop-appearance.js')
    desktopAppearanceHandle = installDesktopAppearance()

    // 4.6 主题联动：ui-theme 偏好 → nativeTheme.themeSource（标题栏/原生菜单/
    // renderer prefers-color-scheme 全部跟随应用内主题）；nativeTheme 变化时
    // 刷新窗口/托盘黑白双版图标。建窗前 await ready，保证首帧即正确主题。
    const { installThemeSync } = await import('../desktop-host/theme-sync.js')
    themeSyncHandle = installThemeSync({
      callApi,
      events: apiProxy.events,
      onNativeThemeChanged: () => refreshAppIcons(),
    })
    await themeSyncHandle.ready

    // 4.5 持久化会话预热：冷会话仅 session-scoped 懒路径可恢复，清单中的会话
    // （含 blank 复用路径）需要 live agent；启动后统一经 session.create 重挂载。
    const { rewarmPersistedSessions } = await import('../desktop-host/session-rewarm.js')
    await rewarmPersistedSessions(callApi)

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

    // 6.1 骨架外观注入主窗口（:root 外观变量；did-finish-load 后生效，已加载则立即注入）
    desktopAppearanceHandle?.attach(win)

    // 7. 获取下行帧代理（供 WindowManager 和主窗口中继共用）
    const downlinkProxy = apiProxy as unknown as import('../desktop-host/carrier-relay.js').DownlinkEventStream

    // 7.5. 初始化窗口管理器（M3·多窗口基建 + 持久化）
    const windowStateFilePath = join(app.getPath('userData'), 'window-state.json')
    windowManager = createWindowManager({
      getMainWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
      getAppIconPath: () => join(__dirname, 'web', nativeTheme.shouldUseDarkColors ? 'app-icon-dark.png' : 'app-icon-light.png'),
      apiProxy: downlinkProxy,
      getStateFilePath: () => windowStateFilePath,
      // 会话窗口创建后附加骨架外观注入（:root 外观变量，多窗口一致）
      onSessionWindowCreated: (sessionWin) => desktopAppearanceHandle?.attach(sessionWin),
    })
    windowManager.initialize()
    // 注册窗口管理方法到 bridge
    registerWindowManagerMethods(windowManager)
    // 把 WindowManager 引用注入 bridge，READY 通知后自动推送会话上下文
    const { setWindowManager } = await import('../desktop-host/bridge.js')
    setWindowManager(windowManager)
    console.log('[dsh-desktop] 窗口管理器已初始化')

    // 7.6. 恢复持久化窗口状态（主窗口已创建后恢复会话窗口）
    // M3-b3：--hidden 静默模式下跳过恢复（开机自启登录后驻留托盘，不弹会话窗口）
    const persistedState = await windowManager.loadState()
    if (persistedState !== null && persistedState.windows.length > 0) {
      if (launchOptions.hidden) {
        console.log(`[dsh-desktop] 静默模式：跳过恢复 ${persistedState.windows.length} 个持久化会话窗口`)
      } else {
        console.log(`[dsh-desktop] 恢复 ${persistedState.windows.length} 个持久化会话窗口`)
        windowManager.restorePersistedWindows(persistedState)
      }
    }

    // 8. 启动 host 会话事件 → renderer 下行帧中继（攻坚第 2 批：session/event 等
    //    server-request 帧经 bridge 下发，使官方 UI 完成端到端对话）
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

      // M2·d3 shortcuts/clipboard：全局快捷键 + 剪贴板（write 走 approval）。
      const { installDesktopShortcuts, handleShortcutRegister, handleShortcutUnregister } = await import('../desktop-host/desktop-shortcuts.js')
      const { installDesktopClipboard, handleClipboardReadText, handleClipboardWriteText } = await import('../desktop-host/desktop-clipboard.js')
      const shortcutOptions = { getWindow, desktop: desktopCore }
      const clipboardOptions = { desktop: desktopCore, hostCtx }
      // 注册 bridge unary 方法（shortcut/clipboard → methodTable 分发）
      const { registerMethod } = await import('../desktop-host/bridge.js')
      registerMethod('desktop.shortcut.register', async (params: unknown) => handleShortcutRegister(shortcutOptions, params))
      registerMethod('desktop.shortcut.unregister', async (params: unknown) => handleShortcutUnregister(shortcutOptions, params))
      registerMethod('desktop.clipboard.readText', async () => handleClipboardReadText(clipboardOptions))
      registerMethod('desktop.clipboard.writeText', async (params: unknown) => handleClipboardWriteText(clipboardOptions, params))
      // M2-e 面板控制：open/close 经下行 desktop:event 触发 renderer 侧面板组件
      registerMethod('desktop.panel.open', async () => { desktopCore.sendDesktopEvent({ action: 'open-panel' }); return { opened: true } })
      registerMethod('desktop.panel.close', async () => { desktopCore.sendDesktopEvent({ action: 'close-panel' }); return { closed: true } })

      desktopShortcutsHandle = installDesktopShortcuts(shortcutOptions)
      desktopClipboardHandle = installDesktopClipboard(clipboardOptions)

      // M3·a4 命令面板：全局快捷键 Cmd/Ctrl+Shift+P + Ctrl+K renderer 内面板
      const { installDesktopCmdPalette } = await import('../desktop-host/desktop-cmdpalette.js')
      desktopCmdPaletteHandle = installDesktopCmdPalette({
        getWindow,
        desktop: desktopCore,
        windowManager,
      })

      // M3·b2 审计查看器：审计日志查询服务（读取 audit.jsonl + 过滤 + 分页）
      const { installDesktopAuditViewer } = await import('../desktop-host/desktop-audit-viewer.js')
      desktopAuditViewerHandle = installDesktopAuditViewer({
        getAuditLogPath: () => auditLogFilePath,
      })

      // M3·b3 开机自启：OS 登录项管理（--hidden 静默到托盘；dev 模式拦截注册）
      const { installDesktopAutostart } = await import('../desktop-host/desktop-autostart.js')
      desktopAutostartHandle = installDesktopAutostart({ desktop: desktopCore })

      console.log('[dsh-desktop] 桌面能力已装配：tray + notify + shortcuts + clipboard + cmdpalette + audit-viewer + autostart')

      // M3-b1：处理启动时的 dsh:// 协议 URL（命令行参数）
      const startupDshUrl = extractDshUrlFromArgv(process.argv)
      if (startupDshUrl !== null) {
        pendingDshUrl = startupDshUrl
      }

      // M3-b1：路由待处理的 dsh:// 协议 URL（second-instance/open-url 缓存 + 启动参数）
      if (pendingDshUrl !== null) {
        const getWindow = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null
        const result = routeDshProtocol(pendingDshUrl, {
          getWindow,
          desktop: desktopCore,
          windowManager,
        })
        console.log(`[dsh-protocol] 路由结果: ${result.success ? '成功' : '失败'} - ${result.message ?? result.action}`)
        pendingDshUrl = null
      }
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

app.on('before-quit', async () => {
  // 先确保窗口状态已保存（dispose 内部也会保存，但显式调用更可靠）
  if (windowManager) {
    await windowManager.saveState()
  }
  windowManager?.dispose()
  themeSyncHandle?.stop()
  desktopAuditViewerHandle?.()
  desktopAutostartHandle?.()
  desktopAppearanceHandle?.dispose()
  desktopCmdPaletteHandle?.()
  desktopClipboardHandle?.()
  desktopShortcutsHandle?.()
  desktopNotifyHandle?.()
  desktopTrayHandle?.()
  removeIpcHandlers()
  resetOnCleanQuit()
})
