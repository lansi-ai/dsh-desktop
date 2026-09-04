/**
 * dsh-desktop 桌面图标主题服务（图标主题 / 颜色主题拆分 · 图标侧）。
 *
 * 图标分两类归属，互不牵连：
 *   - **全局图标**（`scope='global'`）：应用图标（窗口/任务栏/Dock）、托盘图标、
 *     标题栏品牌 logo —— 存包外 `userData/icons/` 只有一份，**切换图标包不影响**
 *     （它们是「这个应用长什么样」的身份标识，不属于任何图标包）；
 *   - **图标包**（`scope='pack'`）：界面图标（设置导航、窗控、折叠钮）—— 存
 *     `resources/themes/<id>/icons/`（内置包）或 `userData/themes/<id>/icons/`
 *     （用户包），随激活包切换。
 * 颜色主题（界面配色体系）是第三个独立设置项（settings `desktop.colorThemeId`），
 * 后续版本单独实现，与上述两者互不约束——可任意组合。
 *
 * 职责：
 *   - 主题包清单扫描：内置包（dist/resources/themes/）+ 用户包（userData/themes/，
 *     同名覆盖内置，允许就地定制内置包）；逐目录读 theme.json（zod 校验，损坏跳过）
 *   - 激活图标主题：真源 = host settings 的 `desktop` namespace `iconThemeId`
 *     （旧 key `themeId` 自动迁移读取）；settings/document-updated 直订阅联动
 *     （theme-sync 同款模式），变更时回调 onChanged 供 main.ts 重读图标
 *   - 图标槽位注册表（`ICON_SLOTS` · 单一真源）：声明系统与各自研插件消费的
 *     图标位（含 scope/group/plugin/规范文件名/格式/建议尺寸/缺失回退说明）；
 *     设置页「外观」据此展示需求清单并提供槽位行内上传
 *   - 全局图标迁移：ready 阶段把旧版存在包根的 app/tray PNG 一次性搬到
 *     userData/icons（全局已有不覆盖；品牌 logo 不迁，避免改变既有外观）
 *   - 图标路径解析：getActiveIconPath(kind, dark) 同步返回**全局目录**图标路径，
 *     文件缺失逐级回退（全局另一色版 → 内置 web 默认图标）
 *   - bridge 方法：list（清单+当前+槽位状态+激活包写入目录+全局图标目录）/ set
 *     （zod 校验 + ctx.desktop.writeConfig 持久化 + 审计，事件联动自动生效）/
 *     create（用户目录建空包并激活）/ upload（槽位驱动按 scope 分流：global 写
 *     userData/icons，pack 写当前激活包——内置包 asar 只读时先克隆到本地同名包）
 *
 * 安装时序：bootstrap 步骤 4.7（建窗前 await ready，首帧图标即正确主题）；
 * bridge 方法注册在步骤 8（依赖 desktopCore 写配置）。
 */

import { cp, readdir, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, basename, normalize, sep } from 'node:path'
import { app, dialog } from 'electron'

import { log } from './log.js'
import { registerMethod, unregisterMethod } from './bridge.js'
import {
  iconThemeSetSchema,
  iconThemeUploadSchema,
  iconThemeCreateSchema,
  themeManifestSchema,
  type DesktopCore,
  type ThemeManifest,
  type IconSlot,
  type IconSlotStatus,
  type IconThemeListResult,
  type IconThemeSetResult,
  type IconThemeUploadResult,
  type IconThemeCreateResult,
} from '../types/desktop.js'

/** 缺省图标主题 ID（settings 未设置/值非法时回退）。 */
export const DEFAULT_THEME_ID = 'default'

/** 图标文件名约定（全局图标目录 userData/icons 下的 app/tray 四件套）。 */
const ICON_FILES = {
  app: { light: 'app-icon-light.png', dark: 'app-icon-dark.png' },
  tray: { light: 'tray-icon-light.png', dark: 'tray-icon-dark.png' },
} as const

