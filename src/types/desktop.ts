/**
 * dsh-desktop 桌面域契约（M2·地基 desktop-host-core / desktop-api）。
 *
 * 唯一类型源头：`ctx.desktop` 服务的 zod Schema、审计事件、下行桌面事件、
 * 桌面配置读写，均由本文件推导，renderer/preload/host 三方共享。
 *
 * 职责边界（对齐 05-host-plugins.md §3 core 子集）：
 * - `desktop/action` 审计：`onAction`(订阅) / `emitAction`(触发+审计) / `log`(仅审计)
 * - 下行桌面事件：`sendDesktopEvent` → preload `onDesktopEvent`（`desktop:event` 通道）
 * - 桌面配置：`readConfig` / `writeConfig`（内存后端，持久化留给 desktop-client-settings）
 */

import { z } from 'zod'

// ── zod Schema（IPC 契约与审计记录）────────────────────────────────

/** 桌面事件动作名（开放字符串，约定 `domain.action` 前缀：tray.click / clipboard.write 等）。 */
export const desktopActionSchema = z.string().min(1)

/** `desktop/action` 审计记录（结构化日志落盘约束，满足 R-15）。 */
export const desktopActionEventSchema = z.object({
  /** 审计时间戳（ms）。 */
  ts: z.number(),
  /** 动作名（如 `tray.click`）。 */
  action: desktopActionSchema,
  /** 动作载荷（任意业务数据）。 */
  payload: z.unknown().optional(),
})

/** 下行到 renderer 的桌面事件（对齐 preload `onDesktopEvent` 的 `{ action, payload }`）。 */
export const desktopEventSchema = z.object({
  action: desktopActionSchema,
  payload: z.unknown().optional(),
})

// ── 快捷键 Schema（M2·d3 shortcuts）──────────────────────────────

/** 全局快捷键注册请求（renderer → host）。 */
export const shortcutRegisterSchema = z.object({
  /** Electron Accelerator 字符串（如 'Alt+Shift+Q'）。 */
  accelerator: z.string().min(1),
  /** 快捷键动作名（触发时经 desktop.emitAction + sendDesktopEvent 下行）。 */
  action: desktopActionSchema,
})

/** 全局快捷键注销请求（renderer → host）。 */
export const shortcutUnregisterSchema = z.object({
  /** 要注销的 Accelerator 字符串。 */
  accelerator: z.string().min(1),
})

// ── 剪贴板 Schema（M2·d3 clipboard）──────────────────────────────

/** 剪贴板写入请求（renderer → host，需 approval 审批）。 */
export const clipboardWriteSchema = z.object({
  /** 要写入剪贴板的文本内容。 */
  text: z.string(),
})

// ── 命令面板 Schema（M3-a4 command palette）────────────────────────

/** 命令面板打开请求（renderer → host，支持指定初始查询）。 */
export const cmdPaletteOpenSchema = z.object({
  /** 初始查询文本（可选，聚焦后预填输入框）。 */
  query: z.string().optional(),
})

/** 快速提问请求（renderer → host + 全局快捷键触发）。 */
export const cmdPaletteQuickAskSchema = z.object({
  /** 预填问题文本。 */
  question: z.string().optional(),
})

/** 命令面板会话切换请求。 */
export const cmdPaletteSwitchSessionSchema = z.object({
  /** 目标会话 ID。 */
  sessionId: z.string(),
})

// ── 推导类型 ──────────────────────────────────────────────────────

export type DesktopAction = z.infer<typeof desktopActionSchema>
export type DesktopActionEvent = z.infer<typeof desktopActionEventSchema>
export type DesktopEvent = z.infer<typeof desktopEventSchema>
export type ShortcutRegister = z.infer<typeof shortcutRegisterSchema>
export type ShortcutUnregister = z.infer<typeof shortcutUnregisterSchema>
export type ClipboardWrite = z.infer<typeof clipboardWriteSchema>
export type CmdPaletteOpen = z.infer<typeof cmdPaletteOpenSchema>
export type CmdPaletteQuickAsk = z.infer<typeof cmdPaletteQuickAskSchema>
export type CmdPaletteSwitchSession = z.infer<typeof cmdPaletteSwitchSessionSchema>

// ── dsh:// 协议 Schema（M3-b1 system protocol）─────────────────────

/** dsh://open 协议载荷（聚焦/创建指定会话窗口）。 */
export const dshProtocolOpenSchema = z.object({
  /** 目标会话 ID。 */
  session: z.string(),
})

