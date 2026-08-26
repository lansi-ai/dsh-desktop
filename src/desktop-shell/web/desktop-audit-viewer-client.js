/**
 * @dsh-desktop/desktop-audit-viewer —— 审计查看器 renderer 注入（M3·b2 审计查询）。
 *
 * 通过官方 Cordis Slots 机制注入审计查看器面板，提供：
 *   - 审计日志查看（按时间倒序）
 *   - 按动作名/会话 ID/时间范围过滤
 *   - 分页浏览
 *
 * 通信：
 *   - 上行：desktopBridge.audit.query() / desktopBridge.audit.listActions()
 *   - 下行：onDesktopEvent（通过 desktop-settings:open 等事件触发打开）
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@dsh-desktop/desktop-audit-viewer',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement

    /** 审计查看器状态。 */
    let viewerState = {
      visible: false,
      entries: [],
      total: 0,
      actions: [],
      filter: { action: '', sessionId: '', from: '', to: '' },
      loading: false,
      page: 0,
      pageSize: 50,
    }

    const stateListeners = new Set()

    function notifyState() {
      stateListeners.forEach((fn) => {
        try { fn({ ...viewerState }) } catch { /* noop */ }
      })
    }

    function setState(patch) {
      viewerState = { ...viewerState, ...patch }
      notifyState()
    }

    /** 查询审计日志。 */
    async function fetchAuditEntries() {
      const bridge = window.desktopBridge
      if (!bridge?.audit?.query) return

      setState({ loading: true })
      try {
        const query = {
          action: viewerState.filter.action || undefined,
          sessionId: viewerState.filter.sessionId || undefined,
          from: viewerState.filter.from ? parseInt(viewerState.filter.from, 10) : undefined,
          to: viewerState.filter.to ? parseInt(viewerState.filter.to, 10) : undefined,
          limit: viewerState.pageSize,
          offset: viewerState.page * viewerState.pageSize,
        }
        const result = await bridge.audit.query(query)
        setState({
          entries: result.entries,
          total: result.total,
          loading: false,
        })
      } catch {
        setState({ loading: false })
      }
    }

    /** 获取可用动作列表。 */
    async function fetchActionList() {
      const bridge = window.desktopBridge
      if (!bridge?.audit?.listActions) return
      try {
        const actions = await bridge.audit.listActions()
        setState({ actions })
      } catch { /* noop */ }
    }

    /** 打开审计查看器。 */
    async function openViewer() {
      setState({ visible: true, page: 0 })
      await fetchActionList()
      await fetchAuditEntries()
    }

    /** 关闭审计查看器。 */
    function closeViewer() {
      setState({ visible: false })
    }

    /** 安装桌面事件监听。 */
    function installDesktopEventListener() {
      const bridge = window.desktopBridge
      if (!bridge?.onDesktopEvent) return () => {}

      return bridge.onDesktopEvent((event) => {
        const action = event?.action
        if (action === 'desktop-audit:open') {
          openViewer()
        } else if (action === 'desktop-audit:close') {
          closeViewer()
        }
      })
    }

    // ── 插件声明 ──────────────────────────────────────────────

    exports.inject = ['slots']
    exports.apply = (ctx) => {
      const getCtx = () => ctx

      const cleanupDesktopEvents = installDesktopEventListener()

      // 注入审计查看器组件
      ctx.slots.inject('app.overlay', () => ctx.slots.register({
        name: 'app.overlay',
        id: 'desktop-audit-viewer',
        order: 90, // 低于命令面板(100)
      }, function AuditViewerOverlay() {
        const [state, setReactState] = React.useState(viewerState)

        React.useEffect(() => {
          const listener = (s) => setReactState(s)
          stateListeners.add(listener)
          return () => stateListeners.delete(listener)
        }, [])

        if (!state.visible) return null

        const context = getCtx()
        return h(AuditViewer, {
          state,
          context,
          onClose: closeViewer,
          onFilterChange: (key, value) => {
            setState({
              filter: { ...viewerState.filter, [key]: value },
              page: 0,
            })
          },
          onSearch: fetchAuditEntries,
          onPageChange: (delta) => {
            setState({
              page: Math.max(0, viewerState.page + delta),
            })
            // 延迟一帧查询
            setTimeout(fetchAuditEntries, 0)
          },
        })
      }))

      exports.__cleanup = () => {
        cleanupDesktopEvents?.()
        stateListeners.clear()
      }

      console.log('[dsh-audit-viewer] 审计查看器已注入')
    }

    // ── UI 组件 ──────────────────────────────────────────────

    /** 审计查看器主组件。 */
    function AuditViewer({ state, onClose, onFilterChange, onSearch, onPageChange }) {
      return h('div', {
        style: {
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          zIndex: 99998,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
        onClick: (e) => { if (e.target === e.currentTarget) onClose() },
      },
        h('div', {
          style: {
            background: '#0f172a',
            borderRadius: '12px',
            width: '800px',
            maxWidth: '95vw',
            height: '600px',
            maxHeight: '90vh',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)',
          },
        },
          // 标题栏
          h('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            },
          },
            h('h2', { style: { margin: 0, color: '#f1f5f9', fontSize: '16px', fontWeight: 600 } },
              '📋 会话审计日志',
            ),
            h('button', {
              onClick: onClose,
              style: {
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '20px',
                padding: '4px 8px',
              },
            }, '✕'),
          ),
          // 过滤器
          h('div', {
            style: {
              display: 'flex',
              gap: '12px',
              padding: '12px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              flexWrap: 'wrap',
            },
          },
            h('select', {
              value: state.filter.action,
              onChange: (e) => { onFilterChange('action', e.target.value) },
              style: filterStyle(),
            },
              h('option', { value: '' }, '全部动作'),
              state.actions.map((a) => h('option', { key: a, value: a }, a)),
            ),
            h('input', {
              type: 'text',
              placeholder: '会话 ID',
              value: state.filter.sessionId,
              onChange: (e) => { onFilterChange('sessionId', e.target.value) },
              style: filterStyle('200px'),
            }),
            h('input', {
              type: 'date',
              value: state.filter.from ? formatDate(state.filter.from) : '',
              onChange: (e) => { onFilterChange('from', e.target.value ? String(new Date(e.target.value).getTime()) : '') },
              style: filterStyle('150px'),
            }),
            h('input', {
              type: 'date',
              value: state.filter.to ? formatDate(state.filter.to) : '',
              onChange: (e) => { onFilterChange('to', e.target.value ? String(new Date(e.target.value).getTime() + 86400000) : '') },
              style: filterStyle('150px'),
            }),
            h('button', {
              onClick: onSearch,
              style: {
                ...buttonStyle(),
                background: '#2563eb',
              },
            }, '🔍 查询'),
          ),
          // 结果区
          h('div', {
            style: {
              flex: 1,
              overflowY: 'auto',
              padding: '12px 20px',
            },
          },
            state.loading
              ? h('div', { style: { textAlign: 'center', color: '#94a3b8', padding: '40px' } }, '加载中...')
              : state.entries.length === 0
                ? h('div', { style: { textAlign: 'center', color: '#64748b', padding: '40px' } }, '暂无审计记录')
                : h(EntryList, { entries: state.entries }),
          ),
          // 分页
          h('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px',
              borderTop: '1px solid rgba(255,255,255,0.08)',
            },
          },
            h('span', { style: { color: '#64748b', fontSize: '13px' } },
              `共 ${state.total} 条记录`,
            ),
            h('div', { style: { display: 'flex', gap: '8px' } },
              h('button', {
                onClick: () => onPageChange(-1),
                disabled: state.page === 0,
                style: {
                  ...buttonStyle(),
                  opacity: state.page === 0 ? 0.5 : 1,
                  cursor: state.page === 0 ? 'not-allowed' : 'pointer',
                },
              }, '← 上一页'),
              h('span', { style: { color: '#94a3b8', fontSize: '13px', alignSelf: 'center' } },
                `${state.page + 1} / ${Math.ceil(state.total / state.pageSize) || 1}`,
              ),
              h('button', {
                onClick: () => onPageChange(1),
                disabled: (state.page + 1) * state.pageSize >= state.total,
                style: {
                  ...buttonStyle(),
                  opacity: (state.page + 1) * state.pageSize >= state.total ? 0.5 : 1,
                  cursor: (state.page + 1) * state.pageSize >= state.total ? 'not-allowed' : 'pointer',
                },
              }, '下一页 →'),
            ),
          ),
        ),
      )
    }

    /** 条目列表组件。 */
    function EntryList({ entries }) {
      return h('div', null,
        entries.map((entry) => h('div', {
          key: `${entry.ts}-${entry.action}`,
          style: {
            padding: '10px 12px',
            borderRadius: '6px',
            marginBottom: '4px',
            background: 'rgba(255,255,255,0.03)',
            fontFamily: 'monospace',
            fontSize: '12px',
          },
        },
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' } },
            h('span', {
              style: {
                color: '#38bdf8',
                background: 'rgba(56,189,248,0.1)',
                padding: '2px 8px',
                borderRadius: '4px',
                fontWeight: 500,
              },
            }, entry.action),
            h('span', { style: { color: '#64748b' } }, formatTimestamp(entry.ts)),
          ),
          entry.payload
            ? h('div', { style: { color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                JSON.stringify(entry.payload),
              )
            : null,
        )),
      )
    }

    // ── 辅助函数 ──────────────────────────────────────────────

    function filterStyle(width) {
      return {
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '6px',
        color: '#f1f5f9',
        padding: '6px 10px',
        fontSize: '13px',
        width: width || '160px',
        outline: 'none',
      }
    }

    function buttonStyle() {
      return {
        background: 'rgba(255,255,255,0.08)',
        color: '#f1f5f9',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '6px',
        padding: '6px 14px',
        cursor: 'pointer',
        fontSize: '13px',
      }
    }

    function formatTimestamp(ts) {
      try {
        const d = new Date(ts)
        const pad = (n) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      } catch {
        return String(ts)
      }
    }

    function formatDate(ts) {
      try {
        const d = new Date(parseInt(ts, 10))
        const pad = (n) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      } catch {
        return ''
      }
    }

    return module.exports
  },
})
