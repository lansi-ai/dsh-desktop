/**
 * dsh-desktop 开机自启服务（M3-b3 autostart）。
 *
 * 职责：
 *   - 管理系统登录项（app.setLoginItemSettings），OS 登录项为唯一真源
 *   - 注册 bridge 方法：desktop.autostart.setEnabled / desktop.autostart.getStatus
 *   - 开启时附带 --hidden 启动参数（登录后静默驻留托盘，不弹主窗口）
 *   - 开发模式（electron.exe 未打包）拦截注册表写入，仅警告提示
 */

import { app } from 'electron'
import type { DesktopCore, AutostartStatus } from '../types/desktop.js'
import { autostartSetEnabledSchema } from '../types/desktop.js'
import { registerMethod, unregisterMethod } from './bridge.js'

/** 登录启动时附带的参数（main.ts 识别后跳过窗口显示，静默驻留托盘）。 */
export const AUTOSTART_HIDDEN_ARG = '--hidden'

/** 开机自启安装选项。 */
export interface DesktopAutostartOptions {
  /** `ctx.desktop` 聚合服务（审计）。 */
  desktop: DesktopCore
}

/** 读取当前平台是否支持登录项（Windows 注册表 / macOS LoginItems）。 */
function isPlatformSupported(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin'
}

/** 开发模式判定：未打包（electron.exe 直接运行）时写登录项无意义且会残留。 */
function isDevMode(): boolean {
  return !app.isPackaged
}

/** 读取 OS 登录项当前状态（实时读取，作为唯一真源）。 */
function readStatus(): AutostartStatus {
  const supported = isPlatformSupported()
  const enabled = supported && app.getLoginItemSettings().openAtLogin
  return { enabled, supported, devMode: isDevMode() }
}

/**
 * 写入 OS 登录项（仅打包版；开启时附带 --hidden 实现静默到托盘）。
 *
 * @returns 写入后的状态（失败/拦截时 message 携带原因）。
 */
function applyLoginItem(enabled: boolean): AutostartStatus {
  // Windows：注册表 Run 项追加命令行参数；macOS：经默认登录项服务注册
  // （当前 Electron 类型已移除 openAsHidden，隐藏启动统一由 --hidden 参数承载）。
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: enabled ? [AUTOSTART_HIDDEN_ARG] : [],
  })
  return readStatus()
}

/**
 * 安装开机自启服务（注册 bridge 方法）。
 *
 * @param options 安装选项。
 * @returns 清理函数（注销 bridge 方法）。
 */
export function installDesktopAutostart(
  options: DesktopAutostartOptions,
): () => void {
  const { desktop } = options

  /** 开机自启设置请求（renderer → host）。 */
  const handleSetEnabled = (params: unknown): AutostartStatus => {
    const parsed = autostartSetEnabledSchema.parse(params)
    if (!isPlatformSupported()) {
      desktop.log('autostart.setBlocked', { reason: 'unsupported-platform', enabled: parsed.enabled })
      return { ...readStatus(), message: '当前平台不支持开机自启' }
    }
    if (isDevMode()) {
      console.warn('[dsh-autostart] 开发模式下不写入系统登录项（仅打包版生效）')
      desktop.log('autostart.setBlocked', { reason: 'dev-mode', enabled: parsed.enabled })
      return { ...readStatus(), message: '开发模式下不注册，仅打包版生效' }
    }
    const status = applyLoginItem(parsed.enabled)
    desktop.emitAction('autostart.change', { enabled: status.enabled })
    console.log(`[dsh-autostart] 开机自启已${status.enabled ? '启用' : '停用'}`)
    return status
  }

  /** 开机自启状态查询（OS 登录项实时读取）。 */
  const handleGetStatus = (): AutostartStatus => readStatus()

  registerMethod('desktop.autostart.setEnabled', handleSetEnabled)
  registerMethod('desktop.autostart.getStatus', handleGetStatus)

  console.log('[dsh-autostart] 开机自启服务已安装')

  return () => {
    unregisterMethod('desktop.autostart.setEnabled')
    unregisterMethod('desktop.autostart.getStatus')
    console.log('[dsh-autostart] 开机自启服务已清理')
  }
}
