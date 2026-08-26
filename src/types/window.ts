/**
 * dsh-desktop 多窗口契约（M3-a1·WindowManager 基建）。
 *
 * 定义窗口管理的 zod Schema、状态枚举、广播帧结构，
 * 作为 renderer/preload/host 三方共享的唯一类型源头。
 *
 * 设计对齐 architecture.md：
 * - WindowManager 单例维护 windowId → WindowRecord + sessionId → windowId 双向绑定
 * - 窗口创建/销毁/聚焦通过 bridge methodTable 分发
 * - 窗口间通过广播帧同步会话列表变化
 */

import { z } from 'zod'

// ── 窗口状态枚举 ────────────────────────────────────────────────────

/** 窗口生命周期状态。 */
export const WindowState = {
  /** 窗口可见且有焦点。 */
  ACTIVE: 'active',
  /** 窗口可见但无焦点。 */
  INACTIVE: 'inactive',
  /** 窗口最小化到任务栏。 */
  MINIMIZED: 'minimized',
  /** 窗口隐藏到托盘（关窗驻留模式）。 */
  HIDDEN: 'hidden',
  /** 窗口已销毁（崩溃/关闭后标记）。 */
  DESTROYED: 'destroyed',
} as const

/** 窗口状态联合类型。 */
export type WindowState = (typeof WindowState)[keyof typeof WindowState]

/** 窗口状态 schema。 */
export const windowStateSchema = z.nativeEnum(WindowState)

// ── 窗口边界 ────────────────────────────────────────────────────────

/** Electron 窗口边界（像素坐标）。 */
export const windowBoundsSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(400),
  height: z.number().int().min(300),
})

/** 窗口边界类型。 */
export type WindowBounds = z.infer<typeof windowBoundsSchema>

// ── 窗口记录 ────────────────────────────────────────────────────────

/** 窗口记录（WindowManager 注册表条目）。 */
export const windowRecordSchema = z.object({
  /** Electron BrowserWindow ID。 */
  windowId: z.number().int(),
  /** 绑定的会话 ID（空字符串表示无会话绑定的主窗口）。 */
  sessionId: z.string(),
  /** 窗口当前状态。 */
  state: windowStateSchema,
  /** 窗口边界（位置与大小）。 */
  bounds: windowBoundsSchema,
  /** 窗口创建时间戳（ms）。 */
  createdAt: z.number().int(),
  /** 最后聚焦时间戳（ms）。 */
  lastFocusedAt: z.number().int(),
})

/** 窗口记录类型。 */
export type WindowRecord = z.infer<typeof windowRecordSchema>

// ── 窗口创建请求 ────────────────────────────────────────────────────

/** 创建会话窗口请求（renderer → host）。 */
export const createWindowRequestSchema = z.object({
  /** 要绑定的会话 ID。 */
  sessionId: z.string().min(1),
  /** 可选的初始窗口边界。 */
  bounds: windowBoundsSchema.optional(),
})

/** 创建会话窗口请求类型。 */
export type CreateWindowRequest = z.infer<typeof createWindowRequestSchema>

// ── 窗口操作请求 ────────────────────────────────────────────────────

/** 按会话 ID 操作窗口请求。 */
export const sessionWindowRequestSchema = z.object({
  /** 目标会话 ID。 */
  sessionId: z.string().min(1),
})

/** 按窗口 ID 操作窗口请求。 */
export const windowIdRequestSchema = z.object({
  /** 目标窗口 ID。 */
  windowId: z.number().int(),
})

/** 窗口边界更新请求。 */
export const updateBoundsRequestSchema = z.object({
  /** 目标窗口 ID。 */
  windowId: z.number().int(),
  /** 新边界。 */
  bounds: windowBoundsSchema,
})

// ── 窗口列表与响应 ──────────────────────────────────────────────────

/** 活动会话信息（供 renderer 侧命令面板使用）。 */
export const activeSessionSchema = z.object({
  /** 会话 ID。 */
  sessionId: z.string(),
  /** 绑定的窗口 ID。 */
  windowId: z.number().int(),
  /** 窗口状态。 */
  state: windowStateSchema,
  /** 会话标题（从 Host 获取，可选）。 */
  title: z.string().optional(),
  /** 未读消息数。 */
  unreadCount: z.number().int().default(0),
})

