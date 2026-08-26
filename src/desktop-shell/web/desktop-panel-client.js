/**
 * @dsh-desktop/desktop-panel-client —— 桌面面板容器注入（M2·e 官方 UI 注入）。
 *
 * 通过官方 Cordis Slots 机制向侧边栏底部注册「桌面面板」触发按钮，
 * 点击后打开桌面功能面板（悬浮模态框，显示快捷键/剪贴板/通知等桌面能力入口）。
 *
 * 面板支持两种打开方式：
 *   1. 侧边栏按钮（sidebar.footer.action slot）
 *   2. IPC 驱动（desktopBridge.openDesktopPanel() → onDesktopEvent → 面板打开）
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
/* eslint-disable no-undef -- 浏览器侧 bundle，React 等全局由 renderer 提供 */
window.__ModuleLoader__.load({
  id: '@dsh-desktop/desktop-panel',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const { jsx: h } = require('react/jsx-runtime')

    const bridge = () => (typeof window !== 'undefined' ? window.desktopBridge : undefined)

    /** 面板状态（模块级单例，跨渲染保持）。 */
    let panelOpen = false
    let panelListeners = []

    /** 切换面板显示状态。 */
    function togglePanel() {
      panelOpen = !panelOpen
      panelListeners.forEach((fn) => fn(panelOpen))
    }

    /** 关闭面板。 */
    function closePanel() {
      if (panelOpen) {
        panelOpen = false
        panelListeners.forEach((fn) => fn(panelOpen))
      }
    }

    /** 桌面能力快捷操作卡片。 */
    function DesktopActionCard({ icon, title, description, onClick }) {
      return h('button', {
        onClick,
        style: {
          display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '8px', cursor: 'pointer', textAlign: 'left', width: '100%',
          transition: 'background 0.15s',
        },
        onMouseEnter: (e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' },
        onMouseLeave: (e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)' },
      },
        h('span', { style: { fontSize: '20px', width: '28px', textAlign: 'center' } }, icon),
        h('div', null,
          h('div', { style: { fontSize: '13px', fontWeight: 500, color: '#f8fafc' } }, title),
          h('div', { style: { fontSize: '11px', color: '#94a3b8', marginTop: '2px' } }, description),
        ),
      )
    }

    /** 桌面面板主组件。 */
    function DesktopPanel() {
      const [open, setOpen] = React.useState(panelOpen)

      React.useEffect(() => {
        const listener = (state) => setOpen(state)
        panelListeners.push(listener)
        return () => { panelListeners = panelListeners.filter((fn) => fn !== listener) }
      }, [])

      // 监听 onDesktopEvent 中的 open-panel 事件（IPC 驱动打开）
      React.useEffect(() => {
        const db = bridge()
        if (!db?.onDesktopEvent) return
        const off = db.onDesktopEvent((event) => {
          if (event.action === 'open-panel') togglePanel()
          if (event.action === 'close-panel') closePanel()
        })
        return off
      }, [])

      if (!open) return null

      const handleCopyClipboard = async () => {
        try {
          const text = await bridge()?.desktopClipboard?.readText()
          if (text) {
            await navigator.clipboard.writeText(text)
          }
        } catch (e) {
          console.error('[desktop-panel] 剪贴板读取失败:', e)
        }
      }

      return h('div', {
        style: {
          position: 'fixed', top: '60px', right: '20px', width: '320px',
          background: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 10000, overflow: 'hidden',
        },
      },
        // 标题栏
        h('div', {
          style: {
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px', borderBottom: '1px solid #334155',
          },
        },
          h('span', { style: { fontSize: '14px', fontWeight: 600, color: '#f8fafc' } }, '桌面工具'),
          h('button', {
            onClick: closePanel,
            style: {
              background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer',
              fontSize: '16px', padding: '2px 6px', borderRadius: '4px',
            },
          }, '\u00d7'),
        ),
        // 快捷操作列表
        h('div', { style: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' } },
          h(DesktopActionCard, {
            icon: '\u2328',
            title: '快速问答',
            description: 'Alt+Shift+Space 聚焦输入框',
            onClick: () => {
              const db = bridge()
              db?.onDesktopEvent?.(() => {})
              // 下行 quick-ask 事件 → 官方 UI 聚焦输入框
              closePanel()
            },
          }),
          h(DesktopActionCard, {
            icon: '\u2398',
            title: '唤起窗口',
            description: 'Alt+Shift+Q 显示并聚焦窗口',
            onClick: () => {
              bridge()?.windowControl?.focus()
              closePanel()
            },
          }),
          h(DesktopActionCard, {
            icon: '\u2325',
            title: '读取剪贴板',
            description: '读取系统剪贴板内容',
            onClick: handleCopyClipboard,
          }),
          h(DesktopActionCard, {
            icon: '\u2699',
            title: '打开设置',
            description: '管理桌面偏好设置',
            onClick: () => {
              // 触发官方设置面板打开（通过 layout 服务或事件）
              closePanel()
            },
          }),
        ),
      )
    }

    /** 侧边栏底部桌面按钮组件。 */
    function SidebarDesktopButton() {
      const handleClick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        togglePanel()
      }

      return h('button', {
        onClick: handleClick,
        title: '桌面工具',
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '36px', height: '36px', borderRadius: '8px',
          background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.2)',
          color: '#38bdf8', cursor: 'pointer', fontSize: '16px', transition: 'all 0.15s',
        },
        onMouseEnter: (e) => {
          e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)'
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)'
        },
      }, '\u25a0') // ■ 方块图标（桌面象征）
    }

    // ── 插件声明：注册 sidebar.footer.action slot ──────────────────

    exports.inject = ['slots']
    exports.apply = (ctx) => {
      // 注入侧边栏底部操作按钮（list slot，可多个）
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'desktop-panel',
        order: 0,
        locale: '@dsh-desktop/desktop-panel',
      }, SidebarDesktopButton))

      // 注入桌面面板浮层（通过 React portal 或直接渲染）
      // 面板挂在 document.body 上，不依赖 slot 系统
      if (typeof document !== 'undefined') {
        const container = document.createElement('div')
        container.id = 'dsh-desktop-panel-root'
        document.body.appendChild(container)
        // 使用 React 18 createRoot（若可用）或 ReactDOM.render
        try {
          const ReactDOM = require('react-dom/client')
          if (ReactDOM?.createRoot) {
            const root = ReactDOM.createRoot(container)
            root.render(h(DesktopPanel, null))
          }
        } catch {
          // React 版本不支持 createRoot，降级
          try {
            const ReactDOM = require('react-dom')
            ReactDOM.render(h(DesktopPanel, null), container)
          } catch {
            console.warn('[desktop-panel] React 渲染不可用，面板功能降级')
          }
        }
      }
    }

    return module.exports
  },
})
