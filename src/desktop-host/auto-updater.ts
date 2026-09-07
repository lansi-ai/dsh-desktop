/**
 * dsh-desktop 应用自动更新（electron-updater · GitHub Releases 通道）。
 *
 * 仅打包版生效（app.isPackaged）：dev 下返回禁用句柄（无发布通道，避免触发
 * electron-updater 读取缺失的 app-update.yml 而抛错）。electron-updater 的
 * `autoUpdater` 是惰性 getter，仅在打包分支首次访问时才会实例化（dev 下永不触发）。
 *
 * 渠道（三态）：stable（正式 release，latest.yml）/ rc（prerelease，latest-rc.yml）/
 * off（完全关闭，无静默检查且手动 check 也 no-op）。
 *
 * 行为：
 *   - 启动后按 `channel` / `autoCheck` 决定是否延迟静默检查（不阻塞窗口首帧）
 *   - 状态变更 → 系统通知（下载完成）/ 下行 desktop:event（官方 UI 可经 onDesktopEvent
 *     表层化）/ onStateChange（main.ts 用于刷新托盘菜单）
 *   - 托盘「立即重启以更新」→ quitAndInstall
 *   - `setChannel` / `setAutoCheck` 支持运行时切换：off↔on 即时补/撤检查并触发一次
 *     查询；rc↔stable 仅切换 feed（latest-rc.yml ↔ latest.yml），结果于下次检查或
 *     用户手动「检查更新」时生效
 *
 * 由 main.ts bootstrap 装配；返回清理句柄（dispose 解除事件监听）。
 */

import { app, BrowserWindow, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { DesktopCore } from '../types/desktop.js'
import { log, logVerbose, isVerbose } from './log.js'

// ── 类型 ───────────────────────────────────────────────────────────

/** 更新渠道：stable（正式）/ rc（预发布）/ off（完全关闭）。 */
export type UpdaterChannel = 'stable' | 'rc' | 'off'

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
  /** 更新渠道（默认 stable；off 完全关闭）。 */
  channel?: UpdaterChannel
  /** 启动是否执行静默自动检查（默认 true；仅 channel !== 'off' 时有效）。 */
  autoCheck?: boolean
}

