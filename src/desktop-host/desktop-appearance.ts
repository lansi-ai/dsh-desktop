/**
 * dsh-desktop 骨架外观服务（宿主面 · 职责专一）。
 *
 * 目标：宿主骨架（html/body/#root 托盘色、主卡片圆角、四周边距）由宿主唯一定义，
 * 值经 CSS 变量（`--dsd-*`）暴露为「外观契约」；二开者想改骨架样式，无需修改
 * 宿主源码，经两种途径覆盖：
 *   1. 配置文件（patch / settings 注水管线）—— 注入优先级次高；
 *   2. 二开 client 插件（外观插件）—— 注入最晚，覆盖优先级最高。
 *
 * 三层优先级（注入时机从早到晚）：
 *   ① HTML 首帧骨架默认值（boot-graph LAYOUT_SKELETON_CSS 的 :root 变量默认）
 *   ② 本模块在 did-finish-load 后按配置注入 :root 变量
 *   ③ 二开插件在 apply() 内注入 :root（最晚，去覆盖）
 *
 * 注：本模块只写 :root 变量，不改任何 DOM/官方样式；骨架规则统一在宿主
 *   LAYOUT_SKELETON_CSS 引用这些变量。页面加载后逐窗口注入（多窗口一致）。
 */

import type { BrowserWindow } from 'electron'

import { log } from './log.js'

/** 骨架外观契约：宿主暴露的可覆盖变量名（二开文档即此清单）。 */
export const APPEARANCE_VARS = {
  trayBg: '--dsd-tray-bg',
  cardRadius: '--dsd-card-radius',
  frameGap: '--dsd-frame-gap',
  titlebarH: '--dsd-titlebar-h',
} as const

/** 骨架外观配置（来自 patch / 配置源）。 */
export interface AppearanceConfig {
  /** 托盘底色（css 颜色值，如 rgb(242 243 245) / #1e293b）。 */
  trayBg?: string
  /** 主卡片圆角（px）。 */
  cardRadius?: number | string
  /** 主卡片相对托盘的四周边距（px）。 */
  frameGap?: number | string
  /** 顶部标题栏高度（px，主卡片 top 让位基准）。 */
  titlebarH?: number | string
}

/** 外观服务安装选项。 */
export interface DesktopAppearanceOptions {
  /** 外部配置源（patch / settings 提供的骨架外观值）；缺省用宿主默认。 */
  config?: AppearanceConfig
}

/** 安装后返回的句柄（main.ts 用）。 */
export interface DesktopAppearanceHandle {
  /** 给指定窗口附加外观注入（每个窗口创建后调用一次）。 */
  attach: (win: BrowserWindow) => void
  /** 清理所有窗口监听。 */
  dispose: () => void
}

/** 合并宿主默认值 + 配置源（缺省项回落默认，保证骨架始终可用）。 */
function resolveVars(cfg: AppearanceConfig = {}): Record<string, string> {
  // 长度类变量必须带单位，否则在 height/border-radius/padding 处 var() 解析为非法值，
  // 会回退为初始值（如 height:auto），导致标题栏/按钮被内容高度撑小（实机 2026-08-28）。
  const px = (v: number | string | undefined): string => (typeof v === 'number' ? `${v}px` : String(v))
  return {
    // light-dark() 双值：随 presenter 设定的根 color-scheme 明暗自动切换
    // （与 boot-graph LAYOUT_SKELETON_CSS 的 :root 默认值保持同源）。
    [APPEARANCE_VARS.trayBg]: cfg.trayBg ?? 'light-dark(rgb(242 243 245),rgb(28 28 30))',
    [APPEARANCE_VARS.cardRadius]: px(cfg.cardRadius ?? 12),
    [APPEARANCE_VARS.frameGap]: px(cfg.frameGap ?? 15),
    [APPEARANCE_VARS.titlebarH]: px(cfg.titlebarH ?? 50),
  }
}

/** 将外观变量注入页面 :root（幂等：先清理旧的再写，重复加载不叠加）。 */
function injectAppearanceVars(win: BrowserWindow, vars: Record<string, string>): void {
  const wc = win.webContents
  if (wc.isDestroyed()) return
  const declarations = Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
  const js = `(() => {
  try {
    const styleId = 'dsh-desktop-appearance-vars'
    document.getElementById(styleId)?.remove()
    const inline = document.createElement('style')
    inline.id = styleId
    // 官方 UI 的动态样式表晚于本 style 注入时可能覆盖 :root 变量，
    // 用 html:root 提特异性 + !important 压过（抗官方运行时覆盖）。
    inline.textContent = 'html:root{' + ${JSON.stringify(declarations)} + '}'
    document.head.appendChild(inline)
  } catch (err) { console.error('[dsh-appearance] inject failed:', err) }
})()`
  wc.executeJavaScript(js).catch((error) => {
    log.error('[dsh-appearance] executeJavaScript failed:', error)
  })
}

/**
 * 安装骨架外观服务。
 *
 * @param options 安装选项。
 * @returns { attach, dispose } 句柄。
 */
export function installDesktopAppearance(options: DesktopAppearanceOptions = {}): DesktopAppearanceHandle {
  const vars = resolveVars(options.config)

  const listeners = new Map<BrowserWindow, () => void>()

  const attach = (win: BrowserWindow): void => {
    const handler = (): void => injectAppearanceVars(win, vars)
    win.webContents.on('did-finish-load', handler)
    listeners.set(win, () => {
      win.webContents.removeListener('did-finish-load', handler)
    })
    // 已加载完成的窗口（如窗口恢复路径）立即注入一次
    if (win.webContents.getURL() !== '') injectAppearanceVars(win, vars)
  }

  const dispose = (): void => {
    for (const cleanup of listeners.values()) cleanup()
    listeners.clear()
  }

  return { attach, dispose }
}
