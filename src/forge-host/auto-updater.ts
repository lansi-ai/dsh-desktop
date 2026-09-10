/**
 * dsh-forge 应用自动更新（electron-updater · GitHub Releases 通道）。
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
 *   - 关键相位落审计（checking / available / not-available / downloaded / error，
 *     经 `ctx.desktop.log` → `audit.jsonl`，含当前渠道与错误堆栈）：安装版从资源管理器
 *     启动时无控制台，终端日志等于丢失，审计是失败原因的唯一事后排查面；downloading
 *     为高频进度帧，不入审计以免刷爆日志文件
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

/** 落审计的关键相位（`downloading` 为高频进度帧，不入审计以免刷爆 audit.jsonl）。 */
const AUDIT_PHASES: ReadonlySet<UpdaterPhase> = new Set<UpdaterPhase>([
  'checking',
  'available',
  'not-available',
  'downloaded',
  'error',
])

/** 审计文本字段长度上限（防超长 XML/堆栈把单条 JSONL 撑爆）。 */
const AUDIT_TEXT_LIMIT = 2000

/** 截断超长审计文本（保留截断标记，便于识别非完整原文）。 */
function truncateForAudit(text: string): string {
  return text.length > AUDIT_TEXT_LIMIT ? `${text.slice(0, AUDIT_TEXT_LIMIT)}…[truncated]` : text
}

/**
 * 创建自动更新句柄。dev / 非打包模式 / off 渠道下返回禁用句柄（check 仅记录日志）。
 *
 * @param options 安装选项。
 */
export function createAutoUpdater(options: AutoUpdaterOptions): AutoUpdaterHandle {
  const { desktop, getWindow, onStateChange, initialDelayMs = INITIAL_DELAY_MS } = options
  const state: UpdaterState = { phase: 'idle', currentVersion: app.getVersion() }

  /** 最近一次错误的堆栈（仅入审计，用于定位网络层超时等 message 不足以说明的失败）。 */
  let lastErrorStack: string | undefined

  // 运行时可变渠道与自动检查开关（setChannel / setAutoCheck 修改；defaultValue 兜底）。
  let currentChannel: UpdaterChannel = options.channel ?? 'stable'
  let autoCheckEnabled: boolean = options.autoCheck ?? true

  // 打包版 + 非 off 才启用；其余置 disabled，所有动作转为日志提示。
  const isDisabled = (): boolean => !app.isPackaged || currentChannel === 'off'

  let initialized = false
  let checkTimer: ReturnType<typeof setTimeout> | null = null
  let disposeEvents: (() => void) | null = null
  /** 本次检查是否为用户手动发起（决定终态是否给可见反馈；见 checkInternal）。 */
  let lastCheckManual = false

  /** 组装审计载荷（含当前渠道；失败时附加截断后的错误堆栈）。 */
  const buildAuditPayload = (): Record<string, unknown> => ({
    phase: state.phase,
    currentVersion: state.currentVersion,
    channel: currentChannel,
    manual: lastCheckManual,
    ...(state.newVersion !== undefined ? { newVersion: state.newVersion } : {}),
    ...(state.error !== undefined ? { error: truncateForAudit(state.error) } : {}),
    ...(state.phase === 'error' && lastErrorStack !== undefined
      ? { errorStack: truncateForAudit(lastErrorStack) }
      : {}),
  })

  /** 合并状态快照：更新内部状态 + 下行事件 + 托盘刷新回调 + 关键相位审计。 */
  const setState = (patch: Partial<UpdaterState>): void => {
    const prevPhase = state.phase
    Object.assign(state, patch)
    // manual 随事件下行：渲染侧据此只对「用户手动发起」的结果给提示（静默自检保持安静）
    desktop?.sendDesktopEvent({ action: 'app-update:status', payload: { ...state, manual: lastCheckManual } })
    onStateChange?.(state)
    // 审计落盘（R-15 事后排查面）：仅关键相位；error 每次必写（失败原因不能因相位未变
    // 而丢），其余相位变化才写。downloading 进度帧被 AUDIT_PHASES 拦截。
    if (AUDIT_PHASES.has(state.phase) && (state.phase === 'error' || state.phase !== prevPhase)) {
      desktop?.log('app-update:status', buildAuditPayload())
    }
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

  /**
   * 手动检查的结果反馈：仅当主窗口未聚焦时才发系统通知。
   * 窗口在前台时关于页已有结果提示，再弹通知是重复打扰。
   */
  const notifyResult = (title: string, body: string): void => {
    const win = getWindow()
    if (win !== null && !win.isDestroyed() && win.isFocused()) return
    notify(title, body, () => { /* 点击由 notify 内部聚焦主窗口 */ })
  }

  /** 取错误首行摘要（通知体不宜过长；完整原文在关于页与 audit.jsonl）。 */
  const summarizeError = (error: unknown): string => {
    const text = error instanceof Error ? error.message : String(error)
    const firstLine = text.split('\n')[0]
    return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine
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
      { event: 'checking-for-update', handler: () => { lastErrorStack = undefined; setState({ phase: 'checking', error: undefined }); log.info(`${TAG} 正在检查更新…`) } },
      { event: 'update-available', handler: (info) => { const v = (info as { version?: string }).version; setState({ phase: 'available', newVersion: v }); log.ok(`${TAG} 发现新版本 v${v}，开始后台下载`) } },
      {
        event: 'update-not-available',
        handler: () => {
          setState({ phase: 'not-available', newVersion: undefined, percent: undefined })
          log.info(`${TAG} 已是最新版本 (v${state.currentVersion})`)
          if (lastCheckManual) notifyResult('检查更新', `已是最新版本（v${state.currentVersion}）`)
        },
      },
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
      {
        event: 'error',
        handler: (error) => {
          lastErrorStack = error instanceof Error ? error.stack : undefined
          setState({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
          log.error(`${TAG} 检查/下载更新失败:`, error)
          if (lastCheckManual) notifyResult('检查更新失败', summarizeError(error))
        },
      },
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
        checkInternal(false)
      }, initialDelayMs)
    }
  }

  /**
   * 检查更新内核。
   *
   * @param manual 是否为用户手动发起 —— 决定终态是否给可见反馈（关于页结果提示 +
   *   窗口未聚焦时的系统通知）。启动静默自检与渠道/开关联动检查传 false，保持安静。
   */
  const checkInternal = (manual: boolean): void => {
    if (isDisabled()) {
      log.info(`${TAG} 自动更新在开发模式（未打包）或 off 渠道下不可用`)
      return
    }
    if (!initialized) initialize()
    if (state.phase === 'downloaded' || state.phase === 'checking') return
    lastCheckManual = manual
    syncChannelFeed()
    autoUpdater.checkForUpdates().catch((error) => {
      log.error(`${TAG} ${manual ? '手动' : '静默'}检查更新失败:`, error)
    })
  }

  /** 手动检查更新（用户入口：关于页按钮 / 托盘菜单）。 */
  const check = (): void => { checkInternal(true) }

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
    // 渠道切换后的即时检查属系统联动（非「检查更新」点击）→ 静默
    if (prev === 'off') checkInternal(false)
  }

  /** 运行时切换「启动静默自动检查」开关。 */
  const setAutoCheck = (enabled: boolean): void => {
    if (enabled === autoCheckEnabled) return
    autoCheckEnabled = enabled
    if (enabled && currentChannel !== 'off') {
      clearCheckTimer()
      if (!initialized) initialize()
      // 开关联动检查属系统行为 → 静默
      checkInternal(false)
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