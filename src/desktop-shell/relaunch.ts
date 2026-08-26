/**
 * dsh-desktop 崩溃 relaunch 自愈 v0（Step 6）。
 *
 * 策略：
 * - 主进程崩溃（uncaughtException）→ app.relaunch() 有限重启
 * - 渲染进程崩溃（render-process-gone）→ 自动 reload 窗口，超次升级为整体重启
 * - 熔断：连续崩溃在 CRASH_WINDOW_MS 窗口内累计到 RELAUNCH_LIMIT 次即停止自愈，防止无限重启
 *
 * 状态持久化到 .runtime/relaunch-state.json，跨进程重启保留熔断计数；
 * 正常退出（非崩溃引导）时清零计数。
 */

import { app, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** relaunch 状态文件结构。 */
interface RelaunchState {
  /** 当前熔断窗口内累计崩溃次数。 */
  count: number
  /** 最近一次崩溃时间戳（ms）。 */
  lastAt: number
}

/** 熔断：连续崩溃上限（超过则停止自愈）。 */
const RELAUNCH_LIMIT = 3
/** 熔断时间窗口（毫秒）：窗口内的崩溃才累计。 */
const CRASH_WINDOW_MS = 60_000
/** 日志前缀。 */
const TAG = '[dsh-relaunch]'

const RUNTIME_DIR = join(__dirname, '..', '..', '.runtime')
const STATE_FILE = join(RUNTIME_DIR, 'relaunch-state.json')

/** 本次进程是否因崩溃引导退出（用于区分正常退出以清零计数）。 */
let isExitingForCrash = false

/** 读取熔断状态（文件缺失/损坏时回退到初始状态）。 */
function readState(): RelaunchState {
  try {
    if (existsSync(STATE_FILE)) {
      const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Partial<RelaunchState>
      return {
        count: typeof raw.count === 'number' && raw.count >= 0 ? raw.count : 0,
        lastAt: typeof raw.lastAt === 'number' ? raw.lastAt : Date.now(),
      }
    }
  } catch (error) {
    console.error(`${TAG} 读取 relaunch 状态失败:`, error)
  }
  return { count: 0, lastAt: Date.now() }
}

/** 写入熔断状态（失败仅记录日志，不影响主流程）。 */
function writeState(state: RelaunchState): void {
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(state))
  } catch (error) {
    console.error(`${TAG} 写入 relaunch 状态失败:`, error)
  }
}

/** 状态是否仍落在熔断窗口内（否则视为一次新事件）。 */
function withinWindow(lastAt: number): boolean {
  return Date.now() - lastAt <= CRASH_WINDOW_MS
}

/**
 * 熔断开关：当前熔断窗口内累计崩溃次数超过上限时为 true。
 * 本次启动将拒绝自动重启（防止无限重启循环）。
 */
export function isCircuitBroken(): boolean {
  const state = readState()
  return withinWindow(state.lastAt) && state.count > RELAUNCH_LIMIT
}

/**
 * 清零熔断计数（正常退出时调用，视为一次成功运行）。
 */
export function resetRelaunchState(): void {
  writeState({ count: 0, lastAt: Date.now() })
}

/**
 * 触发一次崩溃 relaunch。
 *
 * 累计崩溃次数，未超上限则 relaunch 进程；达到上限则停止并退出，
 * 避免无限重启。计数写入状态文件以跨进程保留。
 *
 * @param reason 崩溃原因描述（日志用）。
 */
export function scheduleRelaunch(reason: string): void {
  const state = readState()
  const count = withinWindow(state.lastAt) ? state.count + 1 : 1
  writeState({ count, lastAt: Date.now() })

  if (count > RELAUNCH_LIMIT) {
    console.error(`${TAG} 连续崩溃 ${count} 次（上限 ${RELAUNCH_LIMIT}），熔断停止自愈。原因: ${reason}`)
    isExitingForCrash = true
    app.exit(1)
    return
  }

  console.error(`${TAG} 检测到崩溃（${count}/${RELAUNCH_LIMIT}），准备重启。原因: ${reason}`)
  isExitingForCrash = true
  app.relaunch()
  app.exit(1)
}

/**
 * 正常退出（非崩溃引导）时清零熔断计数。
 * 供 'before-quit' 事件调用。
 */
export function resetOnCleanQuit(): void {
  if (isExitingForCrash) return
  resetRelaunchState()
}

/**
 * 安装主进程崩溃处理器。
 *
 * uncaughtException 视为致命崩溃触发 relaunch；unhandledRejection 仅记录日志
 * （不直接判定为崩溃，避免误触发无限重启）。
 */
export function installMainCrashHandlers(): void {
  process.on('uncaughtException', (error) => {
    console.error(`${TAG} 主进程 uncaughtException:`, error)
    scheduleRelaunch(`uncaughtException: ${error instanceof Error ? error.message : String(error)}`)
  })

  process.on('unhandledRejection', (reason) => {
    console.error(`${TAG} 主进程 unhandledRejection:`, reason)
  })
}

/**
 * 为窗口安装渲染进程崩溃自愈：自动 reload 窗口，超次升级为整体重启。
 *
 * @param win 目标窗口。
 */
export function installRendererCrashRecovery(win: BrowserWindow): void {
  let recentCrashes: number[] = []

  win.webContents.on('render-process-gone', (_event, details) => {
    const now = Date.now()
    recentCrashes = recentCrashes.filter((ts) => now - ts <= CRASH_WINDOW_MS)
    recentCrashes.push(now)

    if (recentCrashes.length >= RELAUNCH_LIMIT) {
      console.error(
        `${TAG} 渲染进程连续崩溃 ${recentCrashes.length} 次，升级为整体重启。reason=${details.reason}`,
      )
      scheduleRelaunch(`renderer-gone: ${details.reason}`)
      return
    }

    console.error(
      `${TAG} 渲染进程崩溃，自动 reload 窗口。reason=${details.reason}, exitCode=${details.exitCode}`,
    )
    win.webContents.reload()
  })
}