/** 图标种类（app=窗口/任务栏/Dock，tray=系统托盘）。 */
export type ThemeIconKind = keyof typeof ICON_FILES

/**
 * 图标槽位注册表（**单一真源**：桌面侧系统/自研插件消费的图标需求）。
 *
 * 设置页「外观」的图标清单、上传落盘路径、缺失回退说明全部由此派生；
 * 新增消费点（新插件按 `icons/<名>.svg` 取图）时必须在此登记，否则设置页
 * 看不见该需求。`group`（用途域）+ `plugin`（取用方插件/模块）共同回答
 * 「这个图标位归谁用」。两类归属（`scope`，见 `GLOBAL_SLOT_IDS`）：
 *   - `global`=应用/托盘图标 + 标题栏品牌 logo —— 存 `userData/icons/` 全局单份，
 *     **不随图标包切换**（它们是应用身份标识，不属于任何一个图标包）；
 *   - `pack`=界面图标（设置导航、窗控、折叠钮、工作区侧栏）—— 存激活包 `icons/` 子目录，
 *     随图标包切换，经 `dsh-ui://app/theme/current/icons/<文件名>` 引用。
 * `format: 'svg'` 走内联上色（单色线条稿随明暗自适应，见
 * @lansi-ai/dsh-desktop-icons）；`format: 'png'` 原色呈现。
 */