/** dsh://ask 协议载荷（唤起快速提问 + 预填问题）。 */
export const dshProtocolAskSchema = z.object({
  /** 预填问题文本。 */
  q: z.string().optional(),
})

/** dsh:// 协议动作枚举。 */
export const dshProtocolActionSchema = z.enum(['open', 'ask', 'settings'])

/** dsh:// 协议路由结果。 */
export const dshProtocolResultSchema = z.object({
  /** 路由是否成功。 */
  success: z.boolean(),
  /** 被路由的动作。 */
  action: dshProtocolActionSchema,
  /** 路由结果描述。 */
  message: z.string().optional(),
  /** 关联的会话 ID（open 动作时返回）。 */
  sessionId: z.string().optional(),
})

export type DshProtocolOpen = z.infer<typeof dshProtocolOpenSchema>
export type DshProtocolAsk = z.infer<typeof dshProtocolAskSchema>
export type DshProtocolAction = z.infer<typeof dshProtocolActionSchema>
export type DshProtocolResult = z.infer<typeof dshProtocolResultSchema>

// ── 审计查询 Schema（M3-b2 audit viewer）────────────────────────────

/** 审计日志条目（从 audit.jsonl 读取）。 */
export const auditLogEntrySchema = z.object({
  /** 时间戳（毫秒）。 */
  ts: z.number().int(),
  /** 动作名（如 'tray.window-hide'、'shortcut.register'）。 */
  action: z.string(),
  /** 附加载荷（任意 JSON）。 */
  payload: z.unknown().optional(),
})

/** 审计查询请求。 */
export const auditQuerySchema = z.object({
  /** 按动作名过滤（精确匹配）。 */
  action: z.string().optional(),
  /** 按会话 ID 过滤（payload.sessionId 匹配）。 */
  sessionId: z.string().optional(),
  /** 起始时间戳（毫秒）。 */
  from: z.number().int().optional(),
  /** 结束时间戳（毫秒）。 */
  to: z.number().int().optional(),
  /** 每页数量（默认 50）。 */
  limit: z.number().int().min(1).max(500).default(50),
  /** 偏移量（分页用）。 */
  offset: z.number().int().min(0).default(0),
})

/** 审计查询响应。 */
export const auditQueryResultSchema = z.object({
  /** 条目列表（按时间倒序）。 */
  entries: z.array(auditLogEntrySchema),
  /** 总匹配数（忽略 limit/offset）。 */
  total: z.number().int(),
  /** 本次查询使用的参数。 */
  query: auditQuerySchema,
})

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>
export type AuditQuery = z.infer<typeof auditQuerySchema>
export type AuditQueryResult = z.infer<typeof auditQueryResultSchema>

// ── 开机自启 Schema（M3-b3 autostart）────────────────────────────────

/** 开机自启设置请求（renderer → host）。 */
export const autostartSetEnabledSchema = z.object({
  /** 是否启用开机自启。 */
  enabled: z.boolean(),
})

/** 开机自启状态响应（OS 登录项为唯一真源，实时读取）。 */
export const autostartStatusSchema = z.object({
  /** OS 登录项当前是否启用。 */
  enabled: z.boolean(),
  /** 当前平台是否支持开机自启（Windows/macOS）。 */
  supported: z.boolean(),
  /** 是否处于开发模式（dev 下注册被拦截，仅打包版生效）。 */
  devMode: z.boolean(),
  /** 状态描述（拦截原因/失败信息等）。 */
  message: z.string().optional(),
})

export type AutostartSetEnabled = z.infer<typeof autostartSetEnabledSchema>
export type AutostartStatus = z.infer<typeof autostartStatusSchema>

// ── 主题 Schema（图标主题 / 颜色主题 · 两个独立设置项）───────────────

/**
 * 主题包清单（resources/themes/<id>/theme.json）。
 *
 * 主题包 = 外观资产包，服务两类**相互独立**的设置项：
 *   - 图标主题（iconThemeId）：包内 app/tray × light/dark 图标四件套，V1 可用；
 *   - 颜色主题（colorThemeId）：界面配色体系（骨架变量/托盘色等），后续版本
 *     经包内 colors 定义扩展，与图标主题分开选择、独立存储。
 *
 * `color` 为包的强调色（css 颜色值），设置页清单预览圆点用，非颜色主题本身。
 */
export const themeManifestSchema = z.object({
  /** 主题 ID（即主题目录名，如 'default'）。 */
  id: z.string().min(1),
  /** 显示名（设置页展示）。 */
  name: z.string().min(1),
  /** 主题强调色（css 颜色值，如 '#22d3ee'；可选，缺省中性色）。 */
  color: z.string().optional(),
})

