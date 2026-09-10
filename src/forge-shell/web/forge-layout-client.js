/**
 * @lansi-ai/dsh-forge-layout —— 桌面版布局插件（方案 B：接管 root 槽位）。
 *
 * 职责：
 *   1. 注册 root 槽位，提供三列布局（sidebar | center | rightbar）
 *   2. 实现状态管理（侧边栏宽度、视口测量、右侧面板偏好与呈现上报）
 *   3. 提供 ctx.layout 服务（与官方布局插件兼容）
 *   4. 支持拖拽调整宽度（rAF 节流 + 指针取消/丢捕获兜底）
 *   5. 响应式：< 1024px 自动折叠侧边栏
 *
 * 0.1.5-alpha.1 适配（A2）：details 槽位演进为 rightbar 报告式契约——占用方
 * （官方 ui-sidebar-right）经 ctx.layout.openRightbar(track, fullscreen) 上报
 * 呈现，本件只解析几何（轨道列宽 + 手柄定位）；面板本体由占用方绝对定位
 * 自绘（锚定列右缘，无轨道时悬于中央列上方；fullscreen 走 position:fixed
 * 全视口覆盖），列容器只承担 position:relative。会话门控由占用方自管
 * （官方 0.1.5 移除了布局层的会话切换自动关闭逻辑）。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-forge-layout',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const { useRef, useEffect, useLayoutEffect, useState, useCallback } = React
    const runtime = require('@deepseek-ai/dsh-client-store')

    // ── 常量 ──────────────────────────────────────────────────

    /** 侧边栏自动折叠的视口宽度阈值（LG breakpoint）。 */
    const SIDEBAR_AUTO_COLLAPSE = 1024

    /** 侧边栏宽度范围（px）。 */
    const SIDEBAR_MIN = 264
    const SIDEBAR_MAX = 420
    const SIDEBAR_DEFAULT = 280
    const SIDEBAR_RAIL = 56

    /** 右侧面板宽度契约（0.1.5：下限 + 比例上限/默认值）。 */
    const RIGHTBAR_MIN = 300
    const RIGHTBAR_MAX_RATIO = 0.7
    const RIGHTBAR_DEFAULT_RATIO = 0.45

    /** 中央列最小宽度（0.1.5 官方由 640 收窄为 400）。 */
    const CENTER_MIN = 400

    // ── 工具函数 ──────────────────────────────────────────────────

    /** Clamp 值到范围 [min, max]。 */
    const clampWidth = (px, min, max) => Math.min(max, Math.max(min, Math.round(px)))

    /**
     * 计算三列布局宽度（对齐官方 0.1.5 columns.ts）。
     * 右侧先收缩、再失轨道，中央列才可能低于 CENTER_MIN（可降至 0）。
     */
    const computeColumns = (viewport, sidebar, rightbar) => {
      const s = sidebar === 0 ? SIDEBAR_RAIL : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
      const available = viewport - s - CENTER_MIN
      const r = rightbar === 0 || available < RIGHTBAR_MIN
        ? 0
        : Math.min(available, clampWidth(rightbar, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO))
      return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r }
    }

    // ── 状态管理 ──────────────────────────────────────────────────

    /**
     * 创建布局状态存储（对齐官方 0.1.5 布局插件 stores.ts）。
     * rightbar* 呈现四态由占用方经 openRightbar 上报（shown/track/fullscreen），
     * instant 为全屏退出的瞬时过渡抑制标记。
     */
    function createLayoutStore() {
      return runtime.defineStore({
        init: () => ({
          sidebar: SIDEBAR_DEFAULT,
          viewportWidth: window.innerWidth,
          narrowExpanded: false,
          rightbar: null,
          rightbarShown: false,
          rightbarTrack: false,
          rightbarFullscreen: false,
          rightbarInstant: false,
        }),
        actions: {
          setSidebar: (d, px) => {
            d.rightbarInstant = false
            d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX)
          },
          toggleSidebar: (d) => {
            d.rightbarInstant = false
            if (d.viewportWidth < SIDEBAR_AUTO_COLLAPSE) d.narrowExpanded = !d.narrowExpanded
            else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
          },
          setViewportWidth: (d, width) => {
            if (d.viewportWidth === width) return
            d.rightbarInstant = false
            if (d.viewportWidth < SIDEBAR_AUTO_COLLAPSE !== width < SIDEBAR_AUTO_COLLAPSE) d.narrowExpanded = false
            d.viewportWidth = width
          },
          setRightbar: (d, px) => {
            d.rightbarInstant = false
            d.rightbar = clampWidth(px, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, d.viewportWidth * RIGHTBAR_MAX_RATIO))
          },
          openRightbar: (d, track, fullscreen) => {
            if (!d.rightbarShown || d.rightbarTrack !== track || d.rightbarFullscreen !== fullscreen) {
              d.rightbarInstant = d.rightbarFullscreen && !fullscreen
            }
            if (!d.rightbarShown && d.viewportWidth < SIDEBAR_AUTO_COLLAPSE) d.narrowExpanded = false
            d.rightbar ??= Math.max(RIGHTBAR_MIN, Math.round(d.viewportWidth * RIGHTBAR_DEFAULT_RATIO))
            d.rightbarShown = true
            d.rightbarTrack = track
            d.rightbarFullscreen = fullscreen
          },
          closeRightbar: (d) => {
            if (d.rightbarShown) d.rightbarInstant = d.rightbarFullscreen
            d.rightbarShown = false
            d.rightbarTrack = false
            d.rightbarFullscreen = false
          },
        },
      })
    }

    // ── LayoutController 服务 ──────────────────────────────────────────

    /**
     * 跨插件面板操作服务（ctx.layout，对齐官方 0.1.5 ILayout）。
     * openRightbar 为报告式 API：占用方上报 track（是否保留轨道列）与
     * fullscreen（全视口覆盖、隐藏外层手柄）。
     */
    class LayoutController {
      #panels

      attachPanels(actions) {
        this.#panels = actions
      }

      toggleSidebar() {
        this.#require().toggleSidebar()
      }

      openRightbar(track, fullscreen) {
        this.#require().openRightbar(track, fullscreen)
      }

      closeRightbar() {
        this.#require().closeRightbar()
      }

      #require() {
        if (this.#panels === undefined) {
          throw new Error('layout: panel actions not wired (root entry not mounted)')
        }
        return this.#panels
      }
    }

    // ── 拖拽手柄组件 ──────────────────────────────────────────────────

    /**
     * 拖拽手柄（对齐官方 0.1.5 实现：主键守卫 + 捕获句柄 + 指针取消/丢捕获兜底）。
     */
    function DragHandle({ side, left, onStart, onDrag, onEnd }) {
      const [dragging, setDragging] = useState(false)
      const originRef = useRef(0)
      const latestRef = useRef(0)
      const rafRef = useRef(null)
      const captureRef = useRef(null)
      const callbacksRef = useRef({ onStart, onDrag, onEnd })
      callbacksRef.current = { onStart, onDrag, onEnd }

      const endDrag = useCallback(() => {
        const active = captureRef.current
        if (active === null) return
        captureRef.current = null
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id)
        setDragging(false)
        callbacksRef.current.onEnd()
      }, [])

      useEffect(() => endDrag, [endDrag])

      const onPointerDown = useCallback((e) => {
        if (e.button !== 0 || captureRef.current !== null) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        captureRef.current = { element: e.currentTarget, id: e.pointerId }
        originRef.current = e.clientX
        latestRef.current = e.clientX
        callbacksRef.current.onStart()
        setDragging(true)
      }, [])

      const onPointerMove = useCallback((e) => {
        if (captureRef.current?.id !== e.pointerId) return
        latestRef.current = e.clientX
        rafRef.current ??= requestAnimationFrame(() => {
          rafRef.current = null
          callbacksRef.current.onDrag(latestRef.current - originRef.current)
        })
      }, [])

      const onPointerUp = useCallback((e) => {
        if (captureRef.current?.id !== e.pointerId) return
        callbacksRef.current.onDrag(e.clientX - originRef.current)
        endDrag()
      }, [endDrag])

      const onPointerCancel = useCallback((e) => {
        if (captureRef.current?.id === e.pointerId) endDrag()
      }, [endDrag])

      return React.createElement('div', {
        className: 'dsh-forge-layout-handle',
        style: { left: left + 'px' },
        'data-side': side,
        'data-dragging': dragging || undefined,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel,
        onLostPointerCapture: onPointerCancel,
      })
    }

    // ── AppFrame 组件 ──────────────────────────────────────────────────

    /**
     * 桌面版 AppFrame：三列布局根组件（行1 标题栏 + 行2 三列内容区）。
     * rightbar 为 strict session scope 槽位，须经 SessionProvider 提供 scope
     * 绑定，并向占用方传 { width, viewportWidth, canShow } 呈现参数（对齐
     * 官方 ui-layout AppFrame）；会话门控由占用方（ui-sidebar-right）自管。
     */
    function AppFrame({ useStore, actions, renderSlot, SessionProvider }) {
      const panels = useStore(s => s)

      const frameRef = useRef(null)
      const viewport = panels.viewportWidth

      // 视口测量：写入 store（narrow 判定/右侧默认宽度随帧变化重新解析）
      useLayoutEffect(() => {
        const el = frameRef.current
        if (el === null) return
        let raf = null
        let disposed = false
        const measure = () => {
          const width = el.getBoundingClientRect().width
          if (width > 0) actions.setViewportWidth(width)
        }
        measure()
        const observer = new ResizeObserver(() => {
          if (disposed) return
          raf ??= requestAnimationFrame(() => {
            raf = null
            measure()
          })
        })
        observer.observe(el)
        return () => {
          disposed = true
          observer.disconnect()
          if (raf !== null) cancelAnimationFrame(raf)
        }
      }, [actions])

      const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
      const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
      const sidebarPreference = sidebarCollapsed ? 0 : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
      const rightbarPreference = panels.rightbar ?? viewport * RIGHTBAR_DEFAULT_RATIO
      // normal：面板期望几何（手柄定位 + 槽位参数）；cols：实际网格（轨道由 track 决定）
      const normal = computeColumns(viewport, !panels.rightbarShown && narrow ? 0 : sidebarPreference, rightbarPreference)
      const cols = computeColumns(viewport, sidebarPreference, panels.rightbarTrack ? rightbarPreference : 0)

      const colsRef = useRef(cols)
      colsRef.current = cols
      const rightbarWidth = useRef(normal.rightbar)
      rightbarWidth.current = normal.rightbar
      const sidebarBase = useRef(0)
      const rightbarBase = useRef(0)
      const [dragging, setDragging] = useState(false)

      // 拖拽处理
      const onDragEnd = useCallback(() => setDragging(false), [])

      const onSidebarStart = useCallback(() => {
        sidebarBase.current = colsRef.current.sidebar
        setDragging(true)
      }, [])

      const onRightbarStart = useCallback(() => {
        rightbarBase.current = rightbarWidth.current
        setDragging(true)
      }, [])

      const onSidebarDrag = useCallback((dx) => {
        actions.setSidebar(sidebarBase.current + dx)
      }, [actions])

      const onRightbarDrag = useCallback((dx) => {
        actions.setRightbar(rightbarBase.current - dx)
      }, [actions])

      return React.createElement('div', {
        ref: frameRef,
        className: 'dsh-forge-layout-frame',
        'data-sidebar-collapsed': sidebarCollapsed || undefined,
        'data-dragging': dragging || undefined,
        children: [
          // 行1：标题栏区（flex:0 0 固定高，不随窗口放大而变高）
          React.createElement('div', {
            key: 'titlebar',
            className: 'dsh-forge-layout-titlebar',
            children: renderSlot('titlebar', { collapsed: sidebarCollapsed }),
          }),
          // 行2：三列内容区（flex:1 撑满剩余高度；内部用 grid 排 sidebar/center/rightbar）
          React.createElement('div', {
            key: 'body',
            className: 'dsh-forge-layout-body',
            style: {
              gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.rightbar}px`,
            },
            'data-rightbar-collapsed': cols.rightbar === 0 || undefined,
            'data-rightbar-fullscreen': panels.rightbarFullscreen || undefined,
            'data-rightbar-instant': panels.rightbarInstant || undefined,
            children: [
              React.createElement('div', {
                key: 'sidebar',
                className: 'dsh-forge-layout-sidebar',
                style: { gridColumn: 1 },
                children: renderSlot('sidebar', { collapsed: sidebarCollapsed, width: cols.sidebar }),
              }),
              React.createElement('div', {
                key: 'center',
                className: 'dsh-forge-layout-center',
                style: { gridColumn: 2 },
                // 渲染 `main` 槽位（对齐官方 ui-layout 的 MainPanel）：entryKey 固定
                // 'conversation'（桌面无 main keyed 面板切换机制），挂到官方 ui-conversation
                // 注册时声明的 key 上。
                children: renderSlot('main', {}, { entryKey: 'conversation' }),
              }),
              // rightbar 为轨道而非盒子：占用方面板绝对定位锚定列右缘，
              // 无轨道时悬于中央列上方；fullscreen 走 position:fixed 全视口覆盖。
              React.createElement('div', {
                key: 'rightbar',
                className: 'dsh-forge-layout-rightbar',
                style: { gridColumn: 3 },
                children: React.createElement(SessionProvider, {}, renderSlot('rightbar', {
                  width: normal.rightbar,
                  viewportWidth: viewport,
                  canShow: normal.rightbar > 0,
                })),
              }),
            ],
          }),
          // 遮罩层（覆盖整个 frame，含标题栏行；标题栏自身 z-index 高于它）
          React.createElement('div', {
            key: 'overlay',
            className: 'dsh-forge-layout-overlay',
            'data-shell-overlay': true,
            children: renderSlot('shell.overlay', {}),
          }),
          // 侧边栏拖拽手柄
          !sidebarCollapsed && React.createElement(DragHandle, {
            key: 'sidebar-handle',
            side: 'sidebar',
            left: cols.sidebar,
            onStart: onSidebarStart,
            onDrag: onSidebarDrag,
            onEnd: onDragEnd,
          }),
          // 右侧面板手柄（全屏时隐藏外层手柄；仅在面板期望宽度可容纳时出现）
          panels.rightbarShown && !panels.rightbarFullscreen && normal.rightbar > 0 && React.createElement(DragHandle, {
            key: 'rightbar-handle',
            side: 'rightbar',
            left: viewport - normal.rightbar,
            onStart: onRightbarStart,
            onDrag: onRightbarDrag,
            onEnd: onDragEnd,
          }),
        ],
      })
    }

    // ── 样式注入 ──────────────────────────────────────────────────

    /** 注入布局插件自身样式（骨架由宿主 LAYOUT_SKELETON_CSS 负责，此处不做越界覆盖）。 */
    function injectStyles() {
      const css = `
.dsh-forge-layout-frame {
  width: 100%;
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}
/* 标题栏行（行1，flex 子项）：flex-basis 固定 --dsd-titlebar-h（缺省 32px），
   不随窗口放大而变高；z-index 高于遮罩层(20)，模态打开时窗控仍可点击。 */
.dsh-forge-layout-titlebar {
  flex: 0 0 var(--dsd-titlebar-h, 50px);
  height: var(--dsd-titlebar-h, 50px);
  min-width: 0;
  overflow: hidden;
  position: relative;
  z-index: 30;
}
/* 内容区（行2，flex:1 撑满剩余高度）：内部用 grid 排 sidebar/center/rightbar。
   flex:1 保证窗口放大时内容区随高度增长，而 titlebar 保持固定。 */
.dsh-forge-layout-body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: grid;
  grid-template-rows: 100%;
  transition: grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out);
  position: relative;
}
.dsh-forge-layout-frame[data-dragging] .dsh-forge-layout-body,
.dsh-forge-layout-body[data-rightbar-fullscreen],
.dsh-forge-layout-body[data-rightbar-instant] {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-forge-layout-body { transition: none; }
}
.dsh-forge-layout-sidebar {
  min-width: 0;
  overflow: hidden;
}
.dsh-forge-layout-center {
  flex-direction: column;
  min-width: 0;
  display: flex;
  overflow: hidden;
  padding: 0 15px 15px 15px;
}
/* rightbar 轨道列：只承担锚定（面板本体由占用方自绘，绝对定位锚右缘，
   无轨道时悬于中央列上方），故不画背景/边框。 */
.dsh-forge-layout-rightbar {
  min-width: 0;
  position: relative;
  overflow: visible;
}
.dsh-forge-layout-handle {
  cursor: col-resize;
  z-index: 2;
  touch-action: none;
  width: 8px;
  transition: left var(--ds-transition-duration-slow) var(--ds-ease-in-out);
  margin-left: -4px;
  position: absolute;
  top: var(--dsd-titlebar-h, 50px);
  bottom: 0;
}
.dsh-forge-layout-frame[data-dragging] .dsh-forge-layout-handle {
  transition: none;
}
.dsh-forge-layout-handle::after {
  content: '';
  box-sizing: border-box;
  background: var(--dsw-alias-button-floating-fill);
  border: 1px solid var(--dsw-alias-border-l2-darkmode-thin);
  opacity: 0;
  width: 12px;
  height: 32px;
  transition: opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out),
    background var(--ds-transition-duration-slow) var(--ds-ease-in-out),
    border-color var(--ds-transition-duration-slow) var(--ds-ease-in-out);
  border-radius: 10px;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
.dsh-forge-layout-handle:hover::after,
.dsh-forge-layout-handle[data-dragging="true"]::after {
  opacity: 1;
}
.dsh-forge-layout-handle[data-side="rightbar"]:hover::after,
.dsh-forge-layout-handle[data-side="rightbar"][data-dragging="true"]::after {
  background: var(--dsw-alias-button-floating-hover);
  border-color: var(--dsw-alias-border-l3);
}
.dsh-forge-layout-overlay {
  z-index: 20;
  pointer-events: none;
  position: absolute;
  inset: 0;
}
.dsh-forge-layout-overlay > * {
  pointer-events: auto;
}
`
      const tag = document.createElement('style')
      tag.dataset.plugin = '@lansi-ai/dsh-forge-layout'
      tag.textContent = css
      document.head.appendChild(tag)
    }

    // ── ThemePresenter（等价官方 ui-layout 实现）─────────────────────────

    /** Body 属性：选中深色调色板（token 样式表据此切换明暗）。 */
    const DARK_ATTRIBUTE = 'data-ds-dark-theme'
    /** Body 变量：用户内容字号（px）。 */
    const CONTENT_FONT_SIZE_VARIABLE = '--dsh-content-font-size'

    /**
     * 把主题快照应用到文档；每插件实例一个（对齐官方 ui-layout ThemePresenter）。
     * 背景：ui-theme client 半只负责 settings 读写 + 发布 `theme/change` 事件，
     * DOM 应用（color-scheme / 深色属性 / token 变量 / 字号轴 / theme-color meta）
     * 官方由 ui-layout 的 ThemePresenter 承担——M6-P1 接管 root 槽位排除官方
     * ui-layout 时被一并丢掉，导致设置页切外观「写入成功但界面无变化」（坑 26）。
     */
    class ThemePresenter {
      constructor() {
        /** 上次 apply 写入的 token 变量名（回撤清单）。 */
        this.appliedTokens = []
        /** 本实例唯一的 theme-color meta 节点。 */
        this.themeColorMeta = document.createElement('meta')
        this.themeColorMeta.name = 'theme-color'
      }

      /**
       * 把快照投影到文档：按 active.colorScheme（非偏好 id——`system` 已在上游解析）
       * 设置根 color-scheme 与 body 深色属性，发布字号轴，再以 active.tokens
       * 整体替换上次写入的 token 变量；随后按 body 计算背景色刷新 theme-color meta。
       * @param snapshot ctx.theme 的已解析快照。
       */
      apply(snapshot) {
        const scheme = snapshot.active.colorScheme
        document.documentElement.style.colorScheme = scheme
        const body = document.body
        if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '')
        else body.removeAttribute(DARK_ATTRIBUTE)
        body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, `${snapshot.fontSize}px`)
        for (const name of this.appliedTokens) body.style.removeProperty(name)
        this.appliedTokens = []
        for (const [name, value] of Object.entries(snapshot.active.tokens)) {
          body.style.setProperty(name, value)
          this.appliedTokens.push(name)
        }
        this.themeColorMeta.content = getComputedStyle(body).backgroundColor
        if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta)
      }

      /** 回撤根 color-scheme、深色属性、token 变量、字号轴与自有 meta 节点。 */
      dispose() {
        document.documentElement.style.removeProperty('color-scheme')
        const body = document.body
        body.removeAttribute(DARK_ATTRIBUTE)
        body.style.removeProperty(CONTENT_FONT_SIZE_VARIABLE)
        for (const name of this.appliedTokens) body.style.removeProperty(name)
        this.appliedTokens = []
        this.themeColorMeta.remove()
      }
    }

    // ── 插件导出 ──────────────────────────────────────────────────

    exports.inject = ['slots', 'theme']

    exports.apply = (ctx) => {
      const layout = new LayoutController()
      const disposeService = ctx.reflect.provide('layout', layout)

      // 注入样式
      injectStyles()

      // 主题呈现：初始应用当前快照 + 订阅 theme/change（等价官方 ui-layout 的
      // "ui-layout: theme presenter" effect；inject: ['theme'] 保证 ui-theme 先装载）。
      const presenter = new ThemePresenter()
      presenter.apply(ctx.theme.getTheme())
      const offThemeChange = ctx.on('theme/change', (snapshot) => {
        presenter.apply(snapshot)
      })

      // panelInfo root hook —— 官方 ui-layout 的 provideRoot 是它的唯一来源，被
      // ui-sidebar-right 的 RightbarRoot / ui-layout 的 DocumentTitle·MainPanel 经
      // usePanelInfo 消费（0.1.5 新增 rightbar 契约）。接管 root 槽位时必须一并补齐，
      // 否则消费端解构到 undefined → 调用即 TypeError（实机 2026-09-10：
      // "usePanelInfo is not a function" → rightbar 槽位条目崩溃）。
      // 桌面布局直渲染 conversation 槽位（无官方 main keyed 面板机制），故 activePanelId
      // 恒 null —— 语义 = 无面板占用会话区，右栏由占用方经 ctx.layout.openRightbar 上报呈现。
      const panelInfoSnapshot = { activePanelId: null }
      const disposePanelInfo = ctx.slots.provideRoot({
        hooks: {
          panelInfo: {
            getSnapshot: () => panelInfoSnapshot,
            subscribe: () => () => {},
          },
        },
      })

      const disposeRegistration = ctx.slots.register({
        name: 'root',
        children: {
          'titlebar': { kind: 'single', scope: 'root' },
          'sidebar': { kind: 'single', scope: 'root' },
          // `main` 必须按官方 ui-layout 的语义声明（keyed + root）：官方 ui-conversation 以
          // `slots.inject("main", cb)` 等待该槽位、再注册 key='conversation' 的会话面板。
          // 若本插件不声明它，ui-conversation 的注册会把它隐式带成 session-maybe scope →
          // 未选中会话时槽位条目被卸载，其内注册者（ui-agent-preset 的 hero chip / header
          // action）随会话状态反复重建、effect 重跑，踩进 Cordis 的 fiber 激活窗口 →
          // `cannot get required service "sessions" in inactive context` 启动期刷屏。
          // （定位实验 2026-09-10：临时换回官方 ui-layout 后该报错完全消失。）
          'main': { kind: 'keyed', scope: 'root' },
          // 桌面遗留槽位：保留声明以兼容可能的注册者（当前无消费方）。
          'conversation': { kind: 'single', scope: 'session-maybe' },
          'rightbar': { kind: 'single', scope: 'session' },
          'shell.overlay': { kind: 'list', scope: 'root' },
        },
        store: createLayoutStore,
        inject: (actions) => {
          layout.attachPanels(actions)
          return {}
        },
      }, AppFrame)

      return () => {
        offThemeChange()
        presenter.dispose()
        disposePanelInfo()
        disposeRegistration()
        disposeService()
      }
    }

    return module.exports
  },
})
