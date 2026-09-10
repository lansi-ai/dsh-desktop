/**
 * @lansi-ai/dsh-forge-network —— 网络代理设置（通用设置「网络设置」分组）。
 *
 * 经官方 Cordis Slots 机制向通用设置分区（`settings.general.item`）注入：
 *   - 分组标题行（order=34，接在「桌面设置」四行之后）
 *   - 代理模式行（order=35）：三态分段（不使用代理 / 系统代理 / 手动设置）
 *     + 手动模式的地址输入行（填好后点「应用」才下发）
 *
 * 配置真源单一在主进程：setProxy 由主进程校验、逐 session 生效并落 settings
 * `desktop` 命名空间（UI 不重复落盘）；本件仅经 `window.desktopBridge.network`
 * 读写快照（getProxy/setProxy）。
 *
 * 生效边界（刻意在 UI 上写明，避免「设了代理但模型仍连不上」的误判）：
 * 代理作用于 Chromium 网络栈 —— 应用自动更新（含 electron-updater 的独立
 * session 分区）与页面请求；走 Node 栈的请求（官方 Host 侧的模型 API 调用）
 * 不受本设置影响。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-forge-network',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement

    /** 代理模式三态（与主进程 `ProxyMode` 一一对应）。 */
    const MODES = [
      { id: 'direct', label: '不使用代理' },
      { id: 'system', label: '系统代理' },
      { id: 'manual', label: '手动设置' },
    ]

    // ── 插件声明：向通用设置分区注入「网络设置」分组 ──────────────

    exports.inject = ['slots']
    exports.apply = (ctx) => {
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'network-group',
        order: 34,
        locale: '@lansi-ai/dsh-forge-network',
      }, GroupHeader))

      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'network-proxy',
        order: 35,
        locale: '@lansi-ai/dsh-forge-network',
      }, ProxyRow))
    }

    // ── UI 组件 ──────────────────────────────────────────────────

    /** 分组标题行（视觉对齐「桌面设置」分组标题）。 */
    function GroupHeader() {
      return h('div', {
        style: { padding: '16px 0 2px', fontSize: '14px', fontWeight: 600, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' },
      }, '网络设置')
    }

    /**
     * 代理设置行。
     *  - 初始经 getProxy() 读快照（模式 + 手动地址原始输入）
     *  - 点「不使用代理」/「系统代理」立即下发；点「手动设置」先亮起再等填地址
     *  - 任一失败：回退选中态到最近一次成功值并提示原因
     */
    function ProxyRow() {
      const [snapshot, setSnapshot] = React.useState(null)
      const [selected, setSelected] = React.useState('system')
      const [draft, setDraft] = React.useState('')
      const [hint, setHint] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      /** 以主进程快照回填全部本地态（成功路径唯一入口）。 */
      const applySnapshot = (res) => {
        setSnapshot(res ?? null)
        setSelected(res?.mode ?? 'system')
        setDraft(res?.rules ?? '')
      }

      React.useEffect(() => {
        const bridge = window.desktopBridge
        if (!bridge?.network) return
        bridge.network.getProxy().then(applySnapshot).catch(() => { /* bridge 未就绪 */ })
      }, [])

      /** 下发一组设置；成功后回填快照，失败回退选中态并提示。 */
      const submit = async (mode, rules) => {
        const bridge = window.desktopBridge?.network
        if (!bridge) return
        setBusy(true)
        setHint('')
        try {
          const res = await bridge.setProxy(mode, rules)
          if (res?.ok === false) {
            setHint(res.message ?? '设置失败，请重试')
            setSelected(snapshot?.mode ?? 'system')
            return
          }
          applySnapshot(await bridge.getProxy())
        } catch {
          setHint('设置失败，请重试')
          setSelected(snapshot?.mode ?? 'system')
        } finally {
          setBusy(false)
        }
      }

      const handleMode = (id) => {
        if (busy || id === selected) return
        setHint('')
        // 手动模式需先填地址 → 只切换选中态，等「应用」
        if (id === 'manual') {
          setSelected('manual')
          return
        }
        setSelected(id)
        void submit(id, undefined)
      }

      const segStyle = (active) => ({
        padding: '4px 10px', borderRadius: '6px', fontSize: '12px', lineHeight: '18px',
        cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap', fontWeight: active ? 500 : 400,
        opacity: busy ? 0.6 : 1,
        border: active ? '1px solid var(--dsw-alias-button-info-fill)' : '1px solid var(--dsw-alias-border-l2)',
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        background: active ? 'var(--dsw-alias-button-info-fill)' : 'transparent',
      })
      const applyBtnStyle = {
        padding: '6px 16px', borderRadius: '6px', border: 'none',
        cursor: busy ? 'default' : 'pointer', fontSize: '13px', fontWeight: 500,
        whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1,
        background: 'var(--dsw-alias-button-info-fill)', color: 'var(--dsw-alias-label-primary)',
      }
      const muted = { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }

      return h('div', { style: { padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' } },
          h('div', null,
            h('div', { style: { fontSize: '14px', fontWeight: 500, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' } }, '代理模式'),
            h('div', { style: { ...muted, marginTop: '2px' } }, '应用更新与页面请求使用的代理方式'),
          ),
          h('div', { style: { display: 'flex', gap: '4px', flexShrink: 0 } },
            MODES.map((opt) => h('button', {
              key: opt.id,
              onClick: () => handleMode(opt.id),
              disabled: busy,
              style: segStyle(selected === opt.id),
            }, opt.label)),
          ),
        ),
        selected === 'manual' ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' } },
          h('input', {
            type: 'text',
            value: draft,
            placeholder: '127.0.0.1:7890 或 socks5://127.0.0.1:7890',
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') void submit('manual', draft) },
            style: {
              flex: 1, padding: '6px 10px', borderRadius: '6px', fontSize: '13px',
              border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
              color: 'var(--dsw-alias-label-primary)',
            },
          }),
          h('button', { onClick: () => void submit('manual', draft), disabled: busy, style: applyBtnStyle }, busy ? '应用中…' : '应用'),
        ) : null,
        h('div', { style: { ...muted, marginTop: '6px' } },
          '作用于 Chromium 网络栈：应用自动更新与页面请求；模型 API 等走 Node 栈的请求不受此设置影响。'),
        hint !== '' ? h('div', { style: { fontSize: '12px', lineHeight: '18px', color: '#fbbf24', marginTop: '4px' } }, hint) : null,
      )
    }

    return module.exports
  },
})