const RAW_ICON_SLOTS: readonly Omit<IconSlot, 'scope'>[] = [
  {
    id: 'app-icon-light',
    label: '应用图标（浅色底）',
    group: '应用图标',
    plugin: 'desktop-host（main.ts / desktop-tray.ts）',
    file: ICON_FILES.app.light,
    format: 'png',
    size: 512,
    fallback: '回退全局深色版，再回退内置默认 logo',
  },
  {
    id: 'app-icon-dark',
    label: '应用图标（深色底）',
    group: '应用图标',
    plugin: 'desktop-host（main.ts / desktop-tray.ts）',
    file: ICON_FILES.app.dark,
    format: 'png',
    size: 512,
    fallback: '回退全局浅色版，再回退内置默认 logo',
  },
  {
    id: 'tray-icon-light',
    label: '托盘图标（浅色底）',
    group: '托盘图标',
    plugin: 'desktop-host（desktop-tray.ts）',
    file: ICON_FILES.tray.light,
    format: 'png',
    size: 64,
    fallback: '回退全局深色版，再回退内置默认 logo',
  },
  {
    id: 'tray-icon-dark',
    label: '托盘图标（深色底）',
    group: '托盘图标',
    plugin: 'desktop-host（desktop-tray.ts）',
    file: ICON_FILES.tray.dark,
    format: 'png',
    size: 64,
    fallback: '回退全局浅色版，再回退内置默认 logo',
  },
  {
    id: 'titlebar-logo',
    label: '标题栏品牌 logo',
    group: '品牌 logo',
    plugin: '@lansi-ai/dsh-desktop-titlebar',
    file: 'titlebar-logo.svg',
    format: 'svg',
    size: 24,
    fallback: '回退官方品牌图标',
  },
  {
    id: 'titlebar-minimize',
    label: '窗控「最小化」图标',
    group: '标题栏',
    plugin: '@lansi-ai/dsh-desktop-titlebar',
    file: 'icons/titlebar-minimize.svg',
    format: 'svg',
    size: 16,
    fallback: '回退内置 Fluent 图形；单色描边稿随明暗，建议留白少',
  },
  {
    id: 'titlebar-maximize',
    label: '窗控「最大化」图标',
    group: '标题栏',
    plugin: '@lansi-ai/dsh-desktop-titlebar',
    file: 'icons/titlebar-maximize.svg',
    format: 'svg',
    size: 16,
    fallback: '与 titlebar-restore **成对提供才生效**；缺一整套回退内置',
  },
  {
    id: 'titlebar-restore',
    label: '窗控「还原」图标（最大化态下显示）',
    group: '标题栏',
    plugin: '@lansi-ai/dsh-desktop-titlebar',
    file: 'icons/titlebar-restore.svg',
    format: 'svg',
    size: 16,
    fallback: '与 titlebar-maximize **成对提供才生效**；缺一整套回退内置',
  },
  {
    id: 'titlebar-close',
    label: '窗控「关闭」图标',
    group: '标题栏',
    plugin: '@lansi-ai/dsh-desktop-titlebar',
    file: 'icons/titlebar-close.svg',
    format: 'svg',
    size: 16,
    fallback: '回退内置 ✕；hover 是红底白图（走 currentColor），**务必用单色稿**',
  },
  {
    id: 'titlebar-collapse-left',
    label: '侧栏折叠图标（展开态，箭头朝左）',
    group: '标题栏',
    plugin: '@lansi-ai/dsh-desktop-titlebar',
    file: 'icons/titlebar-collapse-left.svg',
    format: 'svg',
    size: 13,
    fallback: '与 titlebar-collapse-right **成对提供才生效**；缺一整套回退内置',
  },
  {
    id: 'titlebar-collapse-right',
    label: '侧栏折叠图标（收起态，箭头朝右）',
    group: '标题栏',
    plugin: '@lansi-ai/dsh-desktop-titlebar',
    file: 'icons/titlebar-collapse-right.svg',
    format: 'svg',
    size: 13,
    fallback: '与 titlebar-collapse-left **成对提供才生效**；缺一整套回退内置',
  },
  {
    id: 'settings-trigger',
    label: '侧栏「设置」入口图标',
    group: '设置面板',
    plugin: '@lansi-ai/dsh-desktop-settings-shell',
    file: 'icons/settings-trigger.svg',
    format: 'svg',
    size: 16,
    fallback: '回退官方齿轮图标',
  },
  ...([
    ['general', '通用设置'],
    ['desktop', '桌面'],
    ['models', '模型'],
    ['appearance', '外观'],
    ['plugins', '插件'],
    ['about', '关于'],
    ['agent-presets', 'Agent 预设'],
  ] as const).map(([sectionId, label]) => ({
    id: `settings-nav-${sectionId}`,
    label: `设置导航「${label}」图标`,
    group: '设置面板',
    plugin: '@lansi-ai/dsh-desktop-settings-shell',
    file: `icons/settings-nav-${sectionId}.svg`,
    format: 'svg' as const,
    size: 16,
    fallback: '回退官方同位图标',
  })),
  // 官方 ui-workspace 内联图标（工作区侧栏）：编译进官方 bundle 的 React 内联 SVG，
  // 无独立资源可换，唯一途径 = ui-icons 覆盖层。match 为官方 svg 首个 path 的 d
  // 前缀特征（实机探测自 dsh-web-frontend dist @0.1.2-rc.1；上游升级可能改变特征，
  // 失效时重新探测并更新此处）。上传时主进程自动把规则并进包内 ui-overrides.json。
  ...([
    {
      id: 'ui-workspace-search',
      label: '工作区「搜索」图标',
      file: 'icons/ui-workspace-search.svg',
      match: ['M11.894845 6.647401C11.894845 3.725463'],
    },
    {
      id: 'ui-workspace-view',
      label: '工作区「视图选项」（分组/排序）图标',
      file: 'icons/ui-workspace-view.svg',
      match: ['M10.3232 9.18164C11.2868 9.18164'],
    },
    {
      id: 'ui-workspace-add',
      label: '工作区「新建」图标',
      file: 'icons/ui-workspace-add.svg',
      match: ['M3.55246 0L3.55246 2.44252L6 2.44252'],
    },
    {
      id: 'ui-workspace-folder',
      label: '工作区文件夹图标（收起/展开两态共用）',
      file: 'icons/ui-workspace-folder.svg',
      // 收起 IconFolderClose16 + 展开 IconFolderOpen16 两条特征（后者同 d 的
      // IconFolderOpenOutline16 一并被覆盖，视觉同一）
      match: ['M5.05582 0.518756L4.50669 0.86654', 'M5.19629 1.57104C5.81144 1.5711'],
    },
  ].map((slot) => ({
    ...slot,
    group: '工作区侧栏',
    plugin: '官方 ui-workspace（@lansi-ai/dsh-desktop-ui-icons 覆盖层）',
    format: 'svg' as const,
    size: 16,
    fallback: '回退官方内联图标；替换经 ui-overrides.json（path 特征随官方升级可能失效）',
  }))),
]

