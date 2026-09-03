/**
 * dsh-desktop 桌面图标主题服务（图标主题 / 颜色主题拆分 · 图标侧）。
 *
 * 主题包（resources/themes/<id>/）承载外观资产；本服务只管**图标主题**
 * 这一独立设置项（包内 app/tray × light/dark 图标四件套）。颜色主题
 * （界面配色体系）是另一个独立设置项（settings `desktop.colorThemeId`），
 * 后续版本单独实现，与图标主题互不约束——两者可任意组合。
 *
 * 职责：
 *   - 主题包清单扫描：dist/resources/themes/ 下逐目录读 theme.json（zod 校验，损坏跳过）
 *   - 激活图标主题：真源 = host settings 的 `desktop` namespace `iconThemeId`
 *     （旧 key `themeId` 自动迁移读取）；settings/document-updated 直订阅联动
 *     （theme-sync 同款模式），变更时回调 onChanged → main.ts 刷新窗口/托盘图标
 *   - 图标路径解析：getActiveIconPath(kind, dark) 同步返回激活主题图标路径，
 *     文件缺失逐级回退（主题另一色版 → 内置 web 默认图标）
 *   - bridge 方法：desktop.iconTheme.list（清单+当前）/ desktop.iconTheme.set
 *     （zod 校验 + ctx.desktop.writeConfig 持久化 + 审计，事件联动自动生效）
 *
 * 安装时序：bootstrap 步骤 4.7（建窗前 await ready，首帧图标即正确主题）；
 * bridge 方法注册在步骤 8（依赖 desktopCore 写配置）。
 */

import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { log } from './log.js'
import { registerMethod, unregisterMethod } from './bridge.js'
import {
  iconThemeSetSchema,
  themeManifestSchema,
  type DesktopCore,
  type ThemeManifest,
  type IconThemeSetResult,
} from '../types/desktop.js'

/** 缺省图标主题 ID（settings 未设置/值非法时回退）。 */
export const DEFAULT_THEME_ID = 'default'

/** 主题包目录内图标文件名约定。 */
const ICON_FILES = {
  app: { light: 'app-icon-light.png', dark: 'app-icon-dark.png' },
  tray: { light: 'tray-icon-light.png', dark: 'tray-icon-dark.png' },
} as const

/** 图标种类（app=窗口/任务栏/Dock，tray=系统托盘）。 */
export type ThemeIconKind = keyof typeof ICON_FILES

/** 已扫描主题条目：清单 + 主题目录绝对路径。 */
interface ThemeEntry {
  manifest: ThemeManifest
  dir: string
}

// ── 模块级激活状态（main.ts / desktop-tray.ts / dsh-ui-protocol.ts 同步读取）────

/** 已扫描主题表（id → 条目）。 */
const themes = new Map<string, ThemeEntry>()
/** 当前激活主题 ID（ready 后有效；回退查询直接走默认图标）。 */
let activeThemeId: string = DEFAULT_THEME_ID
/** 激活主题变更回调（installDesktopTheme 注入；同步切换路径与事件回流共用）。 */
let onThemeChanged: (() => void) | null = null

/** 主题资源根目录（__dirname = dist/desktop-host → dist/resources/themes）。 */
function resolveThemesRoot(): string {
  return join(__dirname, '..', 'resources', 'themes')
}

/** 内置默认图标路径（回退终点：官方 harness logo 黑白双版）。 */
function resolveDefaultIconPath(kind: ThemeIconKind, dark: boolean): string {
  return join(__dirname, '..', 'desktop-shell', 'web', dark ? ICON_FILES[kind].dark : ICON_FILES[kind].light)
}

/**
 * 当前激活图标主题 ID（dsh-ui:// 协议 `/theme/current/icons/<file>` 路由
 * 解析用：URL 恒定，协议层按此动态映射激活主题的资源文件）。
 */
export function getActiveThemeId(): string {
  return activeThemeId
}

/**
 * 解析指定主题下图标路径（含回退：色版缺失 → 另一色版 → null 交由调用方回默认）。
 */
function resolveThemeIconPath(entry: ThemeEntry, kind: ThemeIconKind, dark: boolean): string | null {
  const preferred = join(entry.dir, dark ? ICON_FILES[kind].dark : ICON_FILES[kind].light)
  if (existsSync(preferred)) return preferred
  const alternate = join(entry.dir, dark ? ICON_FILES[kind].light : ICON_FILES[kind].dark)
  if (existsSync(alternate)) return alternate
  return null
}

