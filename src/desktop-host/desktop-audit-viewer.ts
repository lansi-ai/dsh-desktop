/**
 * dsh-desktop 会话审计查询服务（M3-b2 audit viewer）。
 *
 * 职责：
 *   - 读取 audit.jsonl 审计日志文件
 *   - 支持按动作名/会话 ID/时间范围过滤
 *   - 支持分页查询
 *   - 通过 bridge 方法 `desktop.audit.query` 供 renderer 调用
 *
 * 数据源：`desktop-api.ts` 的 `log()` 方法写入的 JSONL 文件
 * （每行一条 JSON 记录，含 ts/action/payload 字段）。
 */

import { readFile } from 'node:fs/promises'
import {
  auditQuerySchema,
  auditQueryResultSchema,
  auditLogEntrySchema,
  type AuditQuery,
  type AuditQueryResult,
  type AuditLogEntry,
} from '../types/desktop.js'
import { registerMethod, unregisterMethod } from './bridge.js'
import { log } from './log.js'

// ── 选项 ────────────────────────────────────────────────────────────

/** 审计查看器安装选项。 */
export interface DesktopAuditViewerOptions {
  /** 审计日志文件路径（JSONL）。 */
  getAuditLogPath(): string
  /** `ctx.desktop` 聚合服务。 */
  // desktop: DesktopCore // 暂不需要写审计
}

// ── 实现 ─────────────────────────────────────────────────────────────

/**
 * 读取并解析 audit.jsonl 文件（完整读入，按行解析 JSON）。
 * 文件不存在或为空时返回空数组。
 */
async function readAuditLog(filePath: string): Promise<AuditLogEntry[]> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim().length > 0)
    const entries: AuditLogEntry[] = []
    for (const line of lines) {
      try {
        const raw = JSON.parse(line)
        const parsed = auditLogEntrySchema.safeParse(raw)
        if (parsed.success) {
          entries.push(parsed.data)
        }
      } catch {
        // 跳过损坏行
      }
    }
    return entries
  } catch {
    // 文件不存在或读取失败
    return []
  }
}

/**
 * 过滤审计条目。
 */
function filterEntries(entries: AuditLogEntry[], query: AuditQuery): AuditLogEntry[] {
  return entries.filter((entry) => {
    // 按动作名过滤
    if (query.action !== undefined && entry.action !== query.action) {
      return false
    }
    // 按会话 ID 过滤（在 payload.sessionId 中查找）
    if (query.sessionId !== undefined) {
      const payload = entry.payload as Record<string, unknown> | undefined
      const payloadSessionId = payload?.sessionId as string | undefined
      if (payloadSessionId !== query.sessionId) {
        return false
      }
    }
    // 按时间范围过滤
    if (query.from !== undefined && entry.ts < query.from) {
      return false
    }
    if (query.to !== undefined && entry.ts > query.to) {
      return false
    }
    return true
  })
}

/**
 * 执行审计查询。
 */
async function executeQuery(
  query: AuditQuery,
  getAuditLogPath: () => string,
): Promise<AuditQueryResult> {
  const filePath = getAuditLogPath()
  const allEntries = await readAuditLog(filePath)

  // 过滤
  const filtered = filterEntries(allEntries, query)

  // 按时间倒序排列（最新在前）
  const sorted = [...filtered].sort((a, b) => b.ts - a.ts)

  // 分页
  const total = sorted.length
  const paged = sorted.slice(query.offset, query.offset + query.limit)

  return auditQueryResultSchema.parse({
    entries: paged,
    total,
    query,
  })
}

/**
 * 安装审计查询服务（注册 bridge 方法）。
 *
 * @param options 安装选项。
 * @returns 清理函数。
 */
export function installDesktopAuditViewer(
  options: DesktopAuditViewerOptions,
): () => void {
  /** 查询处理器。 */
  const handleQuery = async (params: unknown): Promise<AuditQueryResult> => {
    const parsed = auditQuerySchema.parse(params)
    return await executeQuery(parsed, options.getAuditLogPath)
  }

  /** 获取所有不重复的动作名列表。 */
  const handleListActions = async (): Promise<string[]> => {
    const filePath = options.getAuditLogPath()
    const entries = await readAuditLog(filePath)
    const actions = new Set<string>()
    for (const entry of entries) {
      actions.add(entry.action)
    }
    return Array.from(actions).sort()
  }

  registerMethod('desktop.audit.query', handleQuery)
  registerMethod('desktop.audit.listActions', handleListActions)

  log.ok('[dsh-audit-viewer] 审计查询服务已安装')

  return () => {
    unregisterMethod('desktop.audit.query')
    unregisterMethod('desktop.audit.listActions')
    log.info('[dsh-audit-viewer] 审计查询服务已清理')
  }
}
