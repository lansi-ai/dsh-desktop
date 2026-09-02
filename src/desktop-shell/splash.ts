/**
 * 启动闪屏（即时响应反馈层）。
 *
 * 背景：主窗口受 `ready-to-show` 门控，且 `bootDesktopHost()` 插件树装配在
 * 低配机器可达数秒——期间用户「点了没反应」。闪屏在 `app.whenReady()` 后
 * 立即显示（纯静态 HTML，data: URL 零依赖），按启动阶段更新文案；
 * 主窗口首帧（ready-to-show）后销毁接管。
 *
 * 生命周期：仅主进程 bootstrap 期间存在；--hidden 静默驻留托盘时不创建。
 */

import { BrowserWindow, nativeTheme } from 'electron'

import { log } from '../desktop-host/log.js'

/** 闪屏窗口引用（null = 未创建或已销毁）。 */
let splash: BrowserWindow | null = null

/** 闪屏页面（内联静态 HTML：spinner + 应用名 + 进度条 + 阶段文案，随 OS 明暗配色）。 */
function splashHtml(): string {
  const dark = nativeTheme.shouldUseDarkColors
  const bg = dark ? '#1c1c1e' : '#f2f3f5'
  const fg = dark ? '#ececec' : '#1a1a1a'
  const fgDim = dark ? 'rgba(236,236,236,0.18)' : 'rgba(26,26,26,0.15)'
  const accent = '#4d6bfe'
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:${bg};display:grid;place-items:center;
    font-family:'Segoe UI',system-ui,sans-serif;color:${fg};user-select:none;overflow:hidden}
  .wrap{display:flex;flex-direction:column;align-items:center;gap:11px}
  .spin{width:26px;height:26px;border:3px solid ${fgDim};border-top-color:${accent};
    border-radius:50%;animation:s .9s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  .name{font-size:15px;font-weight:600;letter-spacing:.4px}
  .bar{width:200px;height:4px;border-radius:2px;background:${fgDim};overflow:hidden}
  .fill{height:100%;width:0%;border-radius:2px;background:${accent};transition:width .25s ease}
  .phase{font-size:12px;opacity:.6;min-height:15px}
  .progress{font-size:11px;opacity:.5;min-height:14px;max-width:240px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  </style></head><body><div class="wrap">
  <div class="spin"></div><div class="name">DSH Desktop</div>
  <div class="bar"><div class="fill" id="fill"></div></div>
  <div class="phase" id="phase">正在启动…</div>
  <div class="progress" id="progress"></div>
  </div></body></html>`
}

/** 创建并显示启动闪屏（重复调用忽略；bootstrap 早期调用，给用户即时反馈）。 */
export function createStartupSplash(): void {
  if (splash !== null) return
  splash = new BrowserWindow({
    width: 360,
    height: 220,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    // 先隐藏，ready-to-show（首帧 paint 完成）后再显示——立即 show 会先闪一帧
    // 空白底色（data: URL 内容尚未 paint），观感差。
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f2f3f5',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  splash.setMenuBarVisibility(false)
  splash.on('closed', () => { splash = null })
  splash.once('ready-to-show', () => {
    if (splash !== null && !splash.isDestroyed()) splash.show()
  })
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`).catch(() => {})
  log.info('[splash] 启动闪屏已显示')
}

/** 更新闪屏阶段文案（闪屏未创建时静默忽略）。 */
export function splashPhase(text: string): void {
  if (splash === null || splash.isDestroyed()) return
  // IIFE 包裹：executeJavaScript 多次执行共享页面全局词法作用域，顶层 const
  // 会在第二次执行时报 "already been declared" 被静默吞掉（坑：进度只动一格）。
  const snippet = `(() => { const el = document.getElementById('phase'); if (el) el.textContent = ${JSON.stringify(text)} })()`
  void splash.webContents.executeJavaScript(snippet).catch(() => {})
}

/** 插件树装配进度（boot.ts onProgress 回调 → 闪屏进度条）。 */
export interface SplashProgress {
  /** 已完成激活的条目数（含 disabled）。 */
  readonly active: number
  /** 当前已发现的条目总数。 */
  readonly total: number
  /** 正在挂载的插件名（空串表示无）。 */
  readonly current: string
}

/** 更新闪屏装配进度条与明细文案（闪屏未创建时静默忽略）。 */
export function splashProgress(progress: SplashProgress): void {
  if (splash === null || splash.isDestroyed()) return
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.active / progress.total) * 100)) : 0
  const detail = progress.current !== '' ? ` · ${progress.current}` : ''
  const text = `装配插件 ${progress.active}/${progress.total}${detail}`
  // IIFE 隔离作用域（同 splashPhase：防顶层 const 重复声明静默失败）。
  const snippet =
    `(() => {` +
    `const f = document.getElementById('fill'); if (f) f.style.width = '${pct}%';` +
    `const p = document.getElementById('progress'); if (p) p.textContent = ${JSON.stringify(text)}` +
    `})()`
  void splash.webContents.executeJavaScript(snippet).catch(() => {})
}

/** 销毁闪屏（主窗口首帧后接管；未创建/已销毁时静默忽略）。 */
export function closeStartupSplash(): void {
  if (splash === null) return
  if (!splash.isDestroyed()) splash.destroy()
  splash = null
}

// ── 模拟进度演示（调试用）──────────────────────────────────────────────────
// 背景：正常机器插件树装配仅 1-3 秒，真实进度条一晃而过难以观察动效。
// `DSH_SPLASH_DEMO=1` 时以固定步进慢放进度（复用 splashProgress 真实渲染路径），
// 仅影响闪屏显示，不触碰装配逻辑；须配合 DSH_STARTUP_DELAY_MS 拉长装配期，
// 否则主窗口首帧会提前销毁闪屏、演示被截断。

/** 演示总条目数（对齐真实图谱 ~54 条）。 */
const DEMO_TOTAL = 54

/** 演示用的插件名样本（循环取用，观感对齐真实明细行）。 */
const DEMO_NAMES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-api-settings-controller',
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-agent-presets',
  '@deepseek-ai/dsh-client-ui-theme',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-host-directory-picker',
  '@lansi-ai/dsh-desktop-layout',
  '@lansi-ai/dsh-desktop-titlebar',
]

/** 启动模拟进度演示（每 400ms 前进一格，54 格 ≈ 21.6s；闪屏销毁即停）。 */
export function startSplashDemo(): void {
  let active = 0
  const timer = setInterval(() => {
    if (splash === null || splash.isDestroyed()) {
      clearInterval(timer)
      return
    }
    active++
    splashProgress({
      active,
      total: DEMO_TOTAL,
      current: (DEMO_NAMES[active % DEMO_NAMES.length] ?? ''),
    })
    if (active >= DEMO_TOTAL) clearInterval(timer)
  }, 400)
  timer.unref?.()
}
