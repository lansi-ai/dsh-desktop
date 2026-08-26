/**
 * @dsh-desktop/desktop-cmdpalette —— 命令面板 renderer 注入（M3·a4 命令面板）。
 *
 * 通过官方 Cordis Slots 机制注入命令面板组件，提供：
 *   - Ctrl+K 唤起/关闭命令面板
 *   - 会话列表快速切换
 *   - 快速提问（聚焦输入框）
 *   - 插件开关快捷入口
 *   - 设置快捷入口
 *
 * 通信：
 *   - 上行：desktopBridge.openCommandPalette() / switchSession() / listSessions()
 *   - 下行：onDesktopEvent('cmdpalette:open' / 'cmdpalette:close' / 'quick-ask')
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
/* global Event */
window.__ModuleLoader__.load({
  id: '@dsh-desktop/desktop-cmdpalette',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement

    /** 命令面板状态（简单全局单例，避免 React context 复杂度）。 */
    let paletteState = {
      visible: false,
      query: '',
      sessions: [],
    }

    /** 命令面板状态变化监听器列表。 */
    const stateListeners = new Set()

    /** 通知状态变化。 */
    function notifyState() {
      stateListeners.forEach((fn) => {
        try { fn({ ...paletteState }) } catch { /* 监听器异常不阻塞其他 */ }
      })
    }

    /** 更新命令面板状态。 */
    function setState(patch) {
      paletteState = { ...paletteState, ...patch }
      notifyState()
    }

    /** 刷新会话列表。 */
    async function refreshSessions() {
      try {
        const bridge = window.desktopBridge
        if (bridge?.windowManager?.listSessions) {
          const sessions = await bridge.windowManager.listSessions()
          setState({ sessions })
        }
      } catch { /* bridge 未就绪 */ }
    }

    /** 打开命令面板。 */
    async function openPalette(query) {
      await refreshSessions()
      setState({ visible: true, query: query || '' })
    }

    /** 关闭命令面板。 */
    function closePalette() {
      setState({ visible: false })
    }

    /** 切换会话。 */
    async function switchSession(sessionId) {
      try {
        const bridge = window.desktopBridge
        if (bridge?.cmdPalette?.switchSession) {
          await bridge.cmdPalette.switchSession(sessionId)
        } else if (bridge?.windowManager?.focusSessionWindow) {
          await bridge.windowManager.focusSessionWindow(sessionId)
        }
      } catch { /* 会话切换失败 */ }
      closePalette()
    }

    /** 全局键盘监听（Ctrl/Cmd+K 切换面板）。 */
    function installKeyboardListener() {
      const handler = (e) => {
        const isCtrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'
        const isEscape = e.key === 'Escape'

        if (isCtrlK) {
          e.preventDefault()
          if (paletteState.visible) {
            closePalette()
          } else {
            openPalette('')
          }
        } else if (isEscape && paletteState.visible) {
          e.preventDefault()
          closePalette()
        }
      }
      window.addEventListener('keydown', handler)
      return () => window.removeEventListener('keydown', handler)
    }

    /** 桌面事件监听（cmdpalette:open / cmdpalette:close / quick-ask）。 */
    function installDesktopEventListener() {
      const bridge = window.desktopBridge
      if (!bridge?.onDesktopEvent) return () => {}

      return bridge.onDesktopEvent((event) => {
        const action = event?.action
        if (action === 'cmdpalette:open') {
          openPalette(event?.payload?.query || '')
        } else if (action === 'cmdpalette:close') {
          closePalette()
        } else if (action === 'quick-ask') {
          // 快速提问：关闭面板，聚焦聊天输入框
          closePalette()
          try {
            // 尝试聚焦到主输入框（通用 selector，兼容不同 UI）
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
                if (event?.payload?.question) {
                  // 设置预填问题
                  const nativeSetter = Object.getOwnPropertyDescriptor(
                    el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLElement.prototype,
                    'value',
                  )
                  if (nativeSetter?.set) {
                    nativeSetter.set.call(el, event.payload.question)
                    el.dispatchEvent(new Event('input', { bubbles: true }))
                  }
                }
                break
              }
            }
          } catch { /* 聚焦失败 */ }
        }
      })
    }

    // ── 插件声明：注册全局注入 + 键盘监听 + 事件监听 ──────────

    exports.inject = ['slots']
    exports.apply = (ctx) => {
      const getCtx = () => ctx

      // 安装键盘监听
      const cleanupKeyboard = installKeyboardListener()

      // 安装桌面事件监听
      const cleanupDesktopEvents = installDesktopEventListener()

      // 注入命令面板组件（通过 Slot 系统覆盖全局层）
      ctx.slots.inject('app.overlay', () => ctx.slots.register({
        name: 'app.overlay',
        id: 'desktop-cmdpalette',
        order: 100, // 高 order = 最顶层
      }, function CommandPaletteOverlay() {
        const [state, setState] = React.useState(paletteState)

        React.useEffect(() => {
          const listener = (s) => setState(s)
          stateListeners.add(listener)
          return () => stateListeners.delete(listener)
        }, [])

        if (!state.visible) return null

        const context = getCtx()
        const query = state.query
        const sessions = state.sessions || []

        return h(CommandPalette, {
          query,
          sessions,
          context,
          onQueryChange: (q) => setState({ ...paletteState, query: q }),
          onClose: closePalette,
          onSelectSession: switchSession,
          onRefreshSessions: refreshSessions,
        })
      }))

      // 清理函数（Slot 系统不直接暴露 uninstall，但键盘/事件监听可清理）
      exports.__cleanup = () => {
        cleanupKeyboard?.()
        cleanupDesktopEvents?.()
        stateListeners.clear()
      }

      console.log('[dsh-cmdpalette] 命令面板已注入')
    }

    // ── UI 组件 ──────────────────────────────────────────────────

    /** 命令面板主组件。 */
    function CommandPalette({ query, sessions, onQueryChange, onClose, onSelectSession }) {
      const [activeTab, setActiveTab] = React.useState('sessions')
      const inputRef = React.useRef(null)

      // 自动聚焦输入框
      React.useEffect(() => {
        if (inputRef.current) inputRef.current.focus()
      }, [])

      return h('div', {
        style: {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: '120px',
        },
        onClick: (e) => { if (e.target === e.currentTarget) onClose() },
      },
        h('div', {
          style: {
            background: '#1e293b',
            borderRadius: '12px',
            width: '560px',
            maxWidth: '90vw',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)',
          },
        },
          // 搜索输入框
          h('div', { style: { padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              h('span', { style: { color: '#94a3b8', fontSize: '18px' } }, '🔍'),
              h('input', {
                ref: inputRef,
                type: 'text',
                value: query,
                onChange: (e) => onQueryChange(e.target.value),
                placeholder: '搜索会话、输入快捷命令...',
                style: {
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#f1f5f9',
                  fontSize: '15px',
                  padding: '4px 0',
                },
                onKeyDown: (e) => {
                  if (e.key === 'Escape') onClose()
                  if (e.key === 'Enter' && query.trim()) {
                    // Enter：切换到第一个匹配会话
                    const match = filterSessions(sessions, query)[0]
                    if (match) onSelectSession(match.sessionId)
                  }
                },
              }),
              h('kbd', { style: { background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', color: '#94a3b8' } }, 'ESC'),
            ),
          ),
          // Tab 栏
          h('div', { style: { display: 'flex', padding: '8px 20px', gap: '4px' } },
            h(TabButton, { label: '会话列表', active: activeTab === 'sessions', onClick: () => setActiveTab('sessions') }),
            h(TabButton, { label: '快捷操作', active: activeTab === 'actions', onClick: () => setActiveTab('actions') }),
            h(TabButton, { label: '设置', active: activeTab === 'settings', onClick: () => setActiveTab('settings') }),
          ),
          // 内容区
          h('div', { style: { maxHeight: '360px', overflowY: 'auto', padding: '0 8px 8px' } },
            activeTab === 'sessions' && h(SessionList, { sessions: filterSessions(sessions, query), onSelect: onSelectSession }),
            activeTab === 'actions' && h(ActionList, { onClose }),
            activeTab === 'settings' && h(SettingsShortcuts, { onClose }),
          ),
        ),
      )
    }

    /** Tab 按钮组件。 */
    function TabButton({ label, active, onClick }) {
      return h('button', {
        onClick,
        style: {
          padding: '6px 14px',
          background: active ? 'rgba(56,189,248,0.15)' : 'transparent',
          color: active ? '#38bdf8' : '#94a3b8',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: active ? 500 : 400,
          transition: 'all 0.15s',
        },
      }, label)
    }

    /** 过滤会话列表。 */
    function filterSessions(sessions, query) {
      if (!query) return sessions
      const q = query.toLowerCase()
      return sessions.filter((s) =>
        (s.title || s.sessionId || '').toLowerCase().includes(q)
      )
    }

    /** 会话列表组件。 */
    function SessionList({ sessions, onSelect }) {
      if (sessions.length === 0) {
        return h('div', { style: { padding: '40px 20px', textAlign: 'center', color: '#64748b', fontSize: '13px' } },
          '暂无活跃会话',
        )
      }
      return h('div', null,
        sessions.map((s) => h('div', {
          key: s.sessionId,
          onClick: () => onSelect(s.sessionId),
          style: {
            padding: '12px 16px',
            cursor: 'pointer',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            transition: 'background 0.15s',
          },
          onMouseEnter: (e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' },
          onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent' },
        },
          h('div', {
            style: {
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #38bdf8, #818cf8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              flexShrink: 0,
            },
          }, (s.title || s.sessionId).charAt(0).toUpperCase()),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { color: '#f1f5f9', fontSize: '14px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              s.title || '会话',
            ),
            h('div', { style: { color: '#64748b', fontSize: '12px', marginTop: '2px' } },
              s.sessionId,
            ),
          ),
          s.state === 'active' && h('div', {
            style: { width: '8px', height: '8px', borderRadius: '50%', background: '#34d399' },
          }),
        )),
      )
    }

    /** 快捷操作列表。 */
    function ActionList({ onClose }) {
      const actions = [
        { icon: '✨', label: '新会话', desc: '创建一个全新的对话', shortcut: 'Ctrl+N' },
        { icon: '📋', label: '剪贴板读取', desc: '读取剪贴板文本内容', shortcut: 'Ctrl+Shift+V' },
        { icon: '📝', label: '快速提问', desc: '唤起全局快速提问窗口', shortcut: 'Ctrl+Shift+P' },
      ]
      return h('div', null,
        actions.map((a) => h('div', {
          key: a.label,
          onClick: () => {
            if (a.label === '快速提问') {
              window.desktopBridge?.cmdPalette?.quickAsk?.()
            }
            onClose()
          },
          style: {
            padding: '12px 16px',
            cursor: 'pointer',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          },
          onMouseEnter: (e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' },
          onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent' },
        },
          h('span', { style: { fontSize: '18px' } }, a.icon),
          h('div', { style: { flex: 1 } },
            h('div', { style: { color: '#f1f5f9', fontSize: '14px' } }, a.label),
            h('div', { style: { color: '#64748b', fontSize: '12px' } }, a.desc),
          ),
          h('kbd', { style: { background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', color: '#64748b' } }, a.shortcut),
        )),
      )
    }

    /** 设置快捷入口。 */
    function SettingsShortcuts({ onClose }) {
      const settings = [
        { icon: '⚙️', label: '桌面设置', desc: '托盘/通知/快捷键偏好' },
        { icon: '🔌', label: '插件管理', desc: '查看已安装的桌面插件' },
        { icon: '🗂️', label: '会话历史', desc: '查看会话审计记录' },
      ]
      return h('div', null,
        settings.map((s) => h('div', {
          key: s.label,
          onClick: () => {
            // 尝试打开对应设置面板
            onClose()
          },
          style: {
            padding: '12px 16px',
            cursor: 'pointer',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          },
          onMouseEnter: (e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' },
          onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent' },
        },
          h('span', { style: { fontSize: '18px' } }, s.icon),
          h('div', { style: { flex: 1 } },
            h('div', { style: { color: '#f1f5f9', fontSize: '14px' } }, s.label),
            h('div', { style: { color: '#64748b', fontSize: '12px' } }, s.desc),
          ),
        )),
      )
    }

    return module.exports
  },
})
