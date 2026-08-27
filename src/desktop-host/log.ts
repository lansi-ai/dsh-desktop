/**
 * 终端降噪工具。
 *
 * 背景：热路径日志（每个 RPC / 每个协议资源请求 / 每条审计动作）全量打印导致终端刷屏，
 * 现默认静默，设环境变量 DSH_VERBOSE=1 时恢复输出，便于排障。
 * 启动一次性日志、warn/error、审计落盘均不受影响。
 */

const VERBOSE = process.env.DSH_VERBOSE === '1'

/** 是否开启 verbose 终端输出。 */
export function isVerbose(): boolean {
  return VERBOSE
}

/** 高频热路径日志：仅在 DSH_VERBOSE=1 时打印（带统一 [prefix] 标签）。 */
export function logVerbose(prefix: string, ...args: unknown[]): void {
  if (VERBOSE) console.log(`[${prefix}]`, ...args)
}