/** 自动更新句柄。 */
export interface AutoUpdaterHandle {
  /** 读取当前更新状态快照。 */
  getState(): UpdaterState
  /** 读取当前更新渠道。 */
  getChannel(): UpdaterChannel
  /** 读取当前「启动静默自动检查」开关（仅 channel !== 'off' 时有效）。 */
  getAutoCheck(): boolean
  /** 运行时切换渠道（off↔on 即时生效；更新已下载时不受影响）。 */
  setChannel(channel: UpdaterChannel): void
  /** 运行时切换「启动静默自动检查」开关（仅 channel !== 'off' 时有效）。 */
  setAutoCheck(enabled: boolean): void
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

/** 渠道 → electron-updater `channel`（stable 用 null 走默认 latest.yml）。 */
const CHANNEL_FEED: Record<Exclude<UpdaterChannel, 'off'>, string | null> = {
  stable: null,
  rc: 'rc',
}

/**
 * 创建自动更新句柄。dev / 非打包模式 / off 渠道下返回禁用句柄（check 仅记录日志）。
 *
 * @param options 安装选项。
 */
export function createAutoUpdater(options: AutoUpdaterOptions): AutoUpdaterHandle {
  const { desktop, getWindow, onStateChange, initialDelayMs = INITIAL_DELAY_MS } = options
  const state: UpdaterState = { phase: 'idle', currentVersion: app.getVersion() }

  // 运行时可变渠道与自动检查开关（setChannel / setAutoCheck 修改；defaultValue 兜底）。
  let currentChannel: UpdaterChannel = options.channel ?? 'stable'
  let autoCheckEnabled: boolean = options.autoCheck ?? true

  // 打包版 + 非 off 才启用；其余置 disabled，所有动作转为日志提示。
  const isDisabled = (): boolean => !app.isPackaged || currentChannel === 'off'

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

  /** 取消尚未触发的延迟检查定时器。 */
  const clearCheckTimer = (): void => {
    if (checkTimer !== null) {
      clearTimeout(checkTimer)
      checkTimer = null
    }
  }

  /** 按当前渠道同步 electron-updater 订阅（stable → 默认 latest.yml，rc → latest-rc.yml）。 */
  const syncChannelFeed = (): void => {
    if (currentChannel === 'off') return
    autoUpdater.channel = CHANNEL_FEED[currentChannel]
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
          notify('更新已就绪', `DSH Forge v${v} 已下载完成，点击可立即重启以更新。`, () => restartToInstall())
        },
      },
      { event: 'error', handler: (error) => { setState({ phase: 'error', error: error instanceof Error ? error.message : String(error) }); log.error(`${TAG} 检查/下载更新失败:`, error) } },
    ]
    for (const reg of offs) autoUpdater.on(reg.event, reg.handler as never)
    disposeEvents = () => {
      for (const reg of offs) autoUpdater.removeListener(reg.event, reg.handler as never)
    }

    syncChannelFeed()

    // 静默延迟检查（不阻塞窗口首帧；受 autoCheckEnabled 门控）。
    if (autoCheckEnabled) {
      checkTimer = setTimeout(() => {
        checkTimer = null
        if (state.phase === 'downloaded' || state.phase === 'checking') return
        autoUpdater.checkForUpdates().catch((error) => {
          log.error(`${TAG} 初始更新检查失败:`, error)
        })
      }, initialDelayMs)
    }
  }

  /** 手动检查更新。 */
  const check = (): void => {
    if (isDisabled()) {
      log.info(`${TAG} 自动更新在开发模式（未打包）或 off 渠道下不可用`)
      return
    }
    if (!initialized) initialize()
    if (state.phase === 'downloaded' || state.phase === 'checking') return
    syncChannelFeed()
    autoUpdater.checkForUpdates().catch((error) => {
      log.error(`${TAG} 手动检查更新失败:`, error)
    })
  }

  /** 重启并安装已下载更新。 */
  const restartToInstall = (): void => {
    if (isDisabled() || state.phase !== 'downloaded') {
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

  /** 运行时切换渠道。off↔on 即时生效：切到 on 时补初始化并重查。 */
  const setChannel = (channel: UpdaterChannel): void => {
    if (channel === currentChannel) return
    const prev = currentChannel
    currentChannel = channel
    log.info(`${TAG} 更新渠道切换: ${prev} → ${channel}`)
    if (isDisabled()) {
      // 切到 off：撤掉未触发的延迟检查；已初始化无法卸载事件，但后续 check 均 no-op。
      clearCheckTimer()
      return
    }
    if (!initialized) initialize()
    syncChannelFeed()
    // 离线→在线切换后触发一次即时检查，让新渠道立即生效。
    if (prev === 'off' && state.phase !== 'downloaded' && state.phase !== 'checking') {
      autoUpdater.checkForUpdates().catch((error) => {
        log.error(`${TAG} 渠道切换后检查失败:`, error)
      })
    }
  }

  /** 运行时切换「启动静默自动检查」开关。 */
  const setAutoCheck = (enabled: boolean): void => {
    if (enabled === autoCheckEnabled) return
    autoCheckEnabled = enabled
    if (enabled && currentChannel !== 'off') {
      clearCheckTimer()
      if (!initialized) initialize()
      if (state.phase !== 'downloaded' && state.phase !== 'checking') {
        syncChannelFeed()
        autoUpdater.checkForUpdates().catch((error) => {
          log.error(`${TAG} 开启自动检查后检查失败:`, error)
        })
      }
    }
  }

  // 打包版：装配后按延迟静默检查（受 autoCheck 门控）；dev / off 不初始化（避免读 app-update.yml 报错）。
  if (isDisabled()) {
    log.info(`${TAG} 自动更新在开发模式（未打包）或 off 渠道下停用`)
  } else {
    initialize()
  }

  return {
    getState: () => ({ ...state }),
    getChannel: () => currentChannel,
    getAutoCheck: () => autoCheckEnabled,
    setChannel,
    setAutoCheck,
    check,
    restartToInstall,
    dispose: () => {
      clearCheckTimer()
      disposeEvents?.()
      disposeEvents = null
    },
  }
}