/** 图标主题切换请求（renderer → host）。 */
export const iconThemeSetSchema = z.object({
  /** 目标图标主题 ID（必须存在于主题清单）。 */
  id: z.string().min(1),
})

/** 主题摘要（设置页列表项：清单 + 当前激活标记 + 图标文件索引）。 */
export const themeSummarySchema = themeManifestSchema.extend({
  /** 是否为当前激活主题。 */
  current: z.boolean(),
  /** 包内图标文件索引（相对主题目录路径，如 'icons/settings-nav-appearance.svg'）。 */
  icons: z.array(z.string()),
})

/**
 * 图标槽位（系统/自研插件消费的主题图标需求，注册表真源在 desktop-theme.ts）。
 *
 * 设置页「外观」据此展示**需求清单**（要哪些图标、规范文件名、期望落盘位置、
 * 缺失时回退到什么），而非罗列包内已有文件；上传按槽位驱动，目标文件名由
 * 注册表决定（app/tray 四件套在包根，UI 槽位在 icons/ 子目录）。
 */
export const iconSlotSchema = z.object({
  /** 槽位 ID（上传请求定位用，如 'titlebar-logo'）。 */
  id: z.string().min(1),
  /** 用途名（设置页展示，如「标题栏品牌 logo」）。 */
  label: z.string().min(1),
  /** 消费方分组（用途域，如「应用与托盘」「标题栏」「设置面板」）。 */
  group: z.string().min(1),
  /** 消费方插件/模块标识（设置页据此明确「这个图标位由谁取用」，如 @lansi-ai/dsh-desktop-titlebar）。 */
  plugin: z.string().min(1),
  /**
   * 归属范围：
   *   - `global`=应用/托盘图标与标题栏品牌 logo，存包外 `userData/icons/` 全局单份，
   *     **不随图标包切换**（它们是应用身份标识，不属于任何图标包）；
   *   - `pack`=界面图标（设置导航、窗控、工作区侧栏等），随激活包切换。
   */
  scope: z.enum(['global', 'pack']),
  /** 相对归属目录的规范文件名（global：`app-icon-light.png`；pack：`icons/xxx.svg`）。 */
  file: z.string().min(1),
  /** 期望格式：svg=单色线条稿（随明暗自适应）；png=彩色位图。 */
  format: z.enum(['svg', 'png']),
  /** 建议尺寸（svg 为渲染像素；png 为导出的正方形边长）。 */
  size: z.number().int().positive(),
  /** 缺失时的回退行为说明。 */
  fallback: z.string().min(1),
  /**
   * 官方 UI 覆盖映射（可选，仅官方 bundle 内联 SVG 槽位使用）：官方 svg 首个
   * path 的 d 前缀特征，多条=同一图标覆盖多个官方变体（如文件夹收起/展开两态）。
   * 上传该槽位时主进程自动把 { match, icon, size } 规则并进包内
   * icons/ui-overrides.json，运行期由 @lansi-ai/dsh-desktop-ui-icons 覆盖层做
   * DOM 替换（官方 dist 零改动；官方升级改变 path 特征时需重新登记）。
   */
  match: z.array(z.string().min(1)).optional(),
})

/** 图标槽位状态（注册表 + 相对其归属目录的提供情况）。 */
export const iconSlotStatusSchema = iconSlotSchema.extend({
  /** 归属目录（global=userData/icons，pack=当前激活包）是否已提供该文件。 */
  provided: z.boolean(),
})

/** 图标主题清单响应。 */
export const iconThemeListResultSchema = z.object({
  /** 可用图标主题列表（按目录扫描序）。 */
  themes: z.array(themeSummarySchema),
  /** 当前激活图标主题 ID（清单缺失时回退 'default'）。 */
  current: z.string().min(1),
  /** 槽位需求清单（provided 按各自 scope 的归属目录判定）。 */
  slots: z.array(iconSlotStatusSchema),
  /** 当前激活包的写入目录（pack 槽位上传落盘位置；内置包为其本地克隆目标）。 */
  uploadDir: z.string().min(1),
  /** 全局图标目录绝对路径（global 槽位上传落盘位置，与图标包无关）。 */
  globalDir: z.string().min(1),
})

/** 图标主题切换响应（写 settings 后的回执）。 */
export const iconThemeSetResultSchema = z.object({
  /** 是否切换成功。 */
  ok: z.boolean(),
  /** 切换后的激活图标主题 ID（成功时回显）。 */
  current: z.string().optional(),
  /** 失败/拦截原因（主题不存在等）。 */
  message: z.string().optional(),
})

