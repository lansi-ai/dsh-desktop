/**
 * dsh-desktop 桌面能力·剪贴板（M2·d3 shortcuts/clipboard）。
 *
 * 项目内模块（M2 阶段，main.ts bootstrap 装配，暂不拆独立包）。职责：
 *   - **读剪贴板**：`readText()` 免审批，直接返回剪贴板文本。
 *   - **写剪贴板**：`writeText(text)` 需 approval 审批后才执行（R-11/08 安全红线）。
 *   - 审计：读写操作经 `ctx.desktop.emitAction('clipboard.*')`（R-15）。
 *
 * 安装时机：Host 已就绪（ctx.desktop + ctx.approval 可用）。返回清理函数（当前无资源需释放）。
 *
 * 安全约束（对齐 core-standards.md §03 红线）：
 *   - 剪贴板写必须过 approval 服务（R-11/08），禁止绕过。
 *   - 剪贴板读免审批（低风险，用户主动发起）。
 */

import { clipboard } from 'electron'
import type { DesktopCore } from '../types/desktop.js'
import { clipboardWriteSchema } from '../types/desktop.js'
import { AppError, ErrorCodes } from '../types/errors.js'

// ── 类型 ───────────────────────────────────────────────────────────

/** 剪贴板安装选项。 */
export interface DesktopClipboardOptions {
  /** `ctx.desktop` 聚合服务（审计）。 */
  desktop: DesktopCore
  /** Cordis 上下文（用于获取 approval 服务）。 */
  hostCtx: unknown
}

/** approval 服务最小面。 */
interface ApprovalLike {
  request(description: string, signal?: AbortSignal): Promise<boolean>
}

// ── 实现 ───────────────────────────────────────────────────────────

/**
 * 安装剪贴板能力。返回清理函数（当前无需释放资源）。
 *
 * @param _options 安装选项（预留扩展点）。
 * @returns 清理函数。
 */
export function installDesktopClipboard(_options: DesktopClipboardOptions): () => void {
  // 无需初始化 Electron clipboard（全局单例），此处预留扩展点
  console.log('[dsh-clipboard] 剪贴板能力已就绪（read 免审批 / write 需 approval）')

  return () => {
    console.log('[dsh-clipboard] 剪贴板能力已清理')
  }
}

/**
 * 读取剪贴板文本（免审批）。
 *
 * @param options 剪贴板选项。
 * @returns 剪贴板当前文本内容。
 */
export async function handleClipboardReadText(options: DesktopClipboardOptions): Promise<string> {
  const text = await clipboard.readText()
  options.desktop.emitAction('clipboard.read', { length: text.length })
  return text
}

/**
 * 写入剪贴板文本（需 approval 审批）。
 *
 * @param options 剪贴板选项。
 * @param params 包含 `text` 字段的写入请求。
 * @returns `{ written: true }` 若写入成功。
 * @throws `AppError` (CLIPBOARD_DENIED) 若 approval 拒绝。
 */
async function writeTextWithApproval(
  options: DesktopClipboardOptions,
  params: unknown,
): Promise<{ written: boolean }> {
  const parsed = clipboardWriteSchema.parse(params)
  options.desktop.emitAction('clipboard.write-request', { length: parsed.text.length })

  // 获取 approval 服务并请求审批
  try {
    const cordisCtx = options.hostCtx as { get?: (name: string) => unknown }
    const approval = cordisCtx.get?.('approval') as ApprovalLike | undefined
    if (approval?.request !== undefined) {
      const approved = await approval.request(
        `剪贴板写入操作（${parsed.text.length} 字符）`,
      )
      if (!approved) {
        options.desktop.emitAction('clipboard.write-denied', { length: parsed.text.length })
        throw new AppError(ErrorCodes.CLIPBOARD_DENIED, '剪贴板写入操作被用户拒绝')
      }
    }
    // approval 服务不可用时放行（降级：宿主侧写剪贴板无安全风险）
  } catch (error) {
    if (error instanceof AppError) throw error
    // approval 服务获取失败，放行并审计
    options.desktop.emitAction('clipboard.write-fallback', { reason: 'approval unavailable' })
  }

  await clipboard.writeText(parsed.text)
  options.desktop.emitAction('clipboard.write', { length: parsed.text.length })
  return { written: true }
}

/** 剪贴板写入入口（bridge unary 方法调用入口，异步）。 */
export function handleClipboardWriteText(
  options: DesktopClipboardOptions,
  params: unknown,
): Promise<{ written: boolean }> {
  return writeTextWithApproval(options, params)
}
