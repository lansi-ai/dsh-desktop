/**
 * dsh-desktop 主题联动（M3-b4 dogfood 主题体验收口）。
 *
 * 官方 Web UI 的主题偏好持久化在 Host settings 的 `ui-theme` namespace
 * （`preference` 字段：light/dark/system，默认 system，dsh-client-ui-theme 注册）。
 * Electron 原生面（标题栏 caption 按钮、原生右键菜单、renderer 的
 * prefers-color-scheme）由 nativeTheme 决定，默认跟随 OS——与应用内主题设置
 * 是两套系统。本模块把两者接通：
 *   1. 启动期经 `settings.describe` 读 ui-theme.preference → `nativeTheme.themeSource`；
 *   2. 订阅 apiProxy mux 流的 `settings/document-updated`（官方转发事件逐字语义）
 *      → 偏好变更时重新同步；
 *   3. nativeTheme 变化回调 `onNativeThemeChanged`（窗口/托盘黑白双版图标切换用）。
 *
 * 注意：只同步「偏好值」而非解析后的深浅色——system 态必须传 'system'，
 * 让 nativeTheme 继续跟随 OS；否则反馈回路会把 system 态钉死在当前色。
 */

import { nativeTheme } from 'electron'

/** 主题同步选项。 */
export interface ThemeSyncOptions {
  /** 统一 host RPC 调用入口（main.ts callApi）。 */
  callApi(method: string, params: unknown): Promise<unknown>
  /** host apiProxy 事件流（订阅 mux + host 帧监听 settings 更新）。 */
  events: {
    mux(request: unknown, signal: AbortSignal): AsyncIterable<{ rpcId: string; payload: unknown }>
    host(request: unknown, signal: AbortSignal): AsyncIterable<{ rpcId: string; payload: unknown }>
  }
  /** nativeTheme 变化回调（参数 = 当前应为深色图标形态）。 */
  onNativeThemeChanged?(dark: boolean): void
}

/** 主题同步句柄（退出前调用 stop 释放订阅）。 */
export interface ThemeSyncHandle {
  /** 初始同步完成信号（建窗前 await，保证首帧即正确主题）。 */
  ready: Promise<void>
  stop(): void
}

/** 官方主题偏好（与 dsh-client-ui-theme THEME_PREFERENCES 对齐）。 */
type ThemePreference = 'light' | 'dark' | 'system'
/** 官方主题偏好合法值。 */
const THEME_PREFERENCES = new Set<string>(['light', 'dark', 'system'])
/** 主题插件拥有的 settings namespace。 */
const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** settings.describe 返回值的最小面（仅取所需字段）。 */
interface SettingsDescribeView {
  namespaces?: Array<{ ns?: string; value?: unknown }>
}

/**
 * 读 ui-theme namespace 的主题偏好。
 * @param callApi RPC 入口。
 * @returns 偏好值；读不到/非法时回退 'system'。
 */
async function readThemePreference(callApi: ThemeSyncOptions['callApi']): Promise<ThemePreference> {
  const describe = (await callApi('settings.describe', {})) as SettingsDescribeView
  const namespace = describe?.namespaces?.find((entry) => entry.ns === THEME_SETTINGS_NAMESPACE)
  const preference = (namespace?.value as { preference?: unknown } | undefined)?.preference
  return typeof preference === 'string' && THEME_PREFERENCES.has(preference) ? (preference as ThemePreference) : 'system'
}

/**
 * 安装主题联动：读偏好 → 同步 nativeTheme.themeSource，并订阅后续变更。
 * @param options 同步选项。
 * @returns 句柄（app 退出前 stop）。
 */
export function installThemeSync(options: ThemeSyncOptions): ThemeSyncHandle {
  const ac = new AbortController()

  // 同步偏好 → nativeTheme.themeSource（system 态直传，保留 OS 跟随）。
  const sync = async (): Promise<void> => {
    try {
      const preference = await readThemePreference(options.callApi)
      nativeTheme.themeSource = preference
      console.log(`[dsh-theme] nativeTheme.themeSource 已同步: ${preference}`)
    } catch (error) {
      console.warn('[dsh-theme] 读取 ui-theme 偏好失败，保持默认跟随 OS:', error)
    }
  }
  const ready = sync()

  // 订阅 mux + host 帧：settings/document-updated → 重新读偏好（settings 写入都会发此事件，
  // 重新 describe 一次代价可忽略，且免依赖帧内 ns 参数形态）。
  // 注意：settings/document-updated 可能在 host 流（Host 级事件）或 mux 流中，双路订阅确保不漏。
  const createPump = (stream: AsyncIterable<{ rpcId: string; payload: unknown }>): (() => void) => {
    let stopped = false
    const pump = async (): Promise<void> => {
      try {
        for await (const envelope of stream) {
          if (stopped) break
          const frame = envelope.payload as { type?: unknown } | null
          if (frame !== null && frame.type === 'settings/document-updated') {
            console.log('[dsh-theme] 收到 settings/document-updated，重新同步主题偏好')
            await sync()
          }
        }
      } catch {
        // 流关闭（应用退出）——保持静默。
      }
    }
    void pump()
    return () => { stopped = true }
  }
  const stopMux = createPump(options.events.mux({}, ac.signal))
  const stopHost = createPump(options.events.host({}, ac.signal))

  // nativeTheme 变化 → 图标形态回调（themeSource 同步与 OS 切换都会触发）。
  const onThemeUpdated = (): void => {
    options.onNativeThemeChanged?.(nativeTheme.shouldUseDarkColors)
  }
  nativeTheme.on('updated', onThemeUpdated)

  return {
    ready,
    stop: (): void => {
      ac.abort()
      stopMux()
      stopHost()
      nativeTheme.removeListener('updated', onThemeUpdated)
    },
  }
}
