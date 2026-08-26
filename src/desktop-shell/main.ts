import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerDshUiProtocol, registerDshUiScheme } from './dsh-ui-protocol'
import { registerIpcBridge, cleanupWindowState, removeIpcHandlers } from '../desktop-host/bridge.js'
import { registerIpcCarrierServices } from '../desktop-host/manifest.js'
import type { RpcRequest } from '../types/contract.js'

/**
 * dsh-desktop 主进程入口（M1·步骤4：boot() 装配 + IPC 载波 + dsh-ui:// 协议加载官方 Web UI）。
 *
 * 启动时序：
 * 1. userData 重定向 → 单实例锁
 * 2. app.whenReady() → registerDshUiProtocol() → registerIpcBridge() → bootDesktopHost() → createWindow()
 *
 * 后续扩展：单例锁管理、崩溃 relaunch（步骤6）；
 * src/desktop-host 承载 boot() desktop profile 装配。
 */

// userData 重定向到项目内 .runtime/user-data：开发期避开系统 AppData（沙箱/残留垃圾易致
// Chromium 锁与缓存创建失败），且随仓库可整体清理。必须在 any app 事件前设置。
app.setPath('userData', join(__dirname, '..', '..', '.runtime', 'user-data'))

// 注册 dsh-ui:// 协议方案特权（必须在 app.whenReady 前）
registerDshUiScheme()

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
}

// ── 预加载脚本路径 ───────────────────────────────────────────────────

/** preload 脚本绝对路径（在同样 tsconfig rootDir 下编译后位于 dist/desktop-shell/）。 */
const PRELOAD_PATH = join(__dirname, 'preload.js')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
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

  // 页面加载完成
  win.webContents.on('did-finish-load', () => {
    console.log('[dsh-desktop] 页面加载完成，URL:', win.webContents.getURL())
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[dsh-desktop] 页面加载失败 (${errorCode}): ${errorDescription} URL: ${validatedURL}`)
  })

  // 渲染进程崩溃
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[dsh-desktop] 渲染进程崩溃: reason=${details.reason}, exitCode=${details.exitCode}`)
  })

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
  void win.loadURL('dsh-ui://index.html')
}

app
  .whenReady()
  .then(async () => {
    // 1. 协议注册（必须在 boot 前：boot 期间可能触发 dsh-ui:// 加载）
    registerDshUiProtocol()

    // 2. 注册 IPC 桥（必须在 Host 启动前，确保 renderer 就绪通知可接收）
    registerIpcBridge()

    // 3. 启动 Cordis Host（desktop profile 装配 + 插件树挂载）
    const { bootDesktopHost } = await import('../desktop-host/boot.js')
    console.log('[dsh-desktop] 启动 Cordis Host...')
    const hostCtx = await bootDesktopHost({
      // 开发模式：bareModuleBaseUrl 指向项目 node_modules（生产模式由打包配置覆盖）
      bareModuleBaseUrl: join(__dirname, '..', '..', 'node_modules'),
    })
    console.log('[dsh-desktop] Cordis Host 已就绪:', hostCtx)

    // 4. 连接 IPC 桥与 Cordis Host 的 apiProxy
    const { setApiProxyHandler } = await import('../desktop-host/bridge.js')
    setApiProxyHandler(async (request: RpcRequest) => {
      // 委托给 Cordis Host 的 apiProxy 服务处理
      const apiProxy = (hostCtx as Record<string, unknown>)['apiProxy'] as
        | { handleRpc?: (req: RpcRequest) => Promise<unknown> }
        | undefined
      if (apiProxy?.handleRpc !== undefined) {
        return await apiProxy.handleRpc(request)
      }
      // 无 apiProxy 时回退到直接调用 hostCtx 上的方法
      const svc = (hostCtx as Record<string, unknown>)[request.method] as
        | ((...args: unknown[]) => unknown)
        | undefined
      if (typeof svc === 'function') {
        return await svc(request.params)
      }
      throw new Error(`未找到方法: ${request.method}`)
    })

    // 5. 注册 IPC 载波服务到 Cordis 上下文
    registerIpcCarrierServices(hostCtx, {
      handleRpc: async (request: RpcRequest) => {
        const apiProxy = (hostCtx as Record<string, unknown>)['apiProxy'] as
          | { handleRpc?: (req: RpcRequest) => Promise<unknown> }
          | undefined
        if (apiProxy?.handleRpc !== undefined) {
          return await apiProxy.handleRpc(request)
        }
        return undefined
      },
      handleRespond: async (response: { rpcId: string; body: unknown }) => {
        const apiProxy = (hostCtx as Record<string, unknown>)['apiProxy'] as
          | { handleRespond?: (res: { rpcId: string; body: unknown }) => Promise<{ accepted: boolean }> }
          | undefined
        if (apiProxy?.handleRespond !== undefined) {
          return await apiProxy.handleRespond(response)
        }
        return { accepted: false }
      },
    })

    // 6. 创建窗口并加载官方 UI
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error: unknown) => {
    console.error('[dsh-desktop] 启动失败:', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  removeIpcHandlers()
})