/**
 * 全局归属的槽位 ID：应用/托盘图标与标题栏品牌 logo。
 * 它们是「这个应用长什么样」的身份标识，不属于任何一个图标包，故存包外的
 * `userData/icons/` 只有一份，切换图标包不影响（换包只换界面图标）。
 */
const GLOBAL_SLOT_IDS: readonly string[] = [
  'app-icon-light',
  'app-icon-dark',
  'tray-icon-light',
  'tray-icon-dark',
  'titlebar-logo',
]

/** 带归属范围的图标槽位（对外下发的最终形态）。 */
export const ICON_SLOTS: readonly IconSlot[] = RAW_ICON_SLOTS.map((slot) => ({
  ...slot,
  scope: GLOBAL_SLOT_IDS.includes(slot.id) ? 'global' as const : 'pack' as const,
}))

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

/** 用户主题根目录（userData/themes；上传图标/自定义包落盘处，可写）。 */
function resolveUserThemesRoot(): string {
  return join(app.getPath('userData'), 'themes')
}

/** 用户主题目录下指定 ID 的包路径（可写；新建包与内置包克隆的唯一落盘处）。 */
function resolveUserThemeDir(id: string): string {
  return join(resolveUserThemesRoot(), id)
}

/**
 * 判定主题目录是否位于可写的用户主题根目录下。
 * 内置包在 dist/resources/themes（打包后随 asar 只读）→ 对其「上传」须先整体
 * 克隆到用户目录同名包（扫描时用户包覆盖内置，激活 ID 不变而内容可就地替换）。
 */
function isUserThemeDir(dir: string): boolean {
  const root = normalize(resolveUserThemesRoot())
  const target = normalize(dir)
  return target === root || target.startsWith(root + sep)
}

/** 指定包的写入目录（用户包=其本身；内置包=用户目录同名克隆目标）。 */
function resolveWritableThemeDir(themeId: string): string {
  const entry = themes.get(themeId)
  if (entry !== undefined && isUserThemeDir(entry.dir)) return entry.dir
  return resolveUserThemeDir(themeId)
}

/**
 * 全局图标目录（userData/icons）：`scope='global'` 槽位（应用/托盘图标、标题栏
 * 品牌 logo）的唯一落盘处 —— 与图标包解耦，只有一份，切换图标包不影响。
 */
function resolveGlobalIconsDir(): string {
  return join(app.getPath('userData'), 'icons')
}

/**
 * 全局图标绝对路径（dsh-ui:// 协议 `/icons/<file>` 路由用；调用方自行判存在）。
 * 文件名走协议白名单字符集，越界名直接返回 null。
 */
