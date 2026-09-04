/**
 * @lansi-ai/dsh-desktop-about —— 关于页插件（M7 · 设置页独立 section）。
 *
 * 通过官方 Cordis Slots 机制向设置面板注册「关于」section：
 *   - 产品名 + 当前版本号
 *   - 「检查更新」入口（联动主进程 auto-updater）
 *
 * 与 @lansi-ai/dsh-desktop-settings（桌面设置）互相独立：
 * 本插件不依赖 ctx.settings，仅经 window.desktopBridge.updater 与主进程通信
 * （check/getStatus/install + app-update:status 下行事件）。
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

    /** 关于设置组件：产品版本 + 上游基线版本 + 检查更新入口。
     *  经 desktopBridge.updater 与主进程 auto-updater 联动：
     *  - 初始化 getStatus() 读当前状态，onStatus() 订阅后续变更（app-update:status）
     *  - 「检查更新」→ check()；下载完成后「重启以更新」→ install()
     *  基线版本读协议层注入的 window.__DSH_BASE_VERSION__（dsh-ui-protocol.ts 注入，
     *  即 @deepseek-ai/dsh 依赖包的实际安装版本）。
     *  开发模式（未打包）下 updater 为禁用句柄，按钮仅记录日志、不报错。
     */
    function AboutSettings() {
      const [status, setStatus] = React.useState(null)
      React.useEffect(() => {
        const bridge = window.desktopBridge
        if (!bridge?.updater) return
        bridge.updater.getStatus().then(setStatus).catch(() => { /* bridge 未就绪 */ })
        return bridge.updater.onStatus(setStatus)
      }, [])

      const phase = status?.phase ?? 'idle'
      const currentVersion = status?.currentVersion ?? ''
      const baselineVersion = window.__DSH_BASE_VERSION__ || '未知'
      const newVersion = status?.newVersion
      const percent = status?.percent ?? 0

      let statusText
      if (phase === 'checking') statusText = '正在检查更新…'
      else if (phase === 'available') statusText = `发现新版本 v${newVersion ?? ''}，正在后台下载…`
      else if (phase === 'downloading') statusText = `正在下载更新… ${percent}%`
      else if (phase === 'downloaded') statusText = `新版本 v${newVersion ?? ''} 已就绪`
      else if (phase === 'not-available') statusText = '已是最新版本'
      else if (phase === 'error') statusText = '检查更新失败，请稍后重试'
      else statusText = '尚未检查更新'

      const busy = phase === 'checking' || phase === 'available' || phase === 'downloading'
      const buttonStyle = {
        padding: '6px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
        fontSize: '13px', background: '#38bdf8', color: '#0f172a', fontWeight: 500,
      }
      const actionButton = phase === 'downloaded'
        ? h('button', { onClick: () => window.desktopBridge?.updater?.install(), style: { ...buttonStyle, background: '#16a34a', color: '#f8fafc' } }, '重启以更新')
        : h('button', {
            onClick: () => window.desktopBridge?.updater?.check(),
            disabled: busy,
            style: { ...buttonStyle, ...(busy ? { opacity: 0.5, cursor: 'default' } : {}) },
          }, phase === 'checking' ? '检查中…' : '检查更新')

      return h('div', { style: { padding: '16px 24px', maxWidth: '480px', color: '#f8fafc' } },
        h('h3', { style: { margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600 } }, '关于'),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
          h('div', null,
            h('div', { style: { fontSize: '14px', fontWeight: 500 } }, 'DSH Desktop'),
            h('div', { style: { fontSize: '12px', color: '#94a3b8', marginTop: '2px' } }, 'DeepSeek Harness 桌面客户端'),
          ),
          h('div', { style: { fontSize: '13px', color: '#94a3b8' } }, `v${currentVersion}`),
        ),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
          h('div', null,
            h('div', { style: { fontSize: '14px', fontWeight: 500 } }, '上游基线'),
            h('div', { style: { fontSize: '12px', color: '#94a3b8', marginTop: '2px' } }, '@deepseek-ai/dsh 官方包版本'),
          ),
          h('div', { style: { fontSize: '13px', color: '#94a3b8' } }, baselineVersion),
        ),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' } },
          h('div', null,
            h('div', { style: { fontSize: '14px', fontWeight: 500 } }, '检查更新'),
            h('div', { style: { fontSize: '12px', color: '#94a3b8', marginTop: '2px' } }, statusText),
          ),
          actionButton,
        ),
      )
    }

    return module.exports
  },
})
