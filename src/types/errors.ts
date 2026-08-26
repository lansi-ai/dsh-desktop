/**
 * AppError 错误码表（dsh-desktop Step 4·IPC 载波四件套）。
 *
 * 错误码分层：
 *   1xxx  — 通用/系统错误
 *   2xxx  — IPC 传输层错误
 *   3xxx  — RPC 方法错误
 *   4xxx  — 帧/事件错误
 *   9xxx  — 内部/断言错误
 */

/** 错误码与对应消息的只读映射。 */
export const ErrorCodes = {
  // ── 1xxx 通用 ──────────────────────────────────────────────────────
  /** 操作成功（仅用于哨兵值）。 */
  OK: 0,
  /** 未知/未分类错误。 */
  UNKNOWN: 1000,
  /** 内部断言失败。 */
  INTERNAL_ERROR: 1001,
  /** 参数校验失败。 */
  INVALID_ARGUMENT: 1002,
  /** 超时。 */
  TIMEOUT: 1003,

  // ── 2xxx IPC 传输层 ────────────────────────────────────────────────
  /** 无效的 IPC 通道名。 */
  INVALID_CHANNEL: 2000,
  /** IPC 调用尚未就绪（Host 未初始化完成）。 */
  NOT_READY: 2001,
  /** 消息序列化/反序列化失败。 */
  SERIALIZATION_ERROR: 2002,
  /** 窗口已关闭。 */
  WINDOW_CLOSED: 2003,
  /** 目标窗口未注册帧监听器。 */
  NO_FRAME_LISTENER: 2004,

  // ── 3xxx RPC 方法 ──────────────────────────────────────────────────
  /** 未找到 RPC 方法。 */
  METHOD_NOT_FOUND: 3000,
  /** RPC 方法执行异常。 */
  METHOD_ERROR: 3001,
  /** 重复的 rpcId（已存在未完成的调用）。 */
  DUPLICATE_RPC_ID: 3002,
  /** 未找到匹配的 rpcId（respond 无法回填）。 */
  RPC_ID_NOT_FOUND: 3003,

  // ── 4xxx 帧/事件 ───────────────────────────────────────────────────
  /** 未知的帧类型。 */
  UNKNOWN_FRAME_TYPE: 4000,
  /** 帧载荷校验失败。 */
  INVALID_FRAME_PAYLOAD: 4001,
  /** 帧发送失败（发送目标关闭）。 */
  FRAME_SEND_FAILED: 4002,
} as const satisfies Record<string, number>

/** 错误码值联合。 */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

/** 默认错误消息映射。 */
const DEFAULT_MESSAGES: Partial<Record<ErrorCode, string>> = {
  [ErrorCodes.OK]: 'ok',
  [ErrorCodes.UNKNOWN]: '未知错误',
  [ErrorCodes.INTERNAL_ERROR]: '内部错误',
  [ErrorCodes.INVALID_ARGUMENT]: '参数无效',
  [ErrorCodes.TIMEOUT]: '操作超时',
  [ErrorCodes.INVALID_CHANNEL]: '无效的 IPC 通道',
  [ErrorCodes.NOT_READY]: 'IPC 尚未就绪',
  [ErrorCodes.SERIALIZATION_ERROR]: '序列化/反序列化失败',
  [ErrorCodes.WINDOW_CLOSED]: '窗口已关闭',
  [ErrorCodes.NO_FRAME_LISTENER]: '未注册帧监听器',
  [ErrorCodes.METHOD_NOT_FOUND]: '未找到 RPC 方法',
  [ErrorCodes.METHOD_ERROR]: 'RPC 方法执行异常',
  [ErrorCodes.DUPLICATE_RPC_ID]: '重复的 rpcId',
  [ErrorCodes.RPC_ID_NOT_FOUND]: '未找到匹配的 rpcId',
  [ErrorCodes.UNKNOWN_FRAME_TYPE]: '未知的帧类型',
  [ErrorCodes.INVALID_FRAME_PAYLOAD]: '帧载荷校验失败',
  [ErrorCodes.FRAME_SEND_FAILED]: '帧发送失败',
}

/**
 * 应用错误类。
 * 携带结构化错误码，支持 IPC 序列化。
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly data?: unknown

  constructor(code: ErrorCode, message?: string, data?: unknown) {
    super(message ?? DEFAULT_MESSAGES[code] ?? '未知错误')
    this.name = 'AppError'
    this.code = code
    this.data = data
  }

  /** 序列化为 IPC 可传输的纯对象。 */
  toJSON(): { code: number; message: string; data?: unknown } {
    return {
      code: this.code,
      message: this.message,
      ...(this.data !== undefined ? { data: this.data } : {}),
    }
  }
}