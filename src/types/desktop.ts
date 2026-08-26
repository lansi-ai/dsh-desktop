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

// ── 推导类型 ──────────────────────────────────────────────────────

export type DesktopAction = z.infer<typeof desktopActionSchema>
export type DesktopActionEvent = z.infer<typeof desktopActionEventSchema>
export type DesktopEvent = z.infer<typeof desktopEventSchema>

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
