/**
 * 启动早期同步应用持久化的主题偏好（ui-theme.preference → nativeTheme.themeSource）。
 *
 * 背景：theme-sync.ts 要等 host 装配后才经 settings.describe（RPC）读取 ui-theme
 * 偏好，而闪屏创建早于 host 装配，首帧只能按系统明暗（themeSource 默认 'system'）
 * 渲染——当系统为深色、应用主题为浅色时，裸屏会以深色显示，与主窗口/应用主题
 * 不一致。
 *
 * 此处借 ensureDataHome() 已设置 DSH_HOME 的时序契约，用 Node fs + yaml 在闪屏
 * 创建前同步读取 settings.yaml 的 ui-theme.preference，提前设 themeSource，使闪屏
 * 首帧即匹配应用主题。读不到/非法值一律静默回退（保持默认跟随 OS），由 theme-sync
 * 的晚同步兜底；两者幂等，无竞争副作用。
 */

import { nativeTheme } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

import { log } from '../forge-host/log.js'

/** ui-theme.preference 合法值（与官方 dsh-client-ui-theme THEME_PREFERENCES 对齐）。 */
type ThemePreference = 'light' | 'dark' | 'system'
const THEME_PREFERENCES = new Set<string>(['light', 'dark', 'system'])

/**
 * 闪屏创建前调用：从 `<home>/settings.yaml` 读取 ui-theme.preference 并提前设置
 * nativeTheme.themeSource。文档缺失（ENOENT）时静默，其余读取异常仅告警；非法
 * 偏好值直接忽略——两种情况都保持默认，由 theme-sync 晚同步兜底。
 * @param home harness home；缺省回退 process.env.DSH_HOME。
 */
export function applyPersistedThemeSource(home: string | undefined): void {
  const dir = home ?? process.env.DSH_HOME
  if (!dir) return
  let preference: unknown
  try {
    const document = parse(readFileSync(join(dir, 'settings.yaml'), 'utf8')) as
      | { 'ui-theme'?: { preference?: unknown } }
      | undefined
    preference = document?.['ui-theme']?.preference
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('[dsh-theme] 启动早期读取 ui-theme 偏好失败，保持默认跟随 OS:', error)
    }
    return
  }
  if (typeof preference === 'string' && THEME_PREFERENCES.has(preference)) {
    nativeTheme.themeSource = preference as ThemePreference
    log.info(`[dsh-theme] 启动早期已同步主题偏好: ${preference}`)
  }
}