/**
 * 解析当前激活主题的图标绝对路径（同步；main.ts loadAppIcon / desktop-tray
 * loadTrayIcon 调用）。回退链：主题色版 → 主题另一色版 → 内置 web 默认图标。
 */
export function getActiveIconPath(kind: ThemeIconKind, dark: boolean): string {
  const entry = themes.get(activeThemeId)
  if (entry !== undefined) {
    const resolved = resolveThemeIconPath(entry, kind, dark)
    if (resolved !== null) return resolved
    log.warn(`[dsh-theme] 主题 ${activeThemeId} 缺少 ${kind} 图标，回退默认图标`)
  }
  return resolveDefaultIconPath(kind, dark)
}

/**
 * 扫描主题资源目录（zod 校验清单；目录名与 manifest.id 不一致以目录名为准）。
 * 结果写入模块级主题表（覆盖式刷新，支持运行期新增主题包后被 list 读到）。
 */
async function scanThemes(): Promise<void> {
  const root = resolveThemesRoot()
  const scanned = new Map<string, ThemeEntry>()
  try {
    const dirents = await readdir(root, { withFileTypes: true })
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue
      try {
        const dir = join(root, dirent.name)
        const raw = JSON.parse(await readFile(join(dir, 'theme.json'), 'utf-8')) as unknown
        const manifest = themeManifestSchema.parse(raw)
        scanned.set(dirent.name, { manifest: { ...manifest, id: dirent.name }, dir })
      } catch (error) {
        // 单个主题包损坏不影响其余主题（清单缺失/字段非法/JSON 坏）
        log.warn(`[dsh-theme] 主题包 ${dirent.name} 清单无效，已跳过:`, error)
      }
    }
  } catch (error) {
    log.warn('[dsh-theme] 主题目录扫描失败（保留现有清单）:', error)
  }
  if (scanned.size > 0) {
    themes.clear()
    for (const [id, entry] of scanned) themes.set(id, entry)
  }
}

/** settings.describe 返回值的最小面（仅取所需字段，theme-sync 同款）。 */
interface SettingsDescribeView {
  namespaces?: Array<{ ns?: string; value?: unknown }>
}

/**
 * 从 host settings 读激活图标主题 ID（`desktop` namespace `iconThemeId`；
 * 旧 key `themeId` 自动迁移读取；未设置/不在清单中回退 default）。
 */
async function readActiveThemeId(callApi: (method: string, params: unknown) => Promise<unknown>): Promise<string> {
  const describe = (await callApi('settings.describe', {})) as SettingsDescribeView
  const namespace = describe?.namespaces?.find((entry) => entry.ns === 'desktop')
  const value = namespace?.value as Record<string, unknown> | undefined
  const iconThemeId = value?.iconThemeId ?? value?.themeId
  if (typeof iconThemeId === 'string' && themes.has(iconThemeId)) return iconThemeId
  return DEFAULT_THEME_ID
}

/**
 * 应用激活主题 ID（同步生效：模块状态 + 变更回调一起走）。
 *
 * 两条路径共用本函数，保证单一状态出口：
 *   - handleSet（用户切换）：同步应用，renderer 刷新事件到达时协议层映射已是新主题
 *     ——消除「事件先到、状态后切」的竞态窗口；
 *   - sync（settings/document-updated 回流）：值相同则 no-op（handleSet 已同步应用，
 *     回流不会重复触发 onChanged，无反馈循环）。
 */
function applyActiveThemeId(next: string): boolean {
  if (next === activeThemeId) return false
  activeThemeId = next
  log.info(`[dsh-theme] 激活图标主题: ${next}`)
  onThemeChanged?.()
  return true
}

/** 主题服务安装选项。 */
export interface DesktopThemeOptions {
  /** 统一 host RPC 调用入口（main.ts callApi）。 */
  callApi(method: string, params: unknown): Promise<unknown>
  /** 0.1.2 Cordis Host 上下文（settings/document-updated 直订阅）。 */
  hostCtx: {
    on(event: 'settings/document-updated', listener: (ns: string, revision: number) => void): () => boolean
  }
  /** 激活图标主题变更回调（main.ts → refreshAppIcons 刷新窗口/任务栏/Dock/托盘）。 */
  onChanged?: () => void
}

