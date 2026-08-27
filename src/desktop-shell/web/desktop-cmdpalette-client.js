/**
 * @dsh-desktop/desktop-cmdpalette —— 命令面板 renderer 注入（M3·a4 命令面板）。
 *
 * ⏸️ 功能暂停（2026-08-27 用户决策）：本文件整体禁用——Ctrl+K 面板不再注册，
 * factory 直接返回空插件（apply 为空操作），恢复功能时 revert 本文件的禁用壳即可。
 * 历史背景：假 slot `app.overlay`（坑 13）→ 纯 DOM 浮层；数据源/导航（坑 14）；
 * exports.inject 服务等待 PENDING（坑 15）。恢复路径见 active-context.md M3-a4 节。
 *
 * 下行事件监听保留最小集：quick-ask（Ctrl+Shift+P 快速提问聚焦输入框，独立功能不受暂停影响）。
 */
/* global Event */
window.__ModuleLoader__.load({
  id: '@dsh-desktop/desktop-cmdpalette',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports

    /** 快速提问：关闭后聚焦聊天输入框（Ctrl+Shift+P 依赖，保留）。 */
    function focusComposer(question) {
      try {
        const selectors = [
          'textarea[placeholder*="输入"]',
          'textarea[placeholder*="message"]',
          'textarea[placeholder*="提问"]',
          '[contenteditable="true"]',
          'textarea',
        ]
        for (const sel of selectors) {
          const el = document.querySelector(sel)
          if (el) {
            el.focus()
            if (question) {
              const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLElement.prototype
              const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')
              if (nativeSetter?.set) {
                nativeSetter.set.call(el, question)
                el.dispatchEvent(new Event('input', { bubbles: true }))
              }
            }
            break
          }
        }
      } catch { /* 聚焦失败 */ }
    }

    exports.apply = () => {
      // 最小监听：仅 quick-ask 下行事件（快速提问窗口预填），面板相关全部禁用
      const bridge = window.desktopBridge
      let cleanupDesktopEvents = () => {}
      if (bridge?.onDesktopEvent) {
        const off = bridge.onDesktopEvent((event) => {
          if (event?.action === 'quick-ask') focusComposer(event?.payload?.question || '')
        })
        cleanupDesktopEvents = off
      }

      exports.__cleanup = () => {
        cleanupDesktopEvents?.()
      }

      console.log('[dsh-cmdpalette] 命令面板已禁用（仅保留快速提问输入聚焦）')
    }

    return module.exports
  },
})

