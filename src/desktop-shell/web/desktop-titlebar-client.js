/**
 * @lansi-ai/dsh-desktop-titlebar —— 桌面自绘标题栏插件（v4：左侧品牌区 + SVG 图标）。
 *
 * 背景（M3-c5 → 本重构）：
 *   此前 titlebar 以 body 级 `position:fixed` 浮层挂在 `#root` 之外（兄弟关系），
 *   导致 fixed 浮层悬在主区上方、遮住/干扰主区。现改为：布局插件在 root 槽位里
 *   声明 `titlebar` 行（两行 grid 的行1，跨全宽），本插件注册 `titlebar` 槽位，
 *   把拖拽区 + 窗控 + 下边线渲染进该行 —— 成为文档流一部分，不再 fixed。
 *
 * v3 改进：SVG 图标 + 最大化状态切换
 * v4 改进：左侧品牌区（logo + 品牌名 + 折叠按钮），从 sidebar 迁移至此
 *
 * 职责边界：本插件只管标题栏自身（拖拽区/窗控/品牌区/下边线）；布局行骨架归
 *   @lansi-ai/dsh-desktop-layout。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-desktop-titlebar',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect } = React

    /** 主题图标内联渲染服务（apply 时注入；未就绪时回退官方 logo）。 */
    let themeIconSvc = null

    /** SVG 图标常量（viewBox 24，Windows/Fluent 风格，离线内联图标集）。 */
    const ICON_MINIMIZE = 'M 5 12.5 H 19'
    const ICON_MAXIMIZE = 'M 5.25 5.25 H 18.75 V 18.75 H 5.25 Z'
    /** 还原图标：大框(左下) + 小框(右上)，两个闭合方框堆叠，与单框最大化图标明显区分。 */
    const ICON_RESTORE = 'M 5.25 9.2 L 5.25 18.75 L 14.8 18.75 L 14.8 9.2 Z M 9.2 5.25 L 9.2 14.8 L 18.75 14.8 L 18.75 5.25 Z'
    const ICON_CLOSE = 'M 6 6 L 18 18 M 18 6 L 6 18'

    /** 折叠按钮图标（箭头指向左/右）。 */
    const ICON_CHEVRON_LEFT = 'M 14.5 5.5 L 8.5 12 L 14.5 18.5'
    const ICON_CHEVRON_RIGHT = 'M 9.5 5.5 L 15.5 12 L 9.5 18.5'

    /** 创建 SVG 图标元素（path 用 <path> 元素包裹，纯文本是无效 SVG）。 */
    function makeSvgIcon(pathD, strokeWidth) {
      strokeWidth = strokeWidth || 2
      return h('svg', {
        className: 'dsh-desktop-titlebar-icon',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: strokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }, h('path', { d: pathD }))
    }

    /** 品牌 logo 占位（官方品牌组件不可用时的兜底，避免渲染崩坏）。 */
    function BrandLogo({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true,
      },
        h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 6, fill: '#4f6ef7' }),
        h('text', { x: 12, y: 16, textAnchor: 'middle', fontSize: 10, fill: '#fff', fontFamily: 'system-ui', fontWeight: 600 }, 'D'),
      )
    }

    /**
     * 解析官方 DeepSeek 品牌组件（FishLogo / BrandWordmark）。
     *
     * 官方 `dsh-client-ui-primitives` 由官方 dist 外壳作为运行时 seed 静态模块注入
     * （dist 的 `__ModuleLoader__.create({ staticModules })` 映射 `dsh-client-ui-primitives`），
     * 因此本插件可直接 `require` 取到官方鲸鱼 logo + "DeepSeek" 字标，渲染完全一致。
     * 解析失败时返回 null，由调用方回退到内置占位（不抛错、不崩坏标题栏）。
     */
    let officialBrand = undefined
    function getOfficialBrand() {
      if (officialBrand !== undefined) return officialBrand
      try {
        const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
        if (primitives && typeof primitives.FishLogo === 'function' && typeof primitives.BrandWordmark === 'function') {
          officialBrand = { mark: primitives.FishLogo, name: primitives.BrandWordmark }
          return officialBrand
        }
      } catch (error) {
        console.warn('[dsh-desktop-titlebar] 官方品牌组件不可用，回退占位:', error)
      }
      officialBrand = null
      return officialBrand
    }

    /**
     * 主题品牌 logo（方式 A · 内联渲染）。
     *
     * 激活图标主题非 default 时，品牌 logo 用主题包 icons/titlebar-logo.svg（经
     * dsh-ui://app/theme/current/ 动态路由映射）；经 themeIcon.renderSvg 内联渲染，
     * 单色稿随主题文字色变、彩色稿保留原色。default 保持官方鲸鱼 logo 原貌。
     * theme.icon-change 下行事件触发重取（?t= 破缓存）。
     */
    function useThemeLogo() {
      const [logoHtml, setLogoHtml] = useState(null)
      useEffect(() => {
        let disposed = false
        const bridge = window.desktopBridge
        const refresh = () => {
          bridge?.iconTheme?.list?.().then((result) => {
            if (disposed) return
            const active = result?.current && result.current !== 'default'
            if (!active || themeIconSvc === null) {
              setLogoHtml(null)
              return
            }
            themeIconSvc.renderSvg(`dsh-ui://app/theme/current/icons/titlebar-logo.svg?t=${Date.now()}`, 24)
              .then((value) => {
                if (!disposed) setLogoHtml(value)
              })
              .catch(() => {
                if (!disposed) setLogoHtml(null)
              })
          }).catch(() => { /* bridge 未就绪，保持官方 logo */ })
        }
        refresh()
        const off = bridge?.onDesktopEvent?.((event) => {
          if (event?.action === 'theme.icon-change') setTimeout(refresh, 50)
        })
        return () => {
          disposed = true
          if (typeof off === 'function') off()
        }
      }, [])
      return { logoHtml }
    }

    /** 注入标题栏样式（幂等：先清理旧 style 再写）。 */
    function injectStyles() {
      const css = `
/* 标题栏行：左侧品牌区 + 中间拖拽区 + 右侧窗控 */
.dsh-desktop-titlebar {
  -webkit-app-region: drag;
  app-region: drag;
  height: var(--dsd-titlebar-h, 50px);
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  user-select: none;
  position: relative;
}

/* 左侧品牌区：logo + 品牌名 + 折叠按钮 */
.dsh-desktop-titlebar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 10px;
  height: 100%;
  -webkit-app-region: no-drag;
  app-region: no-drag;
  flex-shrink: 0;
}
.dsh-desktop-titlebar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.dsh-desktop-titlebar-brand:hover {
  background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.10));
}
.dsh-desktop-titlebar-brand-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--dsw-alias-label-primary, #1a1a24);
}
.dsh-desktop-titlebar-brand-version {
  font-size: 11px;
  font-weight: 400;
  color: var(--dsw-alias-label-secondary, #6b6b76);
  padding: 1px 6px;
  border-radius: 6px;
  background: light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.08));
  white-space: nowrap;
  flex-shrink: 0;
}
.dsh-desktop-titlebar-collapse {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-primary, #1a1a24);
  transition: background-color 120ms ease;
  padding: 0;
}
.dsh-desktop-titlebar-collapse:hover {
  background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.10));
}

/* 右侧窗控区 */
.dsh-desktop-titlebar-controls {
  display: flex;
  align-items: center;
  height: 100%;
  margin-left: auto;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
.dsh-desktop-titlebar [data-dsh-control] {
  width: 46px;
  height: var(--dsd-titlebar-h, 50px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  user-select: none;
  color: var(--dsw-alias-label-primary, #1a1a24);
  transition: background-color 120ms ease;
}
.dsh-desktop-titlebar [data-dsh-control]:hover {
  background: light-dark(rgba(0,0,0,0.08), rgba(255,255,255,0.12));
}
.dsh-desktop-titlebar [data-dsh-control="close"]:hover { background: #e81123; }
.dsh-desktop-titlebar [data-dsh-control="close"]:hover svg path { stroke: #fff; }

/* SVG 图标样式 */
.dsh-desktop-titlebar-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* 最大化/还原图标特殊尺寸 */
.dsh-desktop-titlebar [data-dsh-control="maximize"] .dsh-desktop-titlebar-icon {
  width: 15px;
  height: 15px;
}

/* 折叠按钮图标尺寸 */
.dsh-desktop-titlebar-collapse .dsh-desktop-titlebar-icon {
  width: 13px;
  height: 13px;
}
`
      document.querySelector('style[data-plugin="@lansi-ai/dsh-desktop-titlebar"]')?.remove()
      const tag = document.createElement('style')
      tag.dataset.plugin = '@lansi-ai/dsh-desktop-titlebar'
      tag.textContent = css
      document.head.appendChild(tag)
    }

    /** 窗控按钮（no-drag 区域内的可点击按钮，经 windowControl 白名单 IPC 动作）。 */
    function ControlButton(props) {
      const action = props.action
      const iconPath = props.iconPath

      return h('div', {
        'data-dsh-control': action,
        onClick: (e) => {
          e.stopPropagation()
          window.desktopBridge?.windowControl?.[action]?.()
        },
      }, makeSvgIcon(iconPath, action === 'close' ? 2.4 : 2))
    }

    /** 标题栏槽位内容：左侧品牌区 + 右侧窗控。 */
    function TitlebarRoot({ collapsed, toggleSidebar }) {
      const [isMaximized, setIsMaximized] = useState(false)

      // 监听窗口状态事件，更新最大化/还原图标。
      // onWindowEvent 挂在 desktopBridge.windowManager 下（preload 契约），非根级。
      useEffect(() => {
        const dispose = window.desktopBridge?.windowManager?.onWindowEvent?.((event) => {
          if (event.type === 'window/state-changed') {
            const payload = event.payload || {}
            setIsMaximized(payload.maximized === true)
          }
        })
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      }, [])

      const maximizeIcon = isMaximized ? ICON_RESTORE : ICON_MAXIMIZE
      const collapseIcon = collapsed ? ICON_CHEVRON_RIGHT : ICON_CHEVRON_LEFT

      // 品牌区：主题 logo（图标主题激活时）> 官方 DeepSeek 品牌组件 > 内置占位。
      // 不再用 renderSlot('sidebar.brand.*') —— 该子槽位不属于 titlebar 槽的
      // children 声明，跨槽位调用会触发 SlotOwnershipError 崩溃。
      const brand = getOfficialBrand()
      const { logoHtml } = useThemeLogo()

      return h('div', { className: 'dsh-desktop-titlebar' },
        // 左侧品牌区
        h('div', { className: 'dsh-desktop-titlebar-left' },
          // Logo（主题 logo 内联 / 官方 FishLogo / 占位兜底）。品牌区仅作展示。
          h('div', { className: 'dsh-desktop-titlebar-brand', title: 'DSH Desktop' },
            logoHtml
              ? h('span', {
                  'aria-hidden': 'true',
                  style: { display: 'inline-flex', width: 24, height: 24 },
                  // 单色稿随主题文字色、彩色稿保留原色
                  dangerouslySetInnerHTML: { __html: logoHtml },
                })
              : brand ? h(brand.mark, { size: 24 }) : h(BrandLogo, { size: 24 }),
            h('span', { className: 'dsh-desktop-titlebar-brand-name' },
              brand ? h(brand.name, { includeMark: false }) : 'DeepSeek'),
            // DSH 基线版本号（由主机注入的 __DSH_BASE_VERSION__ 全局供给）
            h('span', { className: 'dsh-desktop-titlebar-brand-version' },
              window.__DSH_BASE_VERSION__ || ''),
          ),
          // 折叠按钮
          h('button', {
            type: 'button',
            className: 'dsh-desktop-titlebar-collapse',
            title: collapsed ? '展开侧边栏' : '收起侧边栏',
            'aria-label': collapsed ? '展开侧边栏' : '收起侧边栏',
            onClick: () => toggleSidebar?.(),
          }, makeSvgIcon(collapseIcon, 2)),
        ),
        // 右侧窗控区
        h('div', { className: 'dsh-desktop-titlebar-controls' },
          h(ControlButton, { action: 'minimize', iconPath: ICON_MINIMIZE }),
          h(ControlButton, { action: 'maximize', iconPath: maximizeIcon }),
          h(ControlButton, { action: 'close', iconPath: ICON_CLOSE }),
        ),
      )
    }

    exports.inject = ['slots', 'layout', 'themeIcon']

    exports.apply = (ctx) => {
      injectStyles()
      // 主题图标内联渲染服务（未注入时回退官方 logo）
      themeIconSvc = ctx.get('themeIcon') ?? null
      const dispose = ctx.slots.register({
        name: 'titlebar',
        id: 'desktop-titlebar',
        inject: () => ({
          toggleSidebar: () => ctx.layout.toggleSidebar(),
        }),
      }, TitlebarRoot)
      return () => dispose()
    }

    return module.exports
  },
})
