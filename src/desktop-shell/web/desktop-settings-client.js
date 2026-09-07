/**
 * @lansi-ai/dsh-desktop-settings —— 桌面设置项（并入通用设置分区）。
 *
 * 向通用设置分区（settings.general.item）注入「桌面设置」分组：
 *   - 分组标题行 + 托盘驻留 / 系统通知 / 全局快捷键 / 开机自启 4 行
 * 导航栏不再有独立「桌面」分区。
 *
 * 设置读写沿用官方 settings.describe / settings.mutate RPC → host settings-file 持久化
 * （desktop 命名空间）；开机自启真源 = OS 登录项，经 desktopBridge.autostart 实时读写。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-desktop-settings',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    // Cordis 模块系统中 React 不是全局变量，必须 require 获取（hooks 依赖）。
    // 注意：用 createElement 而非 jsx-runtime 的 jsx —— jsx 签名是 (type, props, key)，
    // children 需放 props.children，多参数传 children 会被忽略并误当 key 导致崩溃。
    const React = require('react')
    const h = React.createElement

    /** 桌面设置命名空间（与 ctx.desktop settingsScope 一致）。 */
    const DESKTOP_NS = 'desktop'

    /** 设置项定义（全局快捷键说明已并入快捷键提示）。 */
    const SETTINGS_ITEMS = [
      { key: 'trayEnabled', label: '\u6258\u76d8\u9a7b\u7559', description: '\u5173\u95ed\u7a97\u53e3\u65f6\u9690\u85cf\u5230\u6258\u76d8\u800c\u975e\u9000\u51fa', defaultValue: 'true' },
      { key: 'notificationsEnabled', label: '\u7cfb\u7edf\u901a\u77e5', description: '\u5ba1\u6279/\u9519\u8bef/\u8fdb\u5c55\u7b49\u4e8b\u4ef6\u5f39\u51fa\u7cfb\u7edf\u901a\u77e5', defaultValue: 'true' },
      { key: 'shortcutsEnabled', label: '\u5168\u5c40\u5feb\u6377\u952e', description: 'Alt+Shift+Q \u5524\u8d77\u7a97\u53e3\uff0cAlt+Shift+Space \u5feb\u901f\u95ee\u7b54', defaultValue: 'true' },
    ]

    // ── 插件声明：向通用设置分区注入「桌面设置」分组 ───────────────

    exports.inject = ['slots']
    exports.apply = (ctx) => {
      // 通过闭包捕获 ctx，行组件内部直接访问（不依赖 slot 传参）
      const getCtx = () => ctx

      // 分组标题行（order=25：官方通用项末尾之后、桌面项之前）
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'desktop-group',
        order: 25,
        locale: '@lansi-ai/dsh-desktop-settings',
      }, DesktopGroupHeader))

      // 四行设置项
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'desktop-tray',
        order: 30,
        locale: '@lansi-ai/dsh-desktop-settings',
      }, () => h(ToggleSetting, { item: SETTINGS_ITEMS[0], ctx: getCtx() })))

      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'desktop-notifications',
        order: 31,
        locale: '@lansi-ai/dsh-desktop-settings',
      }, () => h(ToggleSetting, { item: SETTINGS_ITEMS[1], ctx: getCtx() })))

      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'desktop-shortcuts',
        order: 32,
        locale: '@lansi-ai/dsh-desktop-settings',
      }, () => h(ToggleSetting, { item: SETTINGS_ITEMS[2], ctx: getCtx() })))

      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'desktop-autostart',
        order: 33,
        locale: '@lansi-ai/dsh-desktop-settings',
      }, () => h(AutoStartSetting, { ctx: getCtx() })))
    }

    // ── UI 组件（配色统一跟随主题 token，与设置页一致）──────────

    /** 桌面设置分组标题行。 */
    function DesktopGroupHeader() {
      return h('div', {
        style: { padding: '16px 0 2px', fontSize: '14px', fontWeight: 600, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' },
      }, '\u684c\u9762\u8bbe\u7f6e')
    }

    /** 读取 desktop 配置值。 */
    function readConfig(ctx, key, defaultValue) {
      try {
        const settings = ctx?.get?.('settings')
        if (settings?.register) {
          const Schema = require('@deepseek-ai/schemastery')?.default
          if (Schema) {
            const scope = settings.register(DESKTOP_NS, Schema.dict(Schema.any(), Schema.string()))
            const stored = scope?.get?.()
            if (stored?.[key] !== undefined) return stored[key]
          }
        }
      } catch { /* settings 未就绪 */ }
      return defaultValue
    }

    /** 写入 desktop 配置值。 */
    function writeConfig(ctx, key, value) {
      try {
        const settings = ctx?.get?.('settings')
        if (settings?.register) {
          const Schema = require('@deepseek-ai/schemastery')?.default
          if (Schema) {
            const scope = settings.register(DESKTOP_NS, Schema.dict(Schema.any(), Schema.string()))
            scope?.set?.(key, String(value))
          }
        }
      } catch { /* settings 未就绪 */ }
    }

    /** Toggle 开关行（复用通用设置的行视觉）。 */
    function ToggleSetting({ item, ctx }) {
      const [value, setValue] = React.useState(() => readConfig(ctx, item.key, item.defaultValue) === 'true')
      const handleChange = (e) => {
        const newVal = e.target.checked
        setValue(newVal)
        writeConfig(ctx, item.key, newVal)
      }
      return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
        h('div', null,
          h('div', { style: { fontSize: '14px', fontWeight: 500, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' } }, item.label),
          h('div', { style: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', marginTop: '2px' } }, item.description),
        ),
        h('input', {
          type: 'checkbox',
          checked: value,
          onChange: handleChange,
          style: { width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--dsw-alias-button-info-fill)' },
        }),
      )
    }

    /** 开机自启 Toggle 行（状态真源 = OS 登录项，经 desktopBridge.autostart 实时读写）。 */
    function AutoStartSetting({ ctx }) {
      const [value, setValue] = React.useState(false)
      const [hint, setHint] = React.useState('')
      React.useEffect(() => {
        const bridge = window.desktopBridge
        if (!bridge?.autostart) return
        bridge.autostart.getStatus().then((status) => {
          setValue(status.enabled)
          if (!status.supported) setHint('\u5f53\u524d\u5e73\u53f0\u4e0d\u652f\u6301\u5f00\u673a\u81ea\u542f')
          else if (status.devMode) setHint('\u5f00\u53d1\u6a21\u5f0f\u4e0b\u4e0d\u5199\u5165\u767b\u5f55\u9879\uff0c\u4ec5\u6253\u5305\u7248\u751f\u6548')
          else if (status.message) setHint(status.message)
        }).catch(() => { /* bridge 未就绪 */ })
      }, [])
      const handleChange = (e) => {
        const newVal = e.target.checked
        setValue(newVal)
        // UI 偏好同步写 settings-file（配置持久化）
        writeConfig(ctx, 'autoStartEnabled', newVal)
        const bridge = window.desktopBridge
        if (!bridge?.autostart) return
        bridge.autostart.setEnabled(newVal).then((status) => {
          setValue(status.enabled)
          setHint(status.message ?? '')
        }).catch(() => {
          setValue(!newVal)
          setHint('\u8bbe\u7f6e\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5')
        })
      }
      return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
        h('div', null,
          h('div', { style: { fontSize: '14px', fontWeight: 500, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' } }, '\u5f00\u673a\u81ea\u542f'),
          h('div', { style: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', marginTop: '2px' } },
            '\u767b\u5f55\u7cfb\u7edf\u540e\u81ea\u52a8\u542f\u52a8\u5e76\u9759\u9ed8\u9a7b\u7559\u6258\u76d8',
            hint ? h('div', { style: { fontSize: '12px', lineHeight: '18px', color: '#fbbf24', marginTop: '2px' } }, hint) : null,
          ),
        ),
        h('input', {
          type: 'checkbox',
          checked: value,
          onChange: handleChange,
          style: { width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--dsw-alias-button-info-fill)' },
        }),
      )
    }

    return module.exports
  },
})