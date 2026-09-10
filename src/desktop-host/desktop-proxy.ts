/**
 * dsh-desktop 网络代理设置（Chromium 网络栈 · 三态 direct / system / manual）。
 *
 * 覆盖范围（与用户确认的「方案 A」边界）：
 *   - `session.defaultSession` —— 渲染进程 / 协议层发出的真实 HTTP；
 *   - `electron-updater` 独立分区 —— 应用更新的探测与下载。
 * **不覆盖**走 Node 栈的请求（官方 Host 侧的模型 API 调用不在本设置范围内），
 * UI 需如实标注该边界，避免「设了代理但模型仍连不上」的误判。
 *
 * 关键约束：electron-updater 的 HTTP 走**独立 session 分区**
 * （`NET_SESSION_NAME = 'electron-updater'`，见 electron-updater/out/electronHttpExecutor.js
 * 的 `getNetSession()`），只设 defaultSession 对它无效 → 必须对该分区单独 `setProxy`，
 * 否则「检查更新」仍走直连。分区 options 与该文件保持一致（`cache: false`）以命中同一实例。
 *
 * `session.setProxy` 对新请求立即生效、无需重启；配置真源在主进程（settings `desktop`
 * 命名空间，字符串值域），装配时按持久化值 apply 一次。配置写入经 `desktop.writeConfig`
 * 自动落 `config.write` 审计。
 *
 * 由 main.ts bootstrap 装配。无监听器/定时器，session 随进程销毁，故无需 dispose。
 */

import { session } from 'electron'
import type { Session } from 'electron'
import type { DesktopCore } from '../types/desktop.js'
import { log } from './log.js'

// ── 类型 ───────────────────────────────────────────────────────────

/** 代理模式三态（与 UI 分段控件一一对应）。 */
export type ProxyMode = 'direct' | 'system' | 'manual'

/** `session.setProxy` 配置类型（由 Electron 签名推导，不手写平行类型）。 */
type ProxyConfig = Parameters<Session['setProxy']>[0]

/** 代理设置快照（UI 读写）。 */
export interface ProxyState {
  /** 当前生效模式。 */
  mode: ProxyMode
  /** 手动模式的**原始输入**（非 manual 时为空串；用于输入框回显）。 */
  rules: string
  /** 最近一次应用是否全部 session 成功。 */
  applied: boolean
  /** 失败原因（applied=false 时有值）。 */
  error?: string
}

/** 装配选项。 */
export interface DesktopProxyOptions {
  /** `ctx.desktop` 聚合服务（配置读写 + 审计；可为空）。 */
  desktop?: DesktopCore | null
}

/** 代理设置句柄。 */
export interface DesktopProxyHandle {
  /** 读取当前设置快照。 */
  getState(): ProxyState
  /** 应用一组设置：校验 → 逐 session setProxy → 全部成功才持久化。 */
  apply(mode: ProxyMode, rules?: string): Promise<{ ok: boolean; message?: string }>
}

// ── 常量 ───────────────────────────────────────────────────────────

const TAG = '[dsh-network]'
const KEY_MODE = 'proxyMode'
const KEY_RULES = 'proxyRules'

/** 默认模式 system：与 Chromium 原生默认一致，不改变存量行为。 */
const DEFAULT_MODE: ProxyMode = 'system'

/** 手动代理地址：`host:port` 或 `<scheme>://host:port`。 */
const RULES_RE = /^(?:([a-z0-9]+):\/\/)?[A-Za-z0-9._-]+:\d{1,5}$/

/** 允许的代理 scheme（Chromium proxyRules 支持集）。 */
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'socks4', 'socks5'])

/**
 * 需额外应用代理的 session 分区。
 * options 与 electron-updater `getNetSession()` 对齐（`cache: false`）。
 */
const EXTRA_PARTITIONS: ReadonlyArray<{ name: string; options: { cache: boolean } }> = [
  { name: 'electron-updater', options: { cache: false } },
]

// ── 实现 ───────────────────────────────────────────────────────────

/**
 * 校验并归一化手动代理地址。
 *
 * @param raw 原始输入。
 * @returns Chromium proxyRules；非法返回 null。
 */
