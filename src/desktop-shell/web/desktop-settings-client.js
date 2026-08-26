/**
 * @dsh-desktop/desktop-settings-client —— 桌面设置页面注入（M2·e 官方 UI 注入）。
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
/* eslint-disable no-undef -- 浏览器侧 bundle，React 等全局由 renderer 提供 */
window.__ModuleLoader__.load({
  id: '@dsh-desktop/desktop-settings',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const { jsx: h } = require('react/jsx-runtime')

    /** 桌面设置命名空间（与 ctx.desktop settingsScope 一致）。 */
    const DESKTOP_NS = 'desktop'

    /** 设置项定义（key / label / description / defaultValue）。 */
    const SETTINGS_ITEMS = [
      { key: 'trayEnabled', label: '托盘驻留', description: '关闭窗口时隐藏到托盘而非退出', defaultValue: true },
      { key: 'notificationsEnabled', label: '系统通知', description: '审批/错误/进展等事件弹出系统通知', defaultValue: true },
      { key: 'shortcutsEnabled', label: '全局快捷键', description: '启用全局快捷键（Alt+Shift+Q 唤起窗口，Alt+Shift+Space 快速问答）', defaultValue: true },
      { key: 'panelPosition', label: '面板位置', description: '桌面面板的默认显示位置', defaultValue: 'sidebar', type: 'select', options: [
        { value: 'sidebar', label: '侧边栏' },
        { value: 'floating', label: '悬浮窗' },
      ]},
    ]

    /** Toggle 开关组件（受控组件，读写 settingsScope）。 */
    function ToggleSetting({ item, settingsScope }) {
      const [value, setValue] = React.useState(() => {
        const stored = settingsScope?.get?.()
        return stored?.[item.key] ?? item.defaultValue
      })
      const handleChange = async (e) => {
        const newVal = e.target.checked
        setValue(newVal)
        if (settingsScope?.set) {
          await settingsScope.set(item.key, String(newVal))
        }
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
    function SelectSetting({ item, settingsScope }) {
      const [value, setValue] = React.useState(() => {
        const stored = settingsScope?.get?.()
        return stored?.[item.key] ?? item.defaultValue
      })
      const handleChange = async (e) => {
        const newVal = e.target.value
        setValue(newVal)
        if (settingsScope?.set) {
          await settingsScope.set(item.key, newVal)
        }
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

    /** 快捷键提示组件（只读展示）。 */
    function ShortcutHints() {
      const shortcuts = [
        { accelerator: 'Alt+Shift+Q', action: '唤起/聚焦窗口' },
        { accelerator: 'Alt+Shift+Space', action: '快速问答' },
      ]
      return h('div', { style: { padding: '12px 0' } },
        h('div', { style: { fontSize: '14px', fontWeight: 500, marginBottom: '8px' } }, '全局快捷键'),
        ...shortcuts.map((s) => h('div', {
          key: s.accelerator,
          style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '13px', color: '#94a3b8' },
        },
          h('span', null, s.action),
          h('code', { style: { background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' } }, s.accelerator),
        )),
      )
    }

    /** 桌面设置页面主组件。 */
    function DesktopSettingsSection({ settingsScope }) {
      return h('div', { style: { padding: '16px 24px', maxWidth: '480px' } },
        h('h3', { style: { margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600, color: '#f8fafc' } }, '桌面设置'),
        ...SETTINGS_ITEMS.map((item) =>
          item.type === 'select'
            ? h(SelectSetting, { key: item.id, item, settingsScope })
            : h(ToggleSetting, { key: item.id, item, settingsScope })
        ),
        h(ShortcutHints, null),
      )
    }

    // ── 插件声明：注册 settings.section slot ──────────────────────

    exports.inject = ['slots', 'settings']
    exports.apply = (ctx) => {
      // 获取 desktop namespace 的 settings scope（读写桌面配置）
      let desktopScope = null
      try {
        const settings = ctx.get?.('settings')
        if (settings?.register) {
          const Schema = require('@deepseek-ai/schemastery')?.default
          if (Schema) {
            desktopScope = settings.register(DESKTOP_NS, Schema.dict(Schema.any(), Schema.string()))
          }
        }
      } catch {
        // settings 未就绪时降级为只读
      }

      // 注入桌面设置 section（order=10，排在 General(0) 之后）
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'desktop',
        order: 10,
        label: () => '桌面',
        locale: '@dsh-desktop/desktop-settings',
        children: {
          'settings.general.item': { kind: 'list', scope: 'root' },
        },
      }, (props) => h(DesktopSettingsSection, { ...props, settingsScope: desktopScope })))
    }

    return module.exports
  },
})