export function resolveGlobalIconPath(fileName: string): string | null {
  if (!/^[a-z0-9_-]+\.(?:svg|png)$/.test(fileName)) return null
  return join(resolveGlobalIconsDir(), fileName)
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
 * 解析主题 ID → 主题目录绝对路径（dsh-ui:// 协议主题路由用；内置包与
 * 用户包统一经模块级主题表查找，未收录返回 null → 协议层 404）。
 */
export function resolveThemeDir(themeId: string): string | null {
  return themes.get(themeId)?.dir ?? null
}

/**
 * 扫描单个主题包的图标文件索引（相对包目录路径，供设置页卡片预览 + 插件侧
 * 图标名称索引）。**只覆盖 `icons/` 子目录**：应用/托盘 PNG 已改为全局归属
 * （userData/icons），不再是图标包的内容，包根即便残留也不计入。
 */
async function listThemeIcons(dir: string): Promise<string[]> {
  const icons: string[] = []
  const iconsDir = join(dir, 'icons')
  if (existsSync(iconsDir)) {
    for (const dirent of await readdir(iconsDir, { withFileTypes: true })) {
      if (dirent.isFile()) icons.push(`icons/${dirent.name}`)
    }
  }
  return icons.sort()
}

/**
 * 解析当前应用/托盘图标绝对路径（同步；main.ts loadAppIcon / desktop-tray
 * loadTrayIcon 调用）。**只认全局目录**（与图标包解耦）：
 * 全局色版 → 全局另一色版 → 内置 web 默认图标。
 */
export function getActiveIconPath(kind: ThemeIconKind, dark: boolean): string {
  const globalDir = resolveGlobalIconsDir()
  const preferred = join(globalDir, dark ? ICON_FILES[kind].dark : ICON_FILES[kind].light)
  if (existsSync(preferred)) return preferred
  const alternate = join(globalDir, dark ? ICON_FILES[kind].light : ICON_FILES[kind].dark)
  if (existsSync(alternate)) return alternate
  return resolveDefaultIconPath(kind, dark)
}

/**
 * 一次性迁移：把「包根 app/tray PNG」搬到全局目录（userData/icons）。
 *
 * 旧版本里应用/托盘图标存在图标包包根、随包切换；现在它们是全局单份、与包解耦。
 * 为避免升级后图标凭空变回内置默认，这里在 ready 阶段按「激活包优先、其余包次之」
 * 找到第一个提供该文件的包并复制过去；**全局已有的不覆盖**（用户自己传的就是真源）。
 * 品牌 logo 不迁：旧口径下 default 激活时本就不启用包内 logo，迁了反而会改变外观。
 */
async function migratePackIconsToGlobal(): Promise<void> {
  const globalDir = resolveGlobalIconsDir()
  const files = Object.values(ICON_FILES).flatMap((kind) => [kind.light, kind.dark])
  const order = [activeThemeId, ...themes.keys()]
  let migrated = 0
  for (const file of files) {
    if (existsSync(join(globalDir, file))) continue
    const source = order.map((id) => themes.get(id)).find((entry) => entry !== undefined && existsSync(join(entry.dir, file)))
    if (source === undefined) continue
    await mkdir(globalDir, { recursive: true })
    await copyFile(join(source.dir, file), join(globalDir, file))
    migrated += 1
  }
  if (migrated > 0) log.info(`[dsh-theme] 已把 ${migrated} 个包根应用/托盘图标迁移到全局目录: ${globalDir}`)
}

/**
 * 扫描单个根目录下的主题包清单（zod 校验；目录名与 manifest.id 不一致以目录名为准）。
 * 结果写入 provided 表（扫描失败只跳过该包，不影响其余）。
 */
async function scanThemesRoot(root: string, provided: Map<string, ThemeEntry>): Promise<void> {
  let dirents
  try {
    dirents = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue
    try {
      const dir = join(root, dirent.name)
      const raw = JSON.parse(await readFile(join(dir, 'theme.json'), 'utf-8')) as unknown
      const manifest = themeManifestSchema.parse(raw)
      provided.set(dirent.name, { manifest: { ...manifest, id: dirent.name }, dir })
    } catch (error) {
      // 单个主题包损坏不影响其余主题（清单缺失/字段非法/JSON 坏）
      log.warn(`[dsh-theme] 主题包 ${dirent.name} 清单无效，已跳过:`, error)
    }
  }
}

/**
 * 扫描主题资源目录：内置包（dist/resources/themes）+ 用户包（userData/themes）。
 * 用户包后扫描、同名覆盖内置（允许内置包的用户本地定制）。结果覆盖式刷新，
 * 支持运行期新增主题包/上传图标后被 list 读到。
 */
async function scanThemes(): Promise<void> {
  const scanned = new Map<string, ThemeEntry>()
  await scanThemesRoot(resolveThemesRoot(), scanned)
  await scanThemesRoot(resolveUserThemesRoot(), scanned)
  if (scanned.size > 0) {
    themes.clear()
    for (const [id, entry] of scanned) themes.set(id, entry)
  }
}

/**
 * 槽位提供情况（按各自 `scope` 取归属目录：global=userData/icons，pack=指定主题包；
 * 目录未知时判缺失）。设置页据此把「系统/插件需要什么」与「已经有什么」对齐，
 * 缺失项给出行内上传入口。
 *
 * 注：**空文件等同未提供**——0 字节占位协议层照样 200，但 renderer 解析不出内容
 * 会静默回退；只判 existsSync 会把这种缺口藏进「已提供」。
 */
function listSlotStatus(themeDir: string | undefined): IconSlotStatus[] {
  const globalDir = resolveGlobalIconsDir()
  return ICON_SLOTS.map((slot) => {
    const dir = slot.scope === 'global' ? globalDir : themeDir
    let provided = false
    if (dir !== undefined) {
      const file = join(dir, slot.file)
      provided = existsSync(file) && statSync(file).size > 0
    }
    return { ...slot, provided }
  })
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
      // 旧版包根 app/tray 图标迁到全局目录（建窗前完成，首帧图标即正确）
      await migratePackIconsToGlobal()
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
      unregisterMethod('desktop.iconTheme.create')
      unregisterMethod('desktop.iconTheme.upload')
    },
  }
}

