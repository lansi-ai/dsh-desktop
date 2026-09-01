/**
 * IPC 信封 zod 契约（dsh-desktop Step 4·IPC 载波四件套）。
 *
 * 设计对齐官方 `api/rpc.ts` 的 fullForm 语义：
 * - RpcRequest  = 上行 client-request（method + params + rpcId）
 * - RpcResponse = 下行 server-response（rpcId + data | error）
 * - Frame       = 下行 server-request 帧（type + payload）
 * - ClientResponse = 上行帧应答（rpcId + body）
 */

import { z } from 'zod'

// ── RPC 基础 ────────────────────────────────────────────────────────

/** RPC 请求 ID。官方 `RpcId` 为 branded string，不强制 UUID 格式（renderer
 *  ipc-connection 的 randomUuid 回退分支产出 `${Date.now()}-${Math.random()}` 非 UUID），
 *  故放宽为非空字符串。 */
export const rpcIdSchema = z.string().min(1)

/** RPC 请求信封。 */
export const rpcRequestSchema = z.object({
  rpcId: rpcIdSchema,
  method: z.string().min(1),
  params: z.unknown().nullable().optional(),
})

/** RPC 成功响应。 */
export const rpcSuccessSchema = z.object({
  rpcId: rpcIdSchema,
  data: z.unknown(),
})

/** RPC 错误响应。 */
export const rpcErrorSchema = z.object({
  rpcId: rpcIdSchema,
  error: z.object({
    code: z.number().int(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
})

/** RPC 响应联合（成功 | 错误）。 */
export const rpcResponseSchema = z.union([rpcSuccessSchema, rpcErrorSchema])

// ── 帧（server-request 推送） ─────────────────────────────────────────

/** 服务端推送帧类型枚举。 */
export const FrameType = {
  /** 会话事件（session/event）。 */
  SESSION_EVENT: 'session/event',
  /** 审批请求（approval requested）。 */
  APPROVAL_REQUESTED: 'approval/requested',
  /** 提问请求（question requested）。 */
  QUESTION_REQUESTED: 'question/requested',
} as const

/** 帧类型联合。 */
export type FrameType = (typeof FrameType)[keyof typeof FrameType]

/** 帧类型 schema。 */
export const frameTypeSchema = z.nativeEnum(FrameType)

/** 服务端推送帧。 */
export const frameSchema = z.object({
  type: frameTypeSchema,
  payload: z.unknown(),
})

// ── Client-Response（帧应答） ─────────────────────────────────────────

/** 上行帧应答。 */
export const clientResponseSchema = z.object({
  rpcId: rpcIdSchema,
  body: z.unknown(),
})

// ── 官方四象限全信封（帧路由对齐） ───────────────────────────────────

/** 上行 client-request（client-connection 载波子类 doFetch 的入参）。 */
export const clientRequestSchema = z.object({
  type: z.literal('client-request'),
  rpcId: rpcIdSchema,
  method: z.string().min(1),
  payload: z.unknown().optional(),
})

/** server-response 成功分支（result.value 为 host 回传业务值）。 */
export const rpcSuccessDeltaSchema = z.object({
  ok: z.literal(true),
  value: z.unknown(),
})

/** server-response 错误分支（result.error 为结构化错误）。 */
export const rpcErrorDeltaSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.number().int(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
})

/** 下行 server-request（host 推送帧：session/event、approval/question requested）。 */
export const serverRequestSchema = z.object({
  type: z.literal('server-request'),
  rpcId: rpcIdSchema,
  method: z.string().min(1),
  payload: z.unknown(),
})

/** 下行 server-response（上行 client-request 的应答，result = {ok, value|error}）。 */
export const serverResponseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: rpcIdSchema,
  result: z.union([rpcSuccessDeltaSchema, rpcErrorDeltaSchema]),
})

// ── Ready 通知 ──────────────────────────────────────────────────────

/** Renderer 就绪通知。 */
export const readyNotificationSchema = z.object({
  windowId: z.number().int(),
})

// ── 逻辑流载波（0.1.2 __DSH_TRANSPORT__.openStream） ─────────────────

/** 打开逻辑流载波的上行请求（renderer openStream → host）。 */
export const streamOpenSchema = z.object({
  streamId: rpcIdSchema,
  endpoint: z.string().min(1),
  payload: z.unknown().nullable().optional(),
})

/** 逻辑流下行帧（stream-item value）。 */
export const streamFrameSchema = z.object({
  streamId: rpcIdSchema,
  value: z.unknown(),
})

/** 逻辑流关闭（stream-end / stream-error）。正确收尾即正常结束；带 message 视为错误抛给 renderer。 */
export const streamCloseSchema = z.object({
  streamId: rpcIdSchema,
  message: z.string().nullable().optional(),
})

// ── TypeScript 类型导出 ──────────────────────────────────────────────

/** RPC 请求。 */
export type RpcRequest = z.infer<typeof rpcRequestSchema>

/** RPC 成功响应。 */
export type RpcSuccess = z.infer<typeof rpcSuccessSchema>

/** RPC 错误响应。 */
export type RpcError = z.infer<typeof rpcErrorSchema>

/** RPC 响应。 */
export type RpcResponse = z.infer<typeof rpcResponseSchema>

/** 服务端推送帧。 */
export type Frame = z.infer<typeof frameSchema>

/** 客户端帧应答。 */
export type ClientResponse = z.infer<typeof clientResponseSchema>

/** 上行 client-request 信封。 */
export type ClientRequest = z.infer<typeof clientRequestSchema>

/** 下行 server-request 信封（host 帧路由推送）。 */
export type ServerRequest = z.infer<typeof serverRequestSchema>

/** 下行 server-response 信封。 */
export type ServerResponse = z.infer<typeof serverResponseSchema>

/** Renderer 就绪通知。 */
export type ReadyNotification = z.infer<typeof readyNotificationSchema>

/** 打开逻辑流载波的上行请求。 */
export type StreamOpen = z.infer<typeof streamOpenSchema>

/** 逻辑流下行帧。 */
export type StreamFrame = z.infer<typeof streamFrameSchema>

/** 逻辑流关闭。 */
export type StreamClose = z.infer<typeof streamCloseSchema>