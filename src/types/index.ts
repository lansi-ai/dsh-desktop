/**
 * dsh-desktop 共享类型出口（Step 4·IPC 载波四件套）。
 *
 * 集中导出 zod 契约、通道常量、AppError 错误码表，供宿主端桥、preload 脚本、
 * manifest 覆盖等模块复用。
 */

export { IPC_CHANNELS } from './channels.js'
export type { IpcChannel } from './channels.js'

export {
  rpcIdSchema,
  rpcRequestSchema,
  rpcSuccessSchema,
  rpcErrorSchema,
  rpcResponseSchema,
  FrameType,
  frameTypeSchema,
  frameSchema,
  clientResponseSchema,
  readyNotificationSchema,
} from './contract.js'

export type {
  RpcRequest,
  RpcSuccess,
  RpcError,
  RpcResponse,
  FrameType as FrameTypeAlias,
  Frame,
  ClientResponse,
  ReadyNotification,
} from './contract.js'

export { ErrorCodes, AppError } from './errors.js'
export type { ErrorCode } from './errors.js'

export { bootEntrySchema, bootGraphSchema } from './boot.js'
export type { BootEntry, BootGraph } from './boot.js'

export {
  desktopActionSchema,
  desktopActionEventSchema,
  desktopEventSchema,
} from './desktop.js'
export type {
  DesktopAction,
  DesktopActionEvent,
  DesktopCore,
  DesktopEvent,
} from './desktop.js'