/** 图标上传请求（renderer → host；槽位驱动，目标=当前激活包，文件经系统对话框单选）。 */
export const iconThemeUploadSchema = z.object({
  /** 目标图标槽位 ID（须在注册表内，决定规范文件名/子目录/格式）。 */
  slotId: z.string().min(1),
})

/** 图标上传响应（以槽位规范名拷入当前激活图标包后的回执）。 */
export const iconThemeUploadResultSchema = z.object({
  /** 是否上传成功。 */
  ok: z.boolean(),
  /** 落盘的相对路径（槽位规范名，如 'icons/settings-nav-appearance.svg' / 'app-icon-light.png'）。 */
  imported: z.array(z.string()).optional(),
  /** 实际写入的归属：global=全局图标目录（与包无关）；pack=图标包。 */
  scope: z.enum(['global', 'pack']).optional(),
  /** scope=pack 时实际写入的图标包 ID（= 上传时的激活包）。 */
  themeId: z.string().optional(),
  /** 激活包为内置包（打包后只读）时置真：已先整体克隆到本地用户主题目录再写入。 */
  cloned: z.boolean().optional(),
  /** 失败/取消原因。 */
  message: z.string().optional(),
})

/** 图标包 ID 白名单（同 dsh-ui:// 主题路由的 `[a-z0-9_-]` 字符集约束）。 */
export const themeIdSchema = z.string().regex(/^[a-z0-9_-]{1,32}$/)

/** 新建图标包请求（renderer → host）。 */
export const iconThemeCreateSchema = z.object({
  /** 新包 ID（目录名；`[a-z0-9_-]{1,32}`，不得与已有包重名）。 */
  id: themeIdSchema,
  /** 显示名（设置页卡片标题）。 */
  name: z.string().min(1).max(24),
})

/** 新建图标包响应（建包即激活，后续上传直接落该包）。 */
export const iconThemeCreateResultSchema = z.object({
  /** 是否创建成功。 */
  ok: z.boolean(),
  /** 新包 ID。 */
  id: z.string().optional(),
  /** 创建后的激活包 ID。 */
  current: z.string().optional(),
  /** 失败原因（重名/非法 ID 等）。 */
  message: z.string().optional(),
})

export type ThemeManifest = z.infer<typeof themeManifestSchema>
export type IconThemeSet = z.infer<typeof iconThemeSetSchema>
export type ThemeSummary = z.infer<typeof themeSummarySchema>
export type IconSlot = z.infer<typeof iconSlotSchema>
export type IconSlotStatus = z.infer<typeof iconSlotStatusSchema>
export type IconThemeListResult = z.infer<typeof iconThemeListResultSchema>
export type IconThemeSetResult = z.infer<typeof iconThemeSetResultSchema>
export type IconThemeUploadResult = z.infer<typeof iconThemeUploadResultSchema>
export type IconThemeCreate = z.infer<typeof iconThemeCreateSchema>
export type IconThemeCreateResult = z.infer<typeof iconThemeCreateResultSchema>

/**
 * `ctx.desktop` 聚合服务接口（core 子集，M2 地基）。
 *
 * 逻辑上聚合桌面能力；此处只含核心：审计总线 + 配置 + 下行事件，
 * tray/shortcuts/notifications 等能力面在各插件实现时再挂到本服务上。
 */
export interface DesktopCore {
  /**
   * 订阅某 `desktop/action` 触发时的回调（`*` 匹配全部）。返回注销函数。
   * @param action 动作名或 `*`。
   * @param fn 动作触发回调（payload 为触发时携带的载荷）。
   */
  onAction(action: string, fn: (payload: unknown) => void): () => void
  /**
   * 触发一个 `desktop/action` 并落审计（桌面插件捕获原生事件后调用）。
   * 触发所有匹配订阅者 + 写结构化审计日志。
   */
  emitAction(action: string, payload?: unknown): void
  /** 仅写结构化审计日志（不触发订阅者），用于纯记录场景（R-15）。 */
  log(action: string, payload?: unknown): void
  /** 读桌面配置（内存后端；未设置返回 undefined）。 */
  readConfig<T>(key: string): T | undefined
  /** 写桌面配置（内存后端，含审计）。 */
  writeConfig<T>(key: string, value: T): void
  /** 下行一个桌面事件到 renderer（经 preload `desktop:event` → `onDesktopEvent`）。 */
  sendDesktopEvent(event: DesktopEvent): void
}