/** 官方 UI 覆盖规则（icons/ui-overrides.json 条目，@lansi-ai/dsh-desktop-ui-icons 消费）。 */
interface UiOverrideRule {
  /** 官方 svg 首个 path 的 d 前缀特征。 */
  match: string
  /** 替换图标文件名（相对包内 icons/ 目录）。 */
  icon: string
  /** 建议渲染尺寸（官方 svg 无 width 属性时兜底）。 */
  size?: number
}

/**
 * 把槽位的官方 path 特征映射并进包内 icons/ui-overrides.json（upsert：同 match
 * 前缀旧规则先剔除再追加；文件缺失/损坏按空表起始）。icon 写相对 icons/ 的
 * 文件名（覆盖层经 dsh-ui://app/theme/current/icons/<icon> 引用）。
 */
async function upsertUiOverrideRules(packDir: string, slot: IconSlot): Promise<void> {
  const file = join(packDir, 'icons', 'ui-overrides.json')
  let rules: UiOverrideRule[] = []
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf-8'))
    if (Array.isArray(parsed)) {
      rules = parsed.filter((entry): entry is UiOverrideRule =>
        typeof entry === 'object' && entry !== null &&
        typeof (entry as UiOverrideRule).match === 'string' &&
        typeof (entry as UiOverrideRule).icon === 'string')
    }
  } catch {
    // 缺失/损坏 → 空表起始
  }
  const incoming = slot.match ?? []
  const icon = basename(slot.file)
  rules = rules.filter((rule) => !incoming.includes(rule.match))
  for (const match of incoming) rules.push({ match, icon, size: slot.size })
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(rules, null, 2)}\n`, 'utf-8')
}

/**
 * 注册图标主题 bridge 方法（步骤 8 desktopCore 就绪后调用；与 autostart 模式一致：
 * 真源主进程侧，写 settings 经事件联动自动生效）。颜色主题（colorThemeId）为
 * 独立设置项，后续版本单独注册 desktop.colorTheme.* 方法，互不复用。
 *
 * @param desktop `ctx.desktop` 聚合服务（writeConfig 持久化 + 审计）。
 */
export function registerDesktopThemeMethods(desktop: DesktopCore): void {
  /** 下行通知各窗口桌面 UI（标题栏 logo / 设置导航 / 图标覆盖层）破缓存刷新。 */
  const notifyIconChange = (themeId: string): void => {
    desktop.sendDesktopEvent({ action: 'theme.icon-change', payload: { iconThemeId: themeId } })
    desktop.emitAction('theme.icon-change', { iconThemeId: themeId })
  }

  /**
   * 激活指定图标包：同步应用（协议层 current 映射与窗口/托盘图标立即切换，消除
   * 「事件先到、状态后切」竞态）→ settings 持久化（真源）→ 下行刷新。
   * 事件回流时 readActiveThemeId 返回同值，sync no-op，不构成反馈循环。
   */
  const activate = (themeId: string): void => {
    applyActiveThemeId(themeId)
    desktop.writeConfig('iconThemeId', themeId)
    notifyIconChange(themeId)
  }

  /** 图标主题清单查询（扫描结果 + 激活标记 + 包内图标索引 + 槽位需求状态 + 上传落盘目录）。 */
  const handleList = async (): Promise<IconThemeListResult> => {
    // 上传后图标文件系统已变化，重扫保证索引即时（清单量级小，开销可忽略）
    await scanThemes()
    const list = await Promise.all([...themes.entries()].map(async ([id, entry]) => ({
      ...entry.manifest,
      id,
      current: id === activeThemeId,
      icons: await listThemeIcons(entry.dir),
    })))
    return {
      themes: list,
      current: activeThemeId,
      slots: listSlotStatus(themes.get(activeThemeId)?.dir),
      uploadDir: resolveWritableThemeDir(activeThemeId),
      globalDir: resolveGlobalIconsDir(),
    }
  }

  /** 图标主题切换（zod 校验 → 激活 → 审计与下行刷新）。 */
  const handleSet = (params: unknown): IconThemeSetResult => {
    const parsed = iconThemeSetSchema.parse(params)
    if (!themes.has(parsed.id)) {
      return { ok: false, message: `图标主题不存在: ${parsed.id}` }
    }
    activate(parsed.id)
    log.info(`[dsh-theme] 图标主题切换请求: ${parsed.id}`)
    return { ok: true, current: parsed.id }
  }

  /**
   * 新建图标包：在用户主题目录建空包（theme.json + icons/），**建完即激活**——
   * 之后的「上传图标」按槽位直接落进这个包（上传目标恒为当前激活包）。
   * ID 走协议路由白名单字符集（`[a-z0-9_-]{1,32}`），与已有包重名直接拒绝。
   */
  const handleCreate = async (params: unknown): Promise<IconThemeCreateResult> => {
    const parsed = iconThemeCreateSchema.parse(params)
    await scanThemes()
    if (themes.has(parsed.id)) {
      return { ok: false, message: `图标包已存在: ${parsed.id}` }
    }
    const packDir = resolveUserThemeDir(parsed.id)
    await mkdir(join(packDir, 'icons'), { recursive: true })
    await writeFile(join(packDir, 'theme.json'), JSON.stringify({ id: parsed.id, name: parsed.name }, null, 2), 'utf-8')
    await scanThemes()
    if (!themes.has(parsed.id)) {
      return { ok: false, message: '图标包已写入但未被清单收录（theme.json 可能无效）' }
    }
    activate(parsed.id)
    log.info(`[dsh-theme] 新建图标包并激活: ${parsed.id}（${parsed.name}）→ ${packDir}`)
    return { ok: true, id: parsed.id, current: parsed.id }
  }

  /**
   * 图标上传（槽位驱动）：对话框按槽位格式单选 → 以**槽位规范名**落盘，用户无需
   * 手工对齐文件名与目录。目标按 `scope` 分流：
   *   - `global`（应用/托盘图标、标题栏品牌 logo）→ `userData/icons/`，全局单份，
   *     与图标包无关（换包不影响这些图标）；
   *   - `pack`（界面图标）→ **当前激活包** `icons/`；激活包是内置包（打包后 asar
   *     只读）时先整体克隆到用户目录同名包——扫描时用户包覆盖内置，激活 ID 不变
   *     而内容就地可替换，用户视角仍是「传进了这个包」。
   * 对话框先行弹出，取消时不做克隆等任何写操作。
   */
  const handleUpload = async (params: unknown): Promise<IconThemeUploadResult> => {
    const parsed = iconThemeUploadSchema.parse(params)
    const slot = ICON_SLOTS.find((entry) => entry.id === parsed.slotId)
    if (slot === undefined) {
      return { ok: false, message: `图标槽位不存在: ${parsed.slotId}` }
    }
    if (slot.scope === 'pack' && !themes.has(activeThemeId)) {
      return { ok: false, message: `当前激活图标包不存在: ${activeThemeId}` }
    }
    const picked = await dialog.showOpenDialog({
      title: `选择「${slot.label}」图标（.${slot.format} · 建议 ${slot.size}px 正方形）`,
      properties: ['openFile'],
      filters: [{ name: slot.format.toUpperCase(), extensions: [slot.format] }],
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, message: '已取消选择' }
    }
    const source = picked.filePaths[0]
    if (!source.toLowerCase().endsWith(`.${slot.format}`)) {
      return { ok: false, message: `「${slot.label}」需要 .${slot.format} 文件` }
    }
    let targetDir = resolveGlobalIconsDir()
    let cloned = false
    if (slot.scope === 'pack') {
      targetDir = themes.get(activeThemeId)?.dir ?? resolveUserThemeDir(activeThemeId)
      if (!isUserThemeDir(targetDir)) {
        // 内置包只读 → 整体克隆到用户目录同名包（含 theme.json，显示名与强调色不变）
        await cp(targetDir, resolveUserThemeDir(activeThemeId), { recursive: true })
        targetDir = resolveUserThemeDir(activeThemeId)
        cloned = true
      }
    }
    const target = join(targetDir, slot.file)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
    // 官方 UI 覆盖槽位（带 match 特征）：把映射规则并进包内 ui-overrides.json，
    // 覆盖层（@lansi-ai/dsh-desktop-ui-icons）随后按新规则做 DOM 替换
    if (slot.match !== undefined && slot.match.length > 0) {
      await upsertUiOverrideRules(targetDir, slot)
    }
    // 重扫：克隆出的新包需进主题表，否则协议层 resolveThemeDir 查不到 → 404
    await scanThemes()
    // 同 ID/同归属换内容不会触发 applyActiveThemeId → 宿主与 UI 两处刷新显式补发
    onThemeChanged?.()
    notifyIconChange(activeThemeId)
    const where = slot.scope === 'global' ? '全局' : `${activeThemeId} 包`
    log.info(`[dsh-theme] 图标上传: ${slot.id} → ${where}/${slot.file}${cloned ? '（内置包已克隆到本地后写入）' : ''}`)
    return {
      ok: true,
      imported: [slot.file],
      scope: slot.scope,
      themeId: slot.scope === 'pack' ? activeThemeId : undefined,
      cloned,
    }
  }

  registerMethod('desktop.iconTheme.list', async () => handleList())
  registerMethod('desktop.iconTheme.set', async (params: unknown) => handleSet(params))
  registerMethod('desktop.iconTheme.create', async (params: unknown) => handleCreate(params))
  registerMethod('desktop.iconTheme.upload', async (params: unknown) => handleUpload(params))
  log.ok('[dsh-theme] 图标主题 bridge 方法已注册（desktop.iconTheme.list/set/create/upload）')
}
