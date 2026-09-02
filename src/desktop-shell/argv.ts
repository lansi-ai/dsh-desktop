/**
 * dsh-desktop 启动参数解析（Step 6·零端口验证 + --serve 兼容模式）。
 *
 * 对齐 docs/07-desktop-shell.md §2 的启动参数规范：
 *   - --serve[=<port>]    启动兼容 webserver（loopback，默认 38000），供旧插件
 *                         「HTTP 原义」路由（如 dsh-terminal /terminal/stream）使用。
 *                         默认模式（不传 --serve）= 零端口 IPC 载波模式（红线 R-03）。
 *
 * 仅识别 dsh-desktop 自有的少量参数，其他参数（--profile / --user-data-dir 等）
 * 留给上游解析器，不做二次处理。
 */

/** 解析后的启动选项。 */
export interface CliOptions {
  /** 是否启用 --serve 兼容模式（默认 false = 零端口 IPC 载波模式）。 */
  serve: boolean
  /** --serve 监听端口（仅当 serve=true 时有意义）。默认 38000。 */
  servePort: number
  /** 是否静默启动（--hidden，开机自启登录后驻留托盘，不弹主窗口）。 */
  hidden: boolean
  /**
   * 是否重新选择数据目录（--select-data-dir，M4-a4）。
   * 强制弹出首启数据目录窗口（已有选择时预选当前目录，迁移源 = 当前在用目录）。
   */
  selectDataDir: boolean
}

/** --serve 默认端口：Loopback 范围高位，避免与常用服务冲突。 */
export const DEFAULT_SERVE_PORT = 38000

/**
 * 解析 process.argv（去除前两项 node / script）。
 *
 * 支持两种形式：
 *   - `--serve`（无值 → 使用默认端口）
 *   - `--serve=38080`（等号形式）
 *   - `--serve 38080`（空格 + 位置值，兼容写法）
 *
 * @param argv 原始 argv（默认取 process.argv）。
 * @returns 解析后的 CLI 选项。
 */
export function parseArgv(argv: string[] = process.argv): CliOptions {
  const rest = argv.slice(2) // 跳过 node + script
  let serve = false
  let servePort = DEFAULT_SERVE_PORT
  let hidden = false
  let selectDataDir = false
  let i = 0
  while (i < rest.length) {
    const arg = rest[i]
    if (arg === '--hidden') {
      hidden = true
    } else if (arg === '--select-data-dir') {
      selectDataDir = true
    } else if (arg === '--serve') {
      serve = true
      const next = rest[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        const parsed = Number.parseInt(next, 10)
        if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
          servePort = parsed
          i += 1
        }
      }
    } else if (arg.startsWith('--serve=')) {
      serve = true
      const value = arg.slice('--serve='.length)
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
        servePort = parsed
      }
    }
    i += 1
  }
  return { serve, servePort, hidden, selectDataDir }
}