function normalizeRules(raw: string): string | null {
  const value = raw.trim()
  const matched = RULES_RE.exec(value)
  if (matched === null) return null
  const scheme = matched[1]
  if (scheme !== undefined && !ALLOWED_SCHEMES.has(scheme)) return null
  // 裸 host:port 归一为「http/https 同址」显式规则；带 scheme 原样透传
  // （Chromium 单代理 URI 形式；socks5:// 会作用于全部 scheme）。
  return scheme === undefined ? `http=${value};https=${value}` : value
}

/** 归一化规则 → electron setProxy 配置。 */
function toConfig(mode: ProxyMode, proxyRules: string): ProxyConfig {
  if (mode === 'direct') return { mode: 'direct' }
  if (mode === 'system') return { mode: 'system' }
  return { mode: 'fixed_servers', proxyRules }
}

/**
 * 对默认会话与附加分区逐个 setProxy。
 *
 * @returns 首个错误信息；全部成功返回 null（单个失败不阻断其余 session）。
 */
async function applyToSessions(config: ProxyConfig): Promise<string | null> {
  const targets: ReadonlyArray<{ name: string; sess: Session }> = [
    { name: 'default', sess: session.defaultSession },
    ...EXTRA_PARTITIONS.map((part) => ({
      name: part.name,
      sess: session.fromPartition(part.name, part.options),
    })),
  ]
  let firstError: string | null = null
  for (const target of targets) {
    try {
      await target.sess.setProxy(config)
    } catch (error) {
      if (firstError === null) firstError = error instanceof Error ? error.message : String(error)
      log.warn(`${TAG} ${target.name} 会话代理设置失败:`, error)
    }
  }
  return firstError
}

/**
 * 装配网络代理设置。
 *
 * @param options 装配选项。
 */
export function installDesktopProxy(options: DesktopProxyOptions): DesktopProxyHandle {
  const { desktop } = options

  // 读持久化值：模式走白名单校验；手动地址非法（被外部改坏）时退回默认，避免开机即断网
  const rawMode = desktop?.readConfig<string>(KEY_MODE)
  const persistedMode: ProxyMode =
    rawMode === 'direct' || rawMode === 'system' || rawMode === 'manual' ? rawMode : DEFAULT_MODE
  const persistedRules = (desktop?.readConfig<string>(KEY_RULES) ?? '').trim()
  const persistedNormalized = persistedMode === 'manual' ? normalizeRules(persistedRules) : null
  const startMode: ProxyMode =
    persistedMode === 'manual' && persistedNormalized === null ? DEFAULT_MODE : persistedMode

  // state.rules 存原始输入（供输入框回显）；实际下发用归一化后的 proxyRules
  const state: ProxyState = {
    mode: startMode,
    rules: startMode === 'manual' ? persistedRules : '',
    applied: false,
  }

  /** 逐 session 生效并更新快照；全部成功才持久化。 */
  const applyInternal = async (
    mode: ProxyMode,
    rawRules: string,
    proxyRules: string,
  ): Promise<{ ok: boolean; message?: string }> => {
    const error = await applyToSessions(toConfig(mode, proxyRules))
    state.applied = error === null
    if (error === null) {
      delete state.error
      state.mode = mode
      state.rules = mode === 'manual' ? rawRules.trim() : ''
      desktop?.writeConfig(KEY_MODE, mode)
      desktop?.writeConfig(KEY_RULES, state.rules)
      log.ok(`${TAG} 代理已生效: ${mode}${mode === 'manual' ? ` (${proxyRules})` : ''}`)
      return { ok: true }
    }
    // 失败不动 mode/rules（保持最后一次生效值），仅置错误供 UI 提示
    state.error = error
    log.error(`${TAG} 代理应用失败:`, error)
    return { ok: false, message: `代理设置失败：${error}` }
  }

  /** 校验 + 应用。 */
  const apply = async (mode: ProxyMode, rules?: string): Promise<{ ok: boolean; message?: string }> => {
    if (mode !== 'manual') return applyInternal(mode, '', '')
    const normalized = normalizeRules(rules ?? '')
    if (normalized === null) {
      return { ok: false, message: '代理地址格式无效（示例：127.0.0.1:7890 或 socks5://127.0.0.1:7890）' }
    }
    return applyInternal(mode, rules ?? '', normalized)
  }

  // 装配即按持久化值生效；失败不阻断启动（仅记录 + 置 error 供 UI 显示）
  void applyInternal(startMode, state.rules, persistedNormalized ?? '')

  return { getState: () => ({ ...state }), apply }
}