/** 活动会话类型。 */
export type ActiveSession = z.infer<typeof activeSessionSchema>

/** 窗口操作通用响应。 */
export const windowOperationResponseSchema = z.object({
  /** 操作是否成功。 */
  success: z.boolean(),
  /** 操作结果描述。 */
  message: z.string().optional(),
  /** 关联的窗口 ID。 */
  windowId: z.number().int().optional(),
  /** 关联的会话 ID。 */
  sessionId: z.string().optional(),
})

/** 窗口操作响应类型。 */
export type WindowOperationResponse = z.infer<typeof windowOperationResponseSchema>

// ── 窗口间广播帧 ────────────────────────────────────────────────────

/** 窗口事件类型（WindowManager → 所有 renderer 广播）。 */
export const WindowEvent = {
  /** 新窗口创建。 */
  WINDOW_CREATED: 'window/created',
  /** 窗口销毁。 */
  WINDOW_CLOSED: 'window/closed',
  /** 窗口状态变化（焦点/最小化/隐藏）。 */
  WINDOW_STATE_CHANGED: 'window/state-changed',
  /** 会话列表更新（新会话/删除会话/未读角标）。 */
  SESSION_LIST_UPDATED: 'session/list-updated',
  /** 窗口聚焦请求（来自协议或命令面板）。 */
  WINDOW_FOCUS_REQUESTED: 'window/focus-requested',
} as const

/** 窗口事件类型联合。 */
export type WindowEvent = (typeof WindowEvent)[keyof typeof WindowEvent]

/** 窗口事件 schema。 */
export const windowEventTypeSchema = z.nativeEnum(WindowEvent)

/** 窗口间广播帧（WindowManager → 所有窗口 renderer）。 */
export const windowBroadcastFrameSchema = z.object({
  /** 事件类型。 */
  type: windowEventTypeSchema,
  /** 事件载荷（因类型而异）。 */
  payload: z.unknown(),
  /** 事件时间戳。 */
  ts: z.number().int(),
})

/** 窗口间广播帧类型。 */
export type WindowBroadcastFrame = z.infer<typeof windowBroadcastFrameSchema>

/** 会话列表更新载荷。 */
export const sessionListPayloadSchema = z.object({
  /** 当前所有活动会话。 */
  sessions: z.array(activeSessionSchema),
})

/** 窗口创建/销毁载荷。 */
export const windowLifecyclePayloadSchema = z.object({
  /** 窗口 ID。 */
  windowId: z.number().int(),
  /** 关联会话 ID。 */
  sessionId: z.string(),
})

/** 窗口状态变化载荷。 */
export const windowStateChangePayloadSchema = z.object({
  /** 窗口 ID。 */
  windowId: z.number().int(),
  /** 新状态。 */
  state: windowStateSchema,
  /** 关联会话 ID。 */
  sessionId: z.string(),
})

// ── 窗口状态持久化 ──────────────────────────────────────────────────

/** 持久化窗口条目（存 JSON 文件，重启后恢复）。 */
export const persistWindowEntrySchema = z.object({
  /** 会话 ID（窗口唯一标识，重启后重新分配 windowId）。 */
  sessionId: z.string(),
  /** 窗口边界。 */
  bounds: windowBoundsSchema,
  /** Z-order 位置（0 = 最前，数值越大越靠后）。 */
  zIndex: z.number().int().default(0),
  /** 最后状态（窗口在关闭时的状态）。 */
  state: windowStateSchema.optional(),
  /** 最后持久化时间戳（ms）。 */
  savedAt: z.number().int(),
})

/** 持久化窗口条目类型。 */
export type PersistWindowEntry = z.infer<typeof persistWindowEntrySchema>

/** 窗口状态持久化文件结构。 */
export const windowPersistStateSchema = z.object({
  /** 格式版本号（迁移时递增）。 */
  version: z.number().int().default(1),
  /** 活跃会话窗口列表（按 zIndex 排序）。 */
  windows: z.array(persistWindowEntrySchema),
  /** 主窗口边界（可选）。 */
  mainWindowBounds: windowBoundsSchema.optional(),
  /** 全局保存时间戳。 */
  savedAt: z.number().int(),
})

/** 窗口状态持久化类型。 */
export type WindowPersistState = z.infer<typeof windowPersistStateSchema>
