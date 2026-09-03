/**
 * dsh-desktop 桌面能力·托盘（M2·黄金路径：关窗驻留 + 托盘菜单/状态 + 快速问答唤起）。
 *
 * 项目内模块（M2 阶段，prepare/main 装配，暂不拆独立包）。职责：
 *   - **关窗驻留**：拦截主窗口 `close` → 隐藏而非退出（`trayEnabled` 配置开启时）；
 *     仅托盘「退出」才标记 `quitting` 并 `app.quit()`。
 *   - **托盘菜单**：显示主窗口 / 快速问答 / 应用更新 / 退出（会话列表于后续接入 host 会话服务）。
 *   - **快速问答唤起**：显示 + 聚焦窗口，并下行 `desktop:event`（action `quick-ask`）
 *     供 renderer 聚焦输入框（官方 UI 接入待后续）。
 *   - **应用更新**：自动注入「检查更新…」/「立即重启以更新」菜单项（由 auto-updater 驱动，
 *     经 setTrayUpdaterControl 动态装配，refreshTrayMenu 刷新）。
 *   - 审计：托盘动作经 `ctx.desktop.emitAction('tray.*')`（R-15）。
 *
 * 安装时机：窗口已创建后（main.ts bootstrap），因托盘需窗口引用。返回清理函数（销毁 Tray + 移除拦截）。
 */

import { Tray, Menu, BrowserWindow, app, nativeImage, nativeTheme, type MenuItemConstructorOptions } from 'electron'
import type { DesktopCore } from '../types/desktop.js'
import { getActiveIconPath } from './desktop-theme.js'

// ── 类型 ───────────────────────────────────────────────────────────

/** 托盘安装选项。 */
export interface DesktopTrayOptions {
  /** 取当前主窗口（单窗口期直接返回首个窗口）。 */
  getWindow(): BrowserWindow | null
  /** `ctx.desktop` 聚合服务（读 `trayEnabled` 配置、审计动作）。 */
  desktop: DesktopCore
  /** 应用更新控制（可选；装配后托盘注入「检查更新/重启更新」菜单项）。 */
  updater?: TrayUpdaterControl | null
}

/**
 * 应用更新控制（托盘菜单读取的最小面；由 auto-updater 句柄实现，
 * 结构定义独立于此避免托盘依赖 auto-updater 模块）。
 */
export interface TrayUpdaterControl {
  /** 读取当前更新状态。 */
  getState(): {
    phase: string
    newVersion?: string
    percent?: number
  }
  /** 手动检查更新。 */
  check(): void
  /** 重启并安装已下载更新。 */
  restartToInstall(): void
}

/** 应用是否已标记「真正退出」（关窗驻留拦截时据此放行）。模块级共享给关窗拦截。 */
let quitting = false

/**
 * 标记应用即将真正退出（托盘「退出」菜单调用）；此时关窗驻留不再拦截 close。
 * 供外部（退出流程/重启）在真正 `app.quit()` 前调用。
 */
export function markQuitting(): void {
  quitting = true
}

/** 当前托盘实例（主题切换时 setImage 刷新用）。 */
let tray: Tray | null = null

/** 当前应用更新控制（getState/check/restartToInstall）。 */
let updaterControl: TrayUpdaterControl | null = null

/** 重建托盘菜单闭包（setTrayUpdaterControl / refreshTrayMenu 调用）。 */
let refreshMenu: (() => void) | null = null

/** 兜底图标：内联 32x32 蓝色圆点 PNG（资源缺失时使用）。 */
const FALLBACK_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAd0lEQVR4nO3XsQ6AIAyE4T6X7+ZzO0LiQGJEaAleb7iha/9v0mLHeVlwymRC+3ZFlzF/hd0QRHyIQMU/Ech4F4GOvxAZ8QeCBoCON4QAmfF7BBBAAApA+odIAIrfMQUg/SSjOEopznKKhwnF02wHZLrbC4hgQvsqEs3hXEcpkYIAAAAASUVORK5CYII='

/** 加载托盘图标（主题包激活图标黑白双版随 nativeTheme；缺失回退 base64）。 */
function loadTrayIcon(): Electron.NativeImage {
  const dark = nativeTheme.shouldUseDarkColors
  let icon = nativeImage.createFromPath(getActiveIconPath('tray', dark))
  if (icon.isEmpty()) icon = nativeImage.createFromDataURL(FALLBACK_ICON_DATA_URL)
  return icon
}

/** 主题切换时刷新托盘图标（main.ts refreshAppIcons 调用；托盘未装时 no-op）。 */
export function refreshTrayIcon(): void {
  if (tray === null || tray.isDestroyed()) return
  tray.setImage(loadTrayIcon())
}

