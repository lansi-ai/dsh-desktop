/**
 * 自绘首启窗口（M4 · 首次使用选择用户数据存储位置）。
 *
 * 生命周期：仅首启（userData 无 data-location.json）且非静默启动时由
 * data-home.ts 调用；用户确认后窗口关闭、Promise resolve，主流程继续
 * （设 DSH_HOME → 闪屏 → Host 装配）。用户直接关闭窗口 resolve null。
 *
 * 通信：专用 preload（first-run-preload.ts）暴露 firstRunBridge；
 * IPC 通道 first-run:* 在窗口期间注册、finally 统一移除，零残留。
 * 页面：src/desktop-shell/web/first-run.html（copy-web.cjs 复制进 dist）。
 */

import { BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { log } from '../desktop-host/log.js'

/** 首启窗口的用户决定。 */
export interface FirstRunChoice {
  /** 选定的数据目录绝对路径。 */
  readonly home: string
  /** 是否把默认目录（旧 harness home）数据迁移到新位置。 */
  readonly migrate: boolean
}

/** 首启窗口入参。 */
export interface FirstRunOptions {
  /** 默认数据目录（预选值 = 官方 harness home 缺省解析结果）。 */
  readonly defaultHome: string
  /** 默认目录是否已存在（有旧数据时展示迁移选项）。 */
  readonly legacyExists: boolean
}

/** 首启状态页负载（first-run:get-state 响应）。 */
interface FirstRunState {
  readonly defaultHome: string
  readonly legacyExists: boolean
  readonly isDark: boolean
}

/** 确认请求的校验/迁移结果（first-run:confirm 响应）。 */
interface ConfirmResult {
  readonly ok: boolean
  readonly error?: string
}

const IPC_GET_STATE = 'first-run:get-state'
const IPC_BROWSE = 'first-run:browse'
const IPC_CONFIRM = 'first-run:confirm'

/** 展示首启窗口并等待用户决定；窗口被直接关闭时 resolve null。 */
export async function showFirstRunWindow(options: FirstRunOptions): Promise<FirstRunChoice | null> {
  const state: FirstRunState = { ...options, isDark: nativeTheme.shouldUseDarkColors }
  let settled = false
  let resolveChoice: (choice: FirstRunChoice | null) => void = () => {}

  const done = (choice: FirstRunChoice | null): void => {
    if (settled) return
    settled = true
    resolveChoice(choice)
  }

  const win = new BrowserWindow({
    width: 620,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'DSH Desktop 初始设置',
    show: false,
    backgroundColor: state.isDark ? '#1c1c1e' : '#f2f3f5',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: join(__dirname, 'first-run-preload.js'),
    },
  })
  win.setMenuBarVisibility(false)
  win.removeMenu()
  win.on('closed', () => done(null))
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })

  // 确认：校验目录可建 +（可选）迁移旧数据；成功后回传选择并关窗。
  ipcMain.handle(IPC_GET_STATE, () => state)
  ipcMain.handle(IPC_BROWSE, async () => {
    const ret = await dialog.showOpenDialog(win, {
      title: '选择用户数据存储位置',
      defaultPath: state.defaultHome,
      properties: ['openDirectory', 'createDirectory'],
    })
    return ret.canceled || ret.filePaths.length === 0 ? null : ret.filePaths[0]
  })
  ipcMain.handle(IPC_CONFIRM, async (_event, home: unknown, migrate: unknown): Promise<ConfirmResult> => {
    if (typeof home !== 'string' || home.trim().length === 0) return { ok: false, error: '目录不能为空' }
    try {
      await fs.mkdir(home, { recursive: true })
      if (migrate === true && options.legacyExists && home !== options.defaultHome) {
        log.info(`[first-run] 迁移旧数据: ${options.defaultHome} → ${home}`)
        await fs.cp(options.defaultHome, home, { recursive: true })
      }
    } catch (error) {
      log.error('[first-run] 目录准备/迁移失败:', error)
      return { ok: false, error: `目录不可用：${error instanceof Error ? error.message : String(error)}` }
    }
    done({ home, migrate: migrate === true })
    win.destroy()
    return { ok: true }
  })

  try {
    const promise = new Promise<FirstRunChoice | null>((resolvePromise) => {
      resolveChoice = resolvePromise
    })
    await win.loadFile(join(__dirname, 'web', 'first-run.html'))
    return await promise
  } catch (error) {
    // 页面加载失败（异常场景）：降级为默认目录，不阻塞启动。
    log.error('[first-run] 首启窗口加载失败，降级为默认目录:', error)
    done(null)
    return null
  } finally {
    for (const channel of [IPC_GET_STATE, IPC_BROWSE, IPC_CONFIRM]) ipcMain.removeHandler(channel)
    if (!win.isDestroyed()) win.destroy()
  }
}