/** 主题服务句柄（退出前 stop：解除订阅 + 注销 bridge 方法）。 */
export interface DesktopThemeHandle {
  /** 初始扫描+同步完成信号（建窗前 await，保证首帧图标即正确主题）。 */
  ready: Promise<void>
  stop(): void
}

/**
 * 安装图标主题服务：扫描清单 → 读激活主题 → 订阅 settings 变更联动。
 *
 * @param options 安装选项。
 * @returns 句柄（app 退出前 stop）。
 */
export function installDesktopTheme(options: DesktopThemeOptions): DesktopThemeHandle {
  let stopped = false
  let lastEventRevision = -1
  onThemeChanged = options.onChanged ?? null

  /** 重读激活图标主题（settings 回流路径；值相同 no-op，见 applyActiveThemeId）。 */
  const sync = async (): Promise<void> => {
    const next = await readActiveThemeId(options.callApi)
    applyActiveThemeId(next)
  }

  const ready = (async () => {
    await scanThemes()
    log.info(`[dsh-theme] 主题包清单扫描完成: [${[...themes.keys()].join(', ')}]`)
    try {
      applyActiveThemeId(await readActiveThemeId(options.callApi))
      log.info(`[dsh-theme] 启动期激活主题就绪: ${activeThemeId}`)
    } catch (error) {
      log.warn('[dsh-theme] 读取图标主题偏好失败，使用默认主题:', error)
    }
  })()

  const offSettings = options.hostCtx.on('settings/document-updated', (_ns, revision) => {
    if (stopped || revision === lastEventRevision) return
    lastEventRevision = revision
    void sync().catch((error) => log.warn('[dsh-theme] 图标主题联动失败:', error))
  })

  return {
    ready,
    stop: (): void => {
      stopped = true
      offSettings()
      onThemeChanged = null
      unregisterMethod('desktop.iconTheme.list')
      unregisterMethod('desktop.iconTheme.set')
    },
  }
}

/**
 * 注册图标主题 bridge 方法（步骤 8 desktopCore 就绪后调用；与 autostart 模式一致：
 * 真源主进程侧，写 settings 经事件联动自动生效）。颜色主题（colorThemeId）为
 * 独立设置项，后续版本单独注册 desktop.colorTheme.* 方法，互不复用。
 *
 * @param desktop `ctx.desktop` 聚合服务（writeConfig 持久化 + 审计）。
 */
export function registerDesktopThemeMethods(desktop: DesktopCore): void {
  /** 图标主题清单查询（扫描结果 + 当前激活标记）。 */
  const handleList = (): { themes: Array<ThemeManifest & { current: boolean }>; current: string } => {
    const list = [...themes.entries()].map(([id, entry]) => ({
      ...entry.manifest,
      id,
      current: id === activeThemeId,
    }))
    return { themes: list, current: activeThemeId }
  }

  /** 图标主题切换（zod 校验 → 同步应用 → 持久化 → 通知 renderer 刷新 UI 图标）。 */
  const handleSet = (params: unknown): IconThemeSetResult => {
    const parsed = iconThemeSetSchema.parse(params)
    if (!themes.has(parsed.id)) {
      return { ok: false, message: `图标主题不存在: ${parsed.id}` }
    }
    // 同步应用先行：协议层 current 映射与窗口/托盘图标立即切到新主题，
    // renderer 收到下行事件时拉到的已是新资源（无「事件先到、状态后切」竞态）。
    applyActiveThemeId(parsed.id)
    // settings 持久化（真源）+ 事件回流：readActiveThemeId 返回同值，sync no-op。
    desktop.writeConfig('iconThemeId', parsed.id)
    // 下行通知各窗口的桌面 UI 组件（标题栏 logo / 图标覆盖层）即时刷新。
    desktop.sendDesktopEvent({ action: 'theme.icon-change', payload: { iconThemeId: parsed.id } })
    desktop.emitAction('theme.icon-change', { iconThemeId: parsed.id })
    log.info(`[dsh-theme] 图标主题切换请求: ${parsed.id}`)
    return { ok: true, current: parsed.id }
  }

  registerMethod('desktop.iconTheme.list', async () => handleList())
  registerMethod('desktop.iconTheme.set', async (params: unknown) => handleSet(params))
  log.ok('[dsh-theme] 图标主题 bridge 方法已注册（desktop.iconTheme.list/set）')
}
