/**
 * @dsh-desktop/desktop-settings —— 桌面设置页面注入（M2·e 官方 UI 注入）。
 *
 * 通过官方 Cordis Slots 机制向设置面板注册「桌面」section，提供：
 *   - 托盘行为开关（trayEnabled）
 *   - 通知偏好开关（notificationsEnabled）
 *   - 快捷键提示（显示已注册的全局快捷键）
 *   - 面板布局设置（panelPosition）
 *
 * 设置读写经官方 settings.describe / settings.mutate RPC → host settings-file 持久化。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@dsh-desktop/desktop-settings',
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

    /** 设置项定义。 */
    const SETTINGS_ITEMS = [
      { key: 'trayEnabled', label: '\u6258\u76d8\u9a7b\u7559', description: '\u5173\u95ed\u7a97\u53e3\u65f6\u9690\u85cf\u5230\u6258\u76d8\u800c\u975e\u9000\u51fa', defaultValue: 'true' },
      { key: 'notificationsEnabled', label: '\u7cfb\u7edf\u901a\u77e5', description: '\u5ba1\u6279/\u9519\u8bef/\u8fdb\u5c55\u7b49\u4e8b\u4ef6\u5f39\u51fa\u7cfb\u7edf\u901a\u77e5', defaultValue: 'true' },
      { key: 'shortcutsEnabled', label: '\u5168\u5c40\u5feb\u6377\u952e', description: 'Alt+Shift+Q \u5524\u8d77\u7a97\u53e3\uff0cAlt+Shift+Space \u5feb\u901f\u95ee\u7b54', defaultValue: 'true' },
      { key: 'panelPosition', label: '\u9762\u677f\u4f4d\u7f6e', description: '\u684c\u9762\u9762\u677f\u7684\u9ed8\u8ba4\u663e\u793a\u4f4d\u7f6e', defaultValue: 'sidebar', type: 'select', options: [
        { value: 'sidebar', label: '\u4fa7\u8fb9\u680f' },
        { value: 'floating', label: '\u60ac\u6d6e\u7a97' },
      ]},
    ]

    // ── 插件声明：注册 settings.section slot ──────────────────────

    exports.inject = ['slots']
    exports.apply = (ctx) => {
      // 通过闭包捕获 ctx，组件内部直接访问（不依赖 slot 传参）
      const getCtx = () => ctx

      // 注入桌面设置 section（order=10，排在 General(0) 之后）
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'desktop',
        order: 10,
        label: () => '\u684c\u9762',
        locale: '@dsh-desktop/desktop-settings',
        // 注意：不要声明 children（子 slot 名全局唯一，官方 general 已占用
        // settings.general.item；再声明会抛 "already declared" 使 section 注册失败）
      }, function DesktopSettingsSection() {
        const context = getCtx()
        return h('div', { style: { padding: '16px 24px', maxWidth: '480px', color: '#f8fafc' } },
          h('h3', { style: { margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600 } }, '\u684c\u9762\u8bbe\u7f6e'),
          ...SETTINGS_ITEMS.map((item) => {
            if (item.type === 'select') {
              return h(SelectSetting, { key: item.key, item, ctx: context })
            }
            return h(ToggleSetting, { key: item.key, item, ctx: context })
          }),
          h(AutoStartSetting, { ctx: context }),
          h(ShortcutHints, null),
        )
      }))
    }

    // ── UI 组件 ──────────────────────────────────────────────────

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

    /** Toggle 开关组件。 */
    function ToggleSetting({ item, ctx }) {
      const [value, setValue] = React.useState(() => readConfig(ctx, item.key, item.defaultValue) === 'true')
      const handleChange = (e) => {
        const newVal = e.target.checked
        setValue(newVal)
        writeConfig(ctx, item.key, newVal)
      }
      return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
        h('div', null,
          h('div', { style: { fontSize: '14px', fontWeight: 500 } }, item.label),
          h('div', { style: { fontSize: '12px', color: '#94a3b8', marginTop: '2px' } }, item.description),
        ),
        h('input', {
          type: 'checkbox',
          checked: value,
          onChange: handleChange,
          style: { width: '18px', height: '18px', cursor: 'pointer', accentColor: '#38bdf8' },
        }),
      )
    }

    /** Select 下拉组件。 */
    function SelectSetting({ item, ctx }) {
      const [value, setValue] = React.useState(() => readConfig(ctx, item.key, item.defaultValue))
      const handleChange = (e) => {
        const newVal = e.target.value
        setValue(newVal)
        writeConfig(ctx, item.key, newVal)
      }
      return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
        h('div', null,
          h('div', { style: { fontSize: '14px', fontWeight: 500 } }, item.label),
          h('div', { style: { fontSize: '12px', color: '#94a3b8', marginTop: '2px' } }, item.description),
        ),
        h('select', {
          value,
          onChange: handleChange,
          style: { padding: '4px 8px', borderRadius: '6px', background: '#334155', color: '#f8fafc', border: '1px solid #475569', fontSize: '13px' },
        },
          ...item.options.map((opt) => h('option', { key: opt.value, value: opt.value }, opt.label)),
        ),
      )
    }

    /** 开机自启 Toggle（状态真源 = OS 登录项，经 desktopBridge.autostart 实时读写）。 */
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
      return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
        h('div', null,
          h('div', { style: { fontSize: '14px', fontWeight: 500 } }, '\u5f00\u673a\u81ea\u542f'),
          h('div', { style: { fontSize: '12px', color: '#94a3b8', marginTop: '2px' } },
            '\u767b\u5f55\u7cfb\u7edf\u540e\u81ea\u52a8\u542f\u52a8\u5e76\u9759\u9ed8\u9a7b\u7559\u6258\u76d8',
            hint ? h('div', { style: { fontSize: '12px', color: '#fbbf24', marginTop: '2px' } }, hint) : null,
          ),
        ),
        h('input', {
          type: 'checkbox',
          checked: value,
          onChange: handleChange,
          style: { width: '18px', height: '18px', cursor: 'pointer', accentColor: '#38bdf8' },
        }),
      )
    }

    /** 快捷键提示组件（只读展示）。 */
    function ShortcutHints() {
      const shortcuts = [
        { accelerator: 'Alt+Shift+Q', action: '\u5524\u8d77/\u805a\u7126\u7a97\u53e3' },
        { accelerator: 'Alt+Shift+Space', action: '\u5feb\u901f\u95ee\u7b54' },
      ]
      return h('div', { style: { padding: '12px 0' } },
        h('div', { style: { fontSize: '14px', fontWeight: 500, marginBottom: '8px' } }, '\u5168\u5c40\u5feb\u6377\u952e'),
        ...shortcuts.map((s) => h('div', {
          key: s.accelerator,
          style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '13px', color: '#94a3b8' },
        },
          h('span', null, s.action),
          h('code', { style: { background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' } }, s.accelerator),
        )),
      )
    }

    return module.exports
  },
})
