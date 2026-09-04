/**
 * dsh-desktop 应用自动更新（electron-updater · GitHub Releases 通道）。
 *
 * 仅打包版生效（app.isPackaged）：dev 下返回禁用句柄（无发布通道，避免触发
 * electron-updater 读取缺失的 app-update.yml 而抛错）。electron-updater 的
 * `autoUpdater` 是惰性 getter，仅在打包分支首次访问时才会实例化（dev 下永不触发）。
 *
 * 行为：
 *   - 启动后延迟静默检查（不阻塞窗口首帧；打包版默认自动后台下载、退出自动安装）
 *   - 状态变更 → 系统通知（下载完成）/ 下行 desktop:event（官方 UI 可经 onDesktopEvent
 *     表层化）/ onStateChange（main.ts 用于刷新托盘菜单）
 *   - 托盘「立即重启以更新」→ quitAndInstall
 *
 * 由 main.ts bootstrap 装配；返回清理句柄（dispose 解除事件监听）。
 */

import { app, BrowserWindow, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { DesktopCore } from '../types/desktop.js'
import { log, logVerbose, isVerbose } from './log.js'

// ── 类型 ───────────────────────────────────────────────────────────

/** 更新状态阶段。 */
export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

/** 更新状态快照（托盘菜单 / 下行事件 / 查询用）。 */
export interface UpdaterState {
  phase: UpdaterPhase
  /** 当前运行版本（app.getVersion()）。 */
  currentVersion: string
  /** 新版本号（available/downloaded 时有值）。 */
  newVersion?: string
  /** 下载进度 0-100（downloading 时有值）。 */
  percent?: number
  /** 错误信息（error 时有值）。 */
  error?: string
}

/** 自动更新安装选项。 */
export interface AutoUpdaterOptions {
  /** `ctx.desktop` 聚合服务（下行 desktop:event + 可选审计；可为空）。 */
  desktop?: DesktopCore | null
  /** 取当前主窗口（通知点击定位）。 */
  getWindow(): BrowserWindow | null
  /** 状态变更回调（main.ts 用于刷新托盘菜单）。 */
  onStateChange?(state: UpdaterState): void
  /** 启动后延迟静默检查的毫秒数（默认 20s，避开启动装配峰值）。 */
  initialDelayMs?: number
}

/** 自动更新句柄。 */
export interface AutoUpdaterHandle {
  /** 读取当前更新状态快照。 */
  getState(): UpdaterState
  /** 手动检查更新（持久会话重挂载后调用）。 */
  check(): void
  /** 重启并安装已下载更新（下载完成后调用）。 */
  restartToInstall(): void
  /** 清理：解除事件监听、取消延迟检查（退出前调用）。 */
  dispose(): void
}

// ── 常量与实现 ─────────────────────────────────────────────────────

const INITIAL_DELAY_MS = 20_000
const TAG = '[dsh-updater]'

/**
 * 创建自动更新句柄。dev / 非打包模式下返回禁用句柄（check 仅记录日志）。
 *
 * @param options 安装选项。
 */
export function createAutoUpdater(options: AutoUpdaterOptions): AutoUpdaterHandle {
  const { desktop, getWindow, onStateChange, initialDelayMs = INITIAL_DELAY_MS } = options
  const state: UpdaterState = { phase: 'idle', currentVersion: app.getVersion() }

  // 打包版才启用；dev 下置 disabled，所有动作转为日志提示。
  const disabled = !app.isPackaged

  let initialized = false
  let checkTimer: ReturnType<typeof setTimeout> | null = null
  let disposeEvents: (() => void) | null = null

  /** 合并状态快照：更新内部状态 + 下行事件 + 托盘刷新回调。 */
  const setState = (patch: Partial<UpdaterState>): void => {
    Object.assign(state, patch)
    desktop?.sendDesktopEvent({ action: 'app-update:status', payload: { ...state } })
    onStateChange?.(state)
  }

  /** 触发一条系统通知；点击 → 可选动作。 */
  const notify = (title: string, body: string, onClick?: () => void): void => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, silent: true })
    if (onClick !== undefined) {
      const win = getWindow()
      n.on('click', () => {
        const target = getWindow() ?? win
        if (target !== null && !target.isDestroyed()) {
          target.show()
          target.focus()
        }
        onClick()
      })
    }
    n.show()
  }

  /** 初始化 electron-updater（仅打包版调用一次）。 */
  const initialize = (): void => {
    if (initialized) return
    initialized = true

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    // 让 electron-updater 内部日志收敛到统一终端日志（RPC 级错误必显示，
    // 事件流 debug 仅 verbose）。
    autoUpdater.logger = {
      info: (msg) => logVerbose('dsh-updater', msg),
      warn: (msg) => log.warn(`${TAG} ${msg}`),
      error: (msg) => log.error(`${TAG} ${msg}`),
      debug: (msg) => logVerbose('dsh-updater', msg),
    }

    const offs: Array<{
      event: 'checking-for-update' | 'update-available' | 'update-not-available' | 'download-progress' | 'update-downloaded' | 'error'
      handler: (...args: unknown[]) => void
    }> = [
      { event: 'checking-for-update', handler: () => { setState({ phase: 'checking' }); log.info(`${TAG} 正在检查更新…`) } },
      { event: 'update-available', handler: (info) => { const v = (info as { version?: string }).version; setState({ phase: 'available', newVersion: v }); log.ok(`${TAG} 发现新版本 v${v}，开始后台下载`) } },
      { event: 'update-not-available', handler: () => { setState({ phase: 'not-available', newVersion: undefined, percent: undefined }); log.info(`${TAG} 已是最新版本 (v${state.currentVersion})`) } },
      { event: 'download-progress', handler: (progress) => { const p = progress as { percent: number }; const percent = Math.round(p.percent); setState({ phase: 'downloading', percent }); if (isVerbose()) logVerbose('dsh-updater', `下载进度 ${p.percent.toFixed(1)}%`) } },
      {
        event: 'update-downloaded',
        handler: (info) => {
          const v = (info as { version?: string }).version
          setState({ phase: 'downloaded', newVersion: v, percent: 100 })
          log.ok(`${TAG} 新版本 v${v} 已就绪，重启以更新`)
          notify('更新已就绪', `DSH Desktop v${v} 已下载完成，点击可立即重启以更新。`, () => restartToInstall())
        },
      },
      { event: 'error', handler: (error) => { setState({ phase: 'error', error: error instanceof Error ? error.message : String(error) }); log.error(`${TAG} 检查/下载更新失败:`, error) } },
    ]
    for (const reg of offs) autoUpdater.on(reg.event, reg.handler as never)
    disposeEvents = () => {
      for (const reg of offs) autoUpdater.removeListener(reg.event, reg.handler as never)
    }

    // 静默延迟检查（不阻塞窗口首帧）。
    checkTimer = setTimeout(() => {
      checkTimer = null
      if (state.phase === 'downloaded' || state.phase === 'checking') return
      autoUpdater.checkForUpdates().catch((error) => {
        log.error(`${TAG} 初始更新检查失败:`, error)
      })
    }, initialDelayMs)
  }

  /** 手动检查更新。 */
  const check = (): void => {
    if (disabled) {
      log.info(`${TAG} 自动更新在开发模式（未打包）下不可用`)
      return
    }
    if (!initialized) initialize()
    if (state.phase === 'downloaded' || state.phase === 'checking') return
    autoUpdater.checkForUpdates().catch((error) => {
      log.error(`${TAG} 手动检查更新失败:`, error)
    })
  }

  /** 重启并安装已下载更新。 */
  const restartToInstall = (): void => {
    if (disabled || state.phase !== 'downloaded') {
      log.warn(`${TAG} 尚无已下载更新可安装（当前阶段: ${state.phase}）`)
      return
    }
    log.ok(`${TAG} 退出并安装更新 v${state.newVersion ?? ''}`)
    try {
      autoUpdater.quitAndInstall()
    } catch (error) {
      log.error(`${TAG} 触发重启安装失败:`, error)
    }
  }

  // 打包版：装配后立即按延迟静默检查；dev 不初始化（避免读 app-update.yml 报错）。
  if (disabled) {
    log.info(`${TAG} 自动更新在开发模式（未打包）下停用`)
  } else {
    initialize()
  }

  return {
    getState: () => ({ ...state }),
    check,
    restartToInstall,
    dispose: () => {
      if (checkTimer !== null) {
        clearTimeout(checkTimer)
        checkTimer = null
      }
      disposeEvents?.()
      disposeEvents = null
    },
  }
}