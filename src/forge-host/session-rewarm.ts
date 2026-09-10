/**
 * 持久化会话预热（冷会话重挂载）。
 *
 * 背景：`session.list` 会把持久化的冷会话列入清单（summarizeCold），客户端
 * connectWorkspace 会直接复用清单中的 blank session 而不再发起 session.create；
 但冷会话在 Host 侧没有 live agent，session-scoped 方法（skill.list / cancel 等）
 * 直接 `ctx.agents.get()` 报 "session not found (not attached)"。
 *
 * 上游唯一的重挂载入口是 `session.create` 携带已有 sessionId
 * （ensureSession → checkPersistedIdentity → agents.resume）。本模块在 Host
 * 启动后遍历 `session.list`，对每个带 cwd 的非 subagent 会话执行一次
 * `session.create { sessionId, cwd }`，使清单中的会话全部处于可交互状态。
 */

import { z } from 'zod'

import { log } from './log.js'

/** session.list 响应中本模块关心的字段（宽容校验：未知字段放行）。 */
const sessionSummarySchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().min(1).optional(),
  origin: z.literal('subagent').optional(),
})

const sessionListValueSchema = z.object({
  items: z.array(sessionSummarySchema).default([]),
})

/** 单会话挂载超时：低配机器挂载可达秒级，超时按失败计（告警），不拖死整体预热。 */
const REWARM_TIMEOUT_MS = 10_000

/** 给 Promise 套超时壳（超时即 reject，底层调用不取消，由 host 侧自然结束）。 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

/** host 侧 RPC 调用入口（复用 apiProxy 的 toFetchHandler 通路）。 */
export type ApiRpcCaller = (method: string, params: unknown) => Promise<unknown>

/**
 * 预热所有持久化会话。
 *
 * 失败策略：单会话失败（如 cwd 冲突 / subagent ownership fence）只告警不中断；
 * 整体失败（如 session.list 不可用）同样仅告警——预热是尽力而为的加速层，
 * session.prompt 等经 agentFor 的方法仍可懒恢复。
 */
// 0.1.2 端点 wire 契约：`session.list` 参数名 `_request`（保留空参数占位）、
// `session.create` 参数名 `request`（内放 { sessionId, cwd }）。缺参数名会被
// typert gateway 判 "args fields do not match the descriptor: missing ..."。
export async function rewarmPersistedSessions(call: ApiRpcCaller): Promise<void> {
  try {
    const parsed = sessionListValueSchema.safeParse(await call('session.list', { _request: {} }))
    if (!parsed.success) {
      log.warn('[session-rewarm] session.list 响应格式无效，跳过预热:', parsed.error.issues[0]?.message)
      return
    }
    const candidates = parsed.data.items.filter((s) => s.cwd !== undefined && s.origin !== 'subagent')
    if (candidates.length === 0) return

    const results = await Promise.allSettled(
      candidates.map((s) =>
        withTimeout(
          call('session.create', { request: { sessionId: s.sessionId, cwd: s.cwd } }),
          REWARM_TIMEOUT_MS,
          `会话 ${s.sessionId} 挂载`,
        ),
      ),
    )
    const failed = results.filter((r) => r.status === 'rejected')
    log.ok(`[session-rewarm] 持久化会话预热完成: ${candidates.length - failed.length}/${candidates.length} 个已挂载`)
    for (const f of failed) {
      log.warn('[session-rewarm] 会话挂载失败:', f.reason instanceof Error ? f.reason.message : String(f.reason))
    }
  } catch (error) {
    log.warn('[session-rewarm] 预热中断（不影响启动）:', error instanceof Error ? error.message : String(error))
  }
}
