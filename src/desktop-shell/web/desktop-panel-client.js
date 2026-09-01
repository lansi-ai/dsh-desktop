/**
 * @lansi-ai/dsh-desktop-panel —— 桌面面板容器注入（M2·e 官方 UI 注入）。
 *
 * 通过官方 Cordis Slots 机制向侧边栏底部注册「桌面面板」触发按钮，
 * 点击后打开桌面功能面板（悬浮模态框，显示快捷键/剪贴板等桌面能力入口）。
 *
 * 面板使用纯 DOM 实现（不依赖 React 渲染），避免 Cordis 模块系统的
 * react-dom 解析问题。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-desktop-panel',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    // 用 createElement 而非 jsx-runtime 的 jsx（jsx 签名 (type, props, key) 会把
    // 第 3+ 参数当 key，children 需放 props.children；多参数传 children 会丢失并崩溃）
    const React = require('react')
    const h = React.createElement

    const bridge = () => (typeof window !== 'undefined' ? window.desktopBridge : undefined)

    /** 面板 DOM 根节点（懒创建）。 */
    let panelRoot = null
    /** 面板是否可见。 */
    let panelVisible = false

    /** 创建面板 DOM 结构（纯 DOM，不依赖 React）。 */
    function ensurePanelRoot() {
      if (panelRoot !== null) return panelRoot
      panelRoot = document.createElement('div')
      panelRoot.id = 'dsh-desktop-panel-root'
      panelRoot.style.cssText = 'position:fixed;top:60px;right:20px;width:320px;background:#1e293b;border:1px solid #334155;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:10000;overflow:hidden;font-family:system-ui,-apple-system,sans-serif;display:none;'
      document.body.appendChild(panelRoot)
      buildPanelContent(panelRoot)
      return panelRoot
    }

    /** 构建面板内容（纯 DOM 操作）。 */
    function buildPanelContent(root) {
      root.innerHTML = ''

      // 标题栏
      const header = document.createElement('div')
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #334155;'
      const title = document.createElement('span')
      title.style.cssText = 'font-size:14px;font-weight:600;color:#f8fafc;'
      title.textContent = '\u684c\u9762\u5de5\u5177'
      const closeBtn = document.createElement('button')
      closeBtn.textContent = '\u00d7'
      closeBtn.style.cssText = 'background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;padding:2px 6px;border-radius:4px;'
      closeBtn.onclick = hidePanel
      header.appendChild(title)
      header.appendChild(closeBtn)
      root.appendChild(header)

      // 操作列表
      const list = document.createElement('div')
      list.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:8px;'

      const actions = [
        { icon: '\u2328', title: '\u5feb\u901f\u95ee\u7b54', desc: 'Alt+Shift+Space \u805a\u7126\u8f93\u5165\u6846', onClick: () => { hidePanel() } },
        { icon: '\u2195', title: '\u5524\u8d77\u7a97\u53e3', desc: 'Alt+Shift+Q \u663e\u793a\u5e76\u805a\u7126\u7a97\u53e3', onClick: () => { bridge()?.windowControl?.focus(); hidePanel() } },
        { icon: '\u2398', title: '\u8bfb\u53d6\u526a\u8d34\u677f', desc: '\u8bfb\u53d6\u7cfb\u7edf\u526a\u8d34\u677f\u5185\u5bb9', onClick: async () => {
          try {
            const text = await bridge()?.desktopClipboard?.readText()
            if (text) await navigator.clipboard.writeText(text)
          } catch (e) { console.error('[desktop-panel] \u526a\u8d34\u677f\u8bfb\u53d6\u5931\u8d25:', e) }
        }},
        { icon: '\u2699', title: '\u6253\u5f00\u8bbe\u7f6e', desc: '\u7ba1\u7406\u684c\u9762\u504f\u597d\u8bbe\u7f6e', onClick: () => { hidePanel() } },
      ]

      for (const action of actions) {
        const card = document.createElement('button')
        card.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;cursor:pointer;text-align:left;width:100%;transition:background 0.15s;'
        card.onmouseenter = () => { card.style.background = 'rgba(255,255,255,0.06)' }
        card.onmouseleave = () => { card.style.background = 'rgba(255,255,255,0.03)' }
        card.onclick = action.onClick

        const iconSpan = document.createElement('span')
        iconSpan.style.cssText = 'font-size:20px;width:28px;text-align:center;'
        iconSpan.textContent = action.icon

        const textDiv = document.createElement('div')
        const titleDiv = document.createElement('div')
        titleDiv.style.cssText = 'font-size:13px;font-weight:500;color:#f8fafc;'
        titleDiv.textContent = action.title
        const descDiv = document.createElement('div')
        descDiv.style.cssText = 'font-size:11px;color:#94a3b8;margin-top:2px;'
        descDiv.textContent = action.desc
        textDiv.appendChild(titleDiv)
        textDiv.appendChild(descDiv)

        card.appendChild(iconSpan)
        card.appendChild(textDiv)
        list.appendChild(card)
      }

      root.appendChild(list)
    }

    /** 显示面板。 */
    function showPanel() {
      const root = ensurePanelRoot()
      root.style.display = 'block'
      panelVisible = true
    }

    /** 隐藏面板。 */
    function hidePanel() {
      if (panelRoot !== null) {
        panelRoot.style.display = 'none'
      }
      panelVisible = false
    }

    /** 切换面板。 */
    function togglePanel() {
      if (panelVisible) hidePanel()
      else showPanel()
    }

    // ── 插件声明：注册 sidebar.footer.action slot ──────────────────

    exports.inject = ['slots']
    exports.apply = (ctx) => {
      // 注入侧边栏底部操作按钮
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'desktop-panel',
        order: 0,
        locale: '@lansi-ai/dsh-desktop-panel',
      }, SidebarDesktopButton))

      // 监听 IPC 驱动的面板打开/关闭
      if (typeof window !== 'undefined' && window.desktopBridge?.onDesktopEvent) {
        window.desktopBridge.onDesktopEvent((event) => {
          if (event.action === 'open-panel') showPanel()
          if (event.action === 'close-panel') hidePanel()
        })
      }
    }

    // ── 侧边栏按钮组件 ──────────────────────────────────────────

    function SidebarDesktopButton() {
      return h('button', {
        onClick: (e) => { e.preventDefault(); e.stopPropagation(); togglePanel() },
        title: '\u684c\u9762\u5de5\u5177',
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '36px', height: '36px', borderRadius: '8px',
          background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.2)',
          color: '#38bdf8', cursor: 'pointer', fontSize: '16px', transition: 'all 0.15s',
        },
        onMouseEnter: (e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)' },
        onMouseLeave: (e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)' },
      }, '\u25a0')
    }

    return module.exports
  },
})
