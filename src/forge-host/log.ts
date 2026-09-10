/**
 * 统一终端日志器。
 *
 * 格式：`HH:mm:ss [tag] message`
 * - 时间戳暗灰、tag 高亮青色加粗、消息按级别着色（info 默认 / ok 绿 / warn 黄 / error 红）
 * - 首参若以 `[tag]` 开头则自动解析并着色，剩余原样透传（对象、Error 交由 console inspect）
 * - 颜色仅在 TTY 且未设 NO_COLOR 时启用，管道/重定向自动降级为纯文本
 * - 降噪策略不变：热路径日志需 DSH_VERBOSE=1（logVerbose / isVerbose）
 */

const VERBOSE = process.env.DSH_VERBOSE === '1'
const USE_COLOR = Boolean(process.stdout?.isTTY) && !process.env.NO_COLOR

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
} as const

type Level = 'info' | 'ok' | 'warn' | 'error'

const LEVEL_COLOR: Record<Level, string | null> = {
  info: null,
  ok: C.green,
  warn: C.yellow,
  error: C.red,
}

function paint(code: string, text: string): string {
  return USE_COLOR ? `${code}${text}${C.reset}` : text
}

/** 本地时间 HH:mm:ss（暗灰）。 */
function timestamp(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return paint(C.dim, `${hh}:${mm}:${ss}`)
}

/** tag 列宽（按最长 tag [dsh-cordis-inventory] 对齐，消息列起始位置固定）。 */
const TAG_COLUMN_WIDTH = 24

/** 解析首参中的 [tag] 前缀，返回 [着色 tag, 剩余消息]；无 tag 时返回 null。 */
function splitTag(first: string): [string, string] | null {
  const m = /^\[([^\]\n]+)\]\s?/.exec(first)
  if (!m) return null
  const tag = paint(`${C.bold}${C.cyan}`, `[${m[1]}]`).padEnd(TAG_COLUMN_WIDTH)
  return [tag, first.slice(m[0].length)]
}

function emit(level: Level, args: unknown[]): void {
  const stream =
    level === 'warn' ? console.warn : level === 'error' ? console.error : console.log
  const parts: unknown[] = [timestamp()]
  let rest = args

  const first = args[0]
  if (typeof first === 'string') {
    const parsed = splitTag(first)
    if (parsed) {
      parts.push(parsed[0])
      rest = [parsed[1], ...args.slice(1)]
    }
  }

  const color = LEVEL_COLOR[level]
  if (level === 'ok') parts.push(paint(C.green, '✔'))
  const colored = color
    ? rest.map((a) => (typeof a === 'string' ? paint(color, a) : a))
    : rest

  stream(...parts, ...colored)
}

/** 是否开启 verbose 终端输出。 */
export function isVerbose(): boolean {
  return VERBOSE
}

/** 阶段分隔头：空行 + `──── 标题 ────`（横线暗灰、标题加粗），用于启动日志分节。 */
function phase(title: string): void {
  const rule = paint(C.dim, '─────────')
  console.log('')
  console.log(`${rule} ${paint(C.bold, title)} ${rule}`)
}

/** 高频热路径日志：仅在 DSH_VERBOSE=1 时打印（带统一 [prefix] 标签）。 */
export function logVerbose(prefix: string, ...args: unknown[]): void {
  if (VERBOSE) emit('info', [`[${prefix}]`, ...args])
}

/** 统一日志出口：log.info / log.ok / log.warn / log.error / log.phase。 */
export const log = {
  info: (...args: unknown[]) => emit('info', args),
  ok: (...args: unknown[]) => emit('ok', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
  phase,
}
