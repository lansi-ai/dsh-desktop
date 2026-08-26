/**
 * dsh-desktop `ctx.desktop` 聚合服务（M2·地基 desktop-host-core / desktop-api）。
 *
 * 以 Cordis Service 形态注入（`ctx.provide('desktop')`），供桌面能力 host 插件
 * `inject: ['desktop']` 解析。M2 地基含 **core 子集**（对齐 05-host-plugins.md §3）：
 *   - 审计总线：`onAction`(订阅，`*` 通配) / `emitAction`(触发+审计) / `log`(仅审计)
 *   - 桌面配置：`readConfig` / `writeConfig` —— **接入 `settings`（@deepseek-ai/dsh-settings-file）
 *     持久化**（namespace `desktop`，schemastery 宽松字典 `Schema.dict(Schema.any(), Schema.string())`），
 *     settings 未就绪时回退内存兜底
 *   - 下行事件：`sendDesktopEvent` → 广播 `desktop:event` 通道 → preload `onDesktopEvent`
 *
 * 注入方式延续 `compat-webserver.ts`（boot() prepare 钩子动态 `await import` ESM 的 Cordis
 * 基类与 schemastery）。`settings` 服务在插件树挂载后才就绪，故配置读写用**懒初始化**
 * `settings.register('desktop', ...)`（首次调用时若 settings 可用即注册并用其 scope）。
 * 审计日志优先 `ctx.logger`（若有），回退结构化 `console`。
 */

import { BrowserWindow, type WebContents } from 'electron'
import { IPC_CHANNELS } from '../types/channels.js'
import {
  desktopActionEventSchema,
  desktopEventSchema,
  type DesktopEvent,
} from '../types/desktop.js'

// ── 类型 ───────────────────────────────────────────────────────────

/** `desktop/action` 订阅回调。 */
type ActionHandler = (payload: unknown) => void

/** Cordis Context 最小面（仅取 get）。 */
interface CordisCtxLike {
  get(name: string): unknown
}

/** settings scope 最小面（register 返回值）。 */
interface SettingsScopeLike {
  get(): Record<string, unknown>
  update(patch: object): Promise<void>
}

/** settings 服务最小面（SettingsProvider）。 */
interface SettingsLike {
  register(ns: string, schema: unknown): SettingsScopeLike
}

// ── 服务实现 ───────────────────────────────────────────────────────

/**
 * 在 Cordis 上下文安装 `ctx.desktop` 聚合服务（boot() prepare 阶段调用）。
 *
 * @param ctx Cordis Host 上下文。
 */
export async function installDesktopCore(ctx: unknown): Promise<void> {
  const { Service } = await import('@deepseek-ai/cordis')
  const Schema = (await import('@deepseek-ai/schemastery')).default
  const coreCtx = ctx as CordisCtxLike

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  class DesktopCoreService extends (Service as any) {
    /** 审计订阅表：action → handlers（`*` 通配）。 */
    private handlers = new Map<string, Set<ActionHandler>>()
    /** 桌面配置内存缓存（settings 未就绪时的兜底 + 读加速）。 */
    private config = new Map<string, unknown>()
    /** 已注册的 settings scope（懒初始化，单例）。 */
    private settingsScope: SettingsScopeLike | null = null

    /**
     * 懒初始化 settings 持久化 scope：settings 就绪时注册 `desktop` namespace 并返回其 scope。
     * 未就绪（prepare 阶段早于 settings 插件挂载）或注册失败时返回 null（回退内存）。
     */
    private lazySettingsScope(): SettingsScopeLike | null {
      if (this.settingsScope !== null) return this.settingsScope
      try {
        const settings = coreCtx.get('settings') as SettingsLike | undefined
        if (settings?.register !== undefined) {
          // schemastery 宽松字典：任意 key → 任意 JSON 值（配置字段由各桌面插件约定）。
          const schema = Schema.dict(Schema.any(), Schema.string())
          this.settingsScope = settings.register('desktop', schema)
        }
      } catch {
        this.settingsScope = null
      }
      return this.settingsScope
    }

    /** 订阅某 `desktop/action` 触发回调（`*` 匹配全部）。返回注销函数。 */
    onAction(action: string, fn: ActionHandler): () => void {
      const set = this.handlers.get(action) ?? new Set<ActionHandler>()
      set.add(fn)
      this.handlers.set(action, set)
      return () => {
        set.delete(fn)
        if (set.size === 0) this.handlers.delete(action)
      }
    }

    /** 触发 `desktop/action`：写审计日志 + 分发给匹配订阅者。 */
    emitAction(action: string, payload?: unknown): void {
      this.log(action, payload)
      const exact = this.handlers.get(action)
      const wildcard = this.handlers.get('*')
      for (const fn of exact ?? []) fn(payload)
      for (const fn of wildcard ?? []) fn(payload)
    }

    /** 仅写结构化审计日志（不触发订阅者），满足 R-15。 */
    log(action: string, payload?: unknown): void {
      const record = desktopActionEventSchema.parse({
        ts: Date.now(),
        action,
        ...(payload !== undefined ? { payload } : {}),
      })
      try {
        const logger = coreCtx.get('logger') as { info?: (msg: string, meta: unknown) => void } | undefined
        if (logger?.info !== undefined) logger.info('[desktop/action]', record)
        else console.log('[desktop/action]', JSON.stringify(record))
      } catch {
        console.log('[desktop/action]', JSON.stringify(record))
      }
    }

    /** 读桌面配置：settings 权威优先，未就绪回退内存缓存；未设置返回 undefined。 */
    readConfig<T>(key: string): T | undefined {
      const scope = this.lazySettingsScope()
      if (scope !== null) {
        const value = scope.get()[key]
        if (value !== undefined) return value as T
      }
      return this.config.get(key) as T | undefined
    }

    /** 写桌面配置：同步更新内存缓存 + 审计，并异步持久化到 settings（未就绪则仅内存）。 */
    writeConfig<T>(key: string, value: T): void {
      this.config.set(key, value)
      this.log('config.write', { key, value })
      const scope = this.lazySettingsScope()
      if (scope !== null) {
        void scope.update({ [key]: value }).catch(() => {
          console.warn('[dsh-desktop] desktop 配置持久化失败:', key)
        })
      }
    }

    /** 下行一个桌面事件到所有窗口（→ preload `onDesktopEvent`）。 */
    sendDesktopEvent(event: DesktopEvent): void {
      const parsed = desktopEventSchema.parse(event)
      for (const win of BrowserWindow.getAllWindows()) {
        const wc: WebContents = win.webContents
        if (!wc.isDestroyed()) wc.send(IPC_CHANNELS.DESKTOP_EVENT, parsed)
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (DesktopCoreService as any)(ctx, 'desktop')
  console.log('[dsh-desktop] ctx.desktop 聚合服务已注入（core 子集：onAction/emitAction/log/readConfig/writeConfig/sendDesktopEvent，config→settings 持久化）')
}
