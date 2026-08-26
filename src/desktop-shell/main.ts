import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerDshUiProtocol } from './dsh-ui-protocol'

/**
 * dsh-desktop 主进程入口（M1·步骤3：dsh-ui:// 协议加载官方 Web UI dist）。
 * 后续由 src/desktop-shell 扩展：单例锁管理、崩溃 relaunch（步骤6）；
 * src/desktop-host 承载 boot() desktop profile 装配（步骤3 次阶段）。
 */

// userData 重定向到项目内 .runtime/user-data：开发期避开系统 AppData（沙箱/残留垃圾易致
// Chromium 锁与缓存创建失败），且随仓库可整体清理。必须在 any app 事件前设置。
app.setPath('userData', join(__dirname, '..', '..', '.runtime', 'user-data'))

// 单实例锁：防止多开导致宿主与数据目录冲突（正式策略后续在 desktop-shell 收敛）
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 步骤3 起：聚焦已存在的主窗口
    const [win] = BrowserWindow.getAllWindows()
    if (win !== undefined) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

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
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  void win.loadURL('dsh-ui://index.html')
}

app
  .whenReady()
  .then(() => {
    registerDshUiProtocol()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error: unknown) => {
    console.error('Electron 初始化失败:', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})