/** 根据当前更新状态生成托盘「应用更新」区块菜单项。 */
function updaterMenuItems(): MenuItemConstructorOptions[] {
  const updater = updaterControl
  if (updater === null) return []
  const state = updater.getState()
  if (state.phase === 'downloaded') {
    return [
      {
        label: `立即重启以更新 v${state.newVersion ?? ''}`,
        click: () => updater.restartToInstall(),
      },
    ]
  }
  if (state.phase === 'downloading') {
    return [
      { label: `正在下载更新… ${state.percent ?? 0}%`, enabled: false },
      { label: '检查更新…', enabled: false },
    ]
  }
  if (state.phase === 'checking') {
    return [{ label: '正在检查更新…', enabled: false }]
  }
  // idle / available / not-available / error：始终提供手动检查入口。
  return [{ label: '检查更新…', click: () => updater.check() }]
}

/**
 * 设置应用更新控制并刷新托盘菜单（main.ts 装配 auto-updater 后调用）。
 * 传入 null 表示卸载更新区块（退出清理时置空）。
 */
export function setTrayUpdaterControl(control: TrayUpdaterControl | null): void {
  updaterControl = control
  refreshMenu?.()
}

/**
 * 刷新托盘上下文菜单（auto-updater 状态变更时由 main.ts 经 onStateChange 调用，
 * 或主题图标刷新后调用）。
 */
export function refreshTrayMenu(): void {
  refreshMenu?.()
}

/**
 * 安装托盘（关窗驻留 + 菜单 + 快速问答 + 应用更新）。仅在窗口创建后调用一次。
 *
 * @param options 安装选项。
 * @returns 清理函数（销毁 Tray 并移除 close 拦截）。
 */
export function installDesktopTray(options: DesktopTrayOptions): () => void {
  const { getWindow, desktop } = options
  const trayEnabled = (): boolean => desktop.readConfig<boolean>('trayEnabled') !== false
  updaterControl = options.updater ?? null

  // ── 关窗驻留：拦截 close → 隐藏（未标记退出且 trayEnabled）──────────────
  const window = getWindow()
  const onClose = (event: Electron.Event): void => {
    if (!quitting && trayEnabled()) {
      event.preventDefault()
      window?.hide()
      desktop.emitAction('tray.window-hide')
    }
  }
  if (window !== null) window.on('close', onClose)

  const showWindow = (source: string): void => {
    const win = getWindow()
    if (win !== null) {
      win.show()
      win.focus()
      desktop.emitAction(source, undefined)
    }
  }
  const quickAsk = (): void => {
    const win = getWindow()
    if (win !== null) {
      win.show()
      win.focus()
      // 下行到 renderer 让官方 UI 聚焦输入框（官方 UI 接入后生效）
      desktop.sendDesktopEvent({ action: 'quick-ask' })
      desktop.emitAction('tray.quick-ask', undefined)
    }
  }

  // ── 托盘菜单（含应用更新区块；状态变更时经 refreshTrayMenu 重建）─────────
  const buildMenu = (): Electron.Menu => {
    const template: MenuItemConstructorOptions[] = [
      { label: '显示主窗口', click: () => showWindow('tray.show') },
      { label: '快速问答', click: () => quickAsk() },
    ]
    if (updaterControl !== null) {
      template.push({ type: 'separator' })
      template.push(...updaterMenuItems())
    }
    template.push(
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          markQuitting()
          desktop.emitAction('tray.quit', undefined)
          app.quit()
        },
      },
    )
    return Menu.buildFromTemplate(template)
  }

  // ── 托盘图标与菜单 ─────────────────────────────────────────────────
  // 图标：官方 harness logo 黑白双版（copy-web 复制到 dist/desktop-shell/web/），
  // 64px 供系统缩到通知区 ~16px 保持清晰；主题切换经 refreshTrayIcon 刷新；
  // 资源缺失时回退内联 base64 蓝点 PNG。
  const trayIcon = loadTrayIcon()
  tray = new Tray(trayIcon)

  tray.setToolTip('DeepSeek Harness Desktop')
  refreshMenu = () => {
    if (tray !== null && !tray.isDestroyed()) tray.setContextMenu(buildMenu())
  }
  refreshMenu()
  // 单击托盘图标：显示主窗口
  tray.on('click', () => showWindow('tray.click'))

  // ── 清理 ─────────────────────────────────────────────────────────
  return () => {
    if (window !== null) window.removeListener('close', onClose)
    tray?.destroy()
    tray = null
    updaterControl = null
    refreshMenu = null
  }
}