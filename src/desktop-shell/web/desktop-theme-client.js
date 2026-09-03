/**
 * @lansi-ai/dsh-desktop-theme —— 桌面主题设置注入（图标主题 / 颜色主题独立设置）。
 *
 * 通过官方 Cordis Slots 机制向设置面板注册「主题」section，内含两个**相互独立**
 * 的设置项（对应 settings `desktop` namespace 两个独立 key）：
 *   - 图标主题（iconThemeId）：更换应用/任务栏/托盘图标，经 desktopBridge.iconTheme
 *     读写（desktop.iconTheme.list/set），V1 可用；
 *   - 颜色主题（colorThemeId）：界面配色体系，后续版本单独实现独立选择器，
 *     与图标主题互不约束。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-desktop-theme',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    // Cordis 模块系统中 React 不是全局变量，必须 require 获取（hooks 依赖）。
    const React = require('react')
    const h = React.createElement

    /** 主题图标内联渲染服务（apply 时注入；预览用）。 */
    let themeIconSvc = null

    // ── 插件声明：注册 settings.section slot ──────────────────────

    exports.inject = ['slots', 'themeIcon']
    exports.apply = (ctx) => {
      themeIconSvc = ctx.get('themeIcon') ?? null
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'theme',
        order: 11,
        label: () => '\u4e3b\u9898',
        locale: '@lansi-ai/dsh-desktop-theme',
      }, function DesktopThemeSection() {
        return h('div', { style: { padding: '16px 24px', maxWidth: '480px', color: '#f8fafc' } },
          h('h3', { style: { margin: '0 0 4px 0', fontSize: '16px', fontWeight: 600 } }, '\u4e3b\u9898'),
          h(IconThemeBlock, null),
          h(ColorThemeBlock, null),
        )
      }))
    }

    /** 子区块标题（图标主题 / 颜色主题共用）。 */
    function BlockTitle({ text }) {
      return h('div', { style: { fontSize: '14px', fontWeight: 600, margin: '16px 0 4px 0' } }, text)
    }

    // ── 图标主题（iconThemeId · 独立设置项，可用）─────────────────

    /**
     * 图标主题选择器：加载清单 → 渲染主题卡片列表 → 点击切换。
     * 切换经主进程 desktop.iconTheme.set（settings `iconThemeId` 持久化 +
     * 图标即时应用），与颜色主题互不影响。
     */
    function IconThemeBlock() {
      const [themes, setThemes] = React.useState([])
      const [current, setCurrent] = React.useState('')
      const [hint, setHint] = React.useState('')
      const [loading, setLoading] = React.useState(true)

      React.useEffect(() => {
        const bridge = window.desktopBridge
        if (!bridge?.iconTheme) {
          setLoading(false)
          setHint('\u6865\u63a5\u672a\u5c31\u7eea\uff0c\u65e0\u6cd5\u52a0\u8f7d\u56fe\u6807\u4e3b\u9898')
          return
        }
        bridge.iconTheme.list().then((result) => {
          setThemes(result.themes)
          setCurrent(result.current)
          setLoading(false)
        }).catch(() => {
          setLoading(false)
          setHint('\u56fe\u6807\u4e3b\u9898\u6e05\u5355\u52a0\u8f7d\u5931\u8d25')
        })
      }, [])

      const handleSelect = (id) => {
        if (id === current) return
        const bridge = window.desktopBridge
        if (!bridge?.iconTheme) return
        bridge.iconTheme.set(id).then((result) => {
          if (result.ok && result.current) {
            setCurrent(result.current)
            setHint('\u5df2\u5207\u6362\u56fe\u6807\u4e3b\u9898\uff0c\u56fe\u6807\u5df2\u5e94\u7528')
          } else {
            setHint(result.message ?? '\u5207\u6362\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5')
          }
        }).catch(() => {
          setHint('\u5207\u6362\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5')
        })
      }

      return h('div', null,
        h(BlockTitle, { text: '\u56fe\u6807\u4e3b\u9898' }),
        h('div', { style: { fontSize: '12px', color: '#94a3b8', margin: '0 0 10px 0' } },
          '\u66f4\u6362\u5e94\u7528\u56fe\u6807\uff08\u7a97\u53e3/\u4efb\u52a1\u680f/\u6258\u76d8\uff09\uff0c\u4e0e\u989c\u8272\u4e3b\u9898\u76f8\u4e92\u72ec\u7acb\uff1b\u5b89\u88c5\u5668\u5feb\u6377\u65b9\u5f0f\u56fe\u6807\u4e0d\u968f\u4e4b\u53d8\u5316'),
        loading
          ? h('div', { style: { fontSize: '13px', color: '#94a3b8', padding: '6px 0' } }, '\u6b63\u5728\u52a0\u8f7d\u2026')
          : themes.map((theme) => h(ThemeItem, {
              key: theme.id,
              theme,
              active: theme.id === current,
              onSelect: () => handleSelect(theme.id),
            })),
        !loading && themes.length === 0
          ? h('div', { style: { fontSize: '13px', color: '#94a3b8', padding: '6px 0' } }, '\u672a\u53d1\u73b0\u53ef\u7528\u56fe\u6807\u4e3b\u9898')
          : null,
        hint ? h('div', { style: { fontSize: '12px', color: '#38bdf8', marginTop: '6px' } }, hint) : null,
      )
    }

    // ── 颜色主题（colorThemeId · 独立设置项，后续版本）────────────

    /**
     * 颜色主题占位块：界面配色体系（骨架变量/托盘色等）的独立设置项，
     * 设置 key `desktop.colorThemeId` 已在契约中预留；接入时此处替换为
     * 独立选择器，不影响图标主题。
     */
    function ColorThemeBlock() {
      return h('div', null,
        h(BlockTitle, { text: '\u989c\u8272\u4e3b\u9898' }),
        h('div', {
          style: {
            padding: '10px 12px',
            marginBottom: '8px',
            borderRadius: '8px',
            border: '1px dashed rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.02)',
            fontSize: '13px',
            color: '#94a3b8',
          },
        }, '\u754c\u9762\u914d\u8272\u4e3b\u9898\u5c06\u4f5c\u4e3a\u72ec\u7acb\u8bbe\u7f6e\u9879\u5728\u540e\u7eed\u7248\u672c\u63d0\u4f9b\uff0c\u4e0e\u56fe\u6807\u4e3b\u9898\u53ef\u4efb\u610f\u7ec4\u5408'),
      )
    }

    /** 单个主题卡片：图标预览 + 名称 + 当前激活标记。 */
    function ThemeItem({ theme, active, onSelect }) {
      const [previewHtml, setPreviewHtml] = React.useState(null)
      React.useEffect(() => {
        let disposed = false
        if (themeIconSvc === null) return
        themeIconSvc.renderSvg(`dsh-ui://app/theme/${theme.id}/icons/titlebar-logo.svg`, 20)
          .then((value) => {
            if (!disposed) setPreviewHtml(value)
          })
          .catch(() => { /* 未提供预览图标则留空 */ })
        return () => {
          disposed = true
        }
      }, [theme.id])
      const baseStyle = {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 12px',
        marginBottom: '8px',
        borderRadius: '8px',
        border: active ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
        background: active ? 'rgba(56,189,248,0.08)' : 'rgba(255,255,255,0.03)',
        cursor: 'pointer',
      }
      return h('div', { style: baseStyle, onClick: onSelect, role: 'button' },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          // 主题图标预览（内联渲染，单色稿随主题文字色、彩色稿保留原色）
          h('span', {
            'aria-hidden': 'true',
            style: { display: 'inline-flex', flexShrink: 0, width: 20, height: 20 },
            dangerouslySetInnerHTML: { __html: previewHtml ?? '' },
          }),
          h('div', null,
            h('div', { style: { fontSize: '14px', fontWeight: 500 } }, theme.name),
            h('div', { style: { fontSize: '12px', color: '#94a3b8' } }, theme.id),
          ),
        ),
        active ? h('span', { style: { fontSize: '13px', color: '#38bdf8' } }, '\u2713 \u5f53\u524d') : null,
      )
    }

    return module.exports
  },
})
