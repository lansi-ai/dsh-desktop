/**
 * @lansi-ai/dsh-desktop-about —— 关于页插件（M7 · 设置页独立 section）。
 *
 * 通过官方 Cordis Slots 机制向设置面板注册「关于」section：
 *   - 产品名 + 当前版本号 + 上游基线版本
 *   - 更新渠道（正式 / 预发布 / 关闭）与自动检查开关（M4-b 三通道）
 *   - 「检查更新」入口（联动主进程 auto-updater）
 *
 * 与 @lansi-ai/dsh-desktop-settings（桌面设置）互相独立：
 * 本插件不依赖 ctx.settings，仅经 window.desktopBridge.updater 与主进程通信
 * （check/getStatus/install/getChannel/setChannel/getAutoCheck/setAutoCheck
 * + app-update:status 下行事件）。配置真源单一在主进程 —— setChannel /
 * setAutoCheck 由主进程写 settings `desktop` 命名空间并即时生效，UI 不重复落盘。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-desktop-about',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement

    /** 更新渠道选项（与主进程 `UpdaterChannel` 三态一一对应）。 */
    const CHANNELS = [
      { id: 'stable', label: '正式' },
      { id: 'rc', label: '预发布' },
      { id: 'off', label: '关闭' },
    ]

    // ── 插件声明：注册 settings.section slot ──────────────────────

    exports.inject = ['slots']
    exports.apply = (ctx) => {
      // 关于 section（order=20，排在桌面设置之后）：版本信息 + 检查更新入口。
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'about',
        order: 20,
        label: () => '关于',
        locale: '@lansi-ai/dsh-desktop-about',
      }, function AboutSettingsSection() {
        return h(AboutSettings, null)
      }))
    }

    // ── UI 组件 ──────────────────────────────────────────────────

    /** 关于设置组件：产品版本 + 上游基线版本 + 更新渠道/自动检查 + 检查更新入口。
     *  经 desktopBridge.updater 与主进程 auto-updater 联动（配置真源在主进程，
     *  setChannel / setAutoCheck 由主进程落 settings `desktop` 命名空间并即时生效）：
     *  - 初始化 getStatus()/getChannel()/getAutoCheck() 读当前值，onStatus() 订阅后续变更（app-update:status）
     *  - 「检查更新」→ check()；下载完成后「重启以更新」→ install()
     *  基线版本读协议层注入的 window.__DSH_BASE_VERSION__（dsh-ui-protocol.ts 注入，
     *  即 @deepseek-ai/dsh 依赖包的实际安装版本）。
     *  开发模式（未打包）下 updater 为禁用句柄，按钮仅记录日志、不报错；
     *  渠道为 off 时自动检查与「检查更新」一并置灰（off = 完全关闭）。
     */
    function AboutSettings() {
      const [status, setStatus] = React.useState(null)
      const [channel, setChannel] = React.useState('stable')
      const [autoCheck, setAutoCheck] = React.useState(true)
      const [hint, setHint] = React.useState('')
      React.useEffect(() => {
        const bridge = window.desktopBridge
        if (!bridge?.updater) return
        bridge.updater.getStatus().then(setStatus).catch(() => { /* bridge 未就绪 */ })
        bridge.updater.getChannel().then((res) => setChannel(res.channel)).catch(() => { /* bridge 未就绪 */ })
        bridge.updater.getAutoCheck().then((res) => setAutoCheck(res.enabled)).catch(() => { /* bridge 未就绪 */ })
        return bridge.updater.onStatus(setStatus)
      }, [])

      /** off 渠道 = 完全关闭：自动检查与手动检查均不可用。 */
      const updateDisabled = channel === 'off'

      const phase = status?.phase ?? 'idle'
      const currentVersion = status?.currentVersion ?? ''
      const baselineVersion = window.__DSH_BASE_VERSION__ || '未知'
      const newVersion = status?.newVersion
      const percent = status?.percent ?? 0

      let statusText
      if (updateDisabled) statusText = '已关闭自动更新'
      else if (phase === 'checking') statusText = '正在检查更新…'
      else if (phase === 'available') statusText = `发现新版本 v${newVersion ?? ''}，正在后台下载…`
      else if (phase === 'downloading') statusText = `正在下载更新… ${percent}%`
      else if (phase === 'downloaded') statusText = `新版本 v${newVersion ?? ''} 已就绪`
      else if (phase === 'not-available') statusText = '已是最新版本'
      else if (phase === 'error') statusText = '检查更新失败，请稍后重试'
      else statusText = '尚未检查更新'

      const busy = !updateDisabled && (phase === 'checking' || phase === 'available' || phase === 'downloading')
      const buttonStyle = {
        padding: '6px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
        fontSize: '13px', background: 'var(--dsw-alias-button-info-fill)',
        color: 'var(--dsw-alias-label-primary)', fontWeight: 500, whiteSpace: 'nowrap',
      }
      // 渠道分段按钮：选中态沿用「info-fill 底 + label-primary 字」的既有按钮配色约定
      const segStyle = (active) => ({
        padding: '4px 10px', borderRadius: '6px', fontSize: '12px', lineHeight: '18px',
        cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: active ? 500 : 400,
        border: active ? '1px solid var(--dsw-alias-button-info-fill)' : '1px solid var(--dsw-alias-border-l2)',
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        background: active ? 'var(--dsw-alias-button-info-fill)' : 'transparent',
      })

      /** 切换更新渠道（主进程落盘 + 即时生效；失败回滚选中态并提示）。 */
      const handleChannel = (id) => {
        const bridge = window.desktopBridge?.updater
        if (!bridge || id === channel) return
        const prev = channel
        setChannel(id)
        setHint('')
        bridge.setChannel(id).then((res) => {
          if (res?.ok === false) { setChannel(prev); setHint(res.message ?? '设置失败，请重试') }
        }).catch(() => { setChannel(prev); setHint('设置失败，请重试') })
      }

      /** 切换「启动静默自动检查」开关（同 handleChannel 语义）。 */
      const handleAutoCheck = (e) => {
        const bridge = window.desktopBridge?.updater
        if (!bridge) return
        const next = e.target.checked
        const prev = autoCheck
        setAutoCheck(next)
        setHint('')
        bridge.setAutoCheck(next).then((res) => {
          if (res?.ok === false) { setAutoCheck(prev); setHint(res.message ?? '设置失败，请重试') }
        }).catch(() => { setAutoCheck(prev); setHint('设置失败，请重试') })
      }

      const actionButton = phase === 'downloaded' && !updateDisabled
        ? h('button', { onClick: () => window.desktopBridge?.updater?.install(), style: { ...buttonStyle, background: '#16a34a', color: '#f8fafc' } }, '重启以更新')
        : h('button', {
            onClick: () => window.desktopBridge?.updater?.check(),
            disabled: busy || updateDisabled,
            style: { ...buttonStyle, ...((busy || updateDisabled) ? { opacity: 0.5, cursor: 'default' } : {}) },
          }, phase === 'checking' ? '检查中…' : '检查更新')

      // 单行信息行：左主文案 + 右值/按钮，细分割线分隔（字体/分割线/间距跟随主题 token）
      const row = (label, value, divider) => h('div', {
        style: {
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px',
          padding: '14px 0',
          ...(divider ? { borderBottom: '1px solid var(--dsw-alias-border-l2)' } : {}),
        },
      },
        h('span', { style: { fontSize: '14px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)', lineHeight: '22px' } }, label),
        h('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)', lineHeight: '22px' } }, value),
      )

      return h('div', { style: { padding: '16px 24px 24px', maxWidth: '480px' } },
        h('h3', { style: { margin: '0 0 12px 0', fontSize: '16px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', lineHeight: '24px' } }, '关于'),
        row('DSH Forge', `v${currentVersion}`, true),
        row('@deepseek-ai/dsh 官方包版本', baselineVersion, true),
        row('更新渠道', h('div', { style: { display: 'flex', gap: '4px', flexShrink: 0 } },
          CHANNELS.map((opt) => h('button', {
            key: opt.id,
            onClick: () => handleChannel(opt.id),
            style: segStyle(channel === opt.id),
          }, opt.label)),
        ), true),
        row('自动检查更新', h('input', {
          type: 'checkbox',
          checked: autoCheck,
          onChange: handleAutoCheck,
          disabled: updateDisabled,
          style: { width: '18px', height: '18px', cursor: updateDisabled ? 'not-allowed' : 'pointer', opacity: updateDisabled ? 0.4 : 1, accentColor: 'var(--dsw-alias-button-info-fill)' },
        }), true),
        hint !== '' ? h('div', { style: { fontSize: '12px', lineHeight: '18px', color: '#fbbf24', padding: '8px 0 0' } }, hint) : null,
        row(statusText, actionButton, false),
      )
    }

    return module.exports
  },
})
