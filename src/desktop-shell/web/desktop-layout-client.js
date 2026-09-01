/**
 * @lansi-ai/dsh-desktop-layout —— 桌面版布局插件（方案 B：接管 root 槽位）。
 *
 * 职责：
 *   1. 注册 root 槽位，提供三列布局（sidebar | center | details）
 *   2. 实现状态管理（侧边栏/详情列宽度、窄屏模式）
 *   3. 提供 ctx.layout 服务（与官方布局插件兼容）
 *   4. 支持拖拽调整宽度（rAF 节流）
 *   5. 响应式：< 1024px 自动折叠侧边栏
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-desktop-layout',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const { useRef, useEffect, useLayoutEffect, useState, useCallback } = React
    // 0.1.2：defineStore 从已删除的 @deepseek-ai/dsh-client-runtime 迁至
    // @deepseek-ai/dsh-client-store（引擎与签名不变，仅发行位置迁移）。
    const runtime = require('@deepseek-ai/dsh-client-store')

    // ── 常量 ──────────────────────────────────────────────────

    /** 侧边栏自动折叠的视口宽度阈值（LG breakpoint）。 */
    const SIDEBAR_AUTO_COLLAPSE = 1024

    /** 侧边栏宽度范围（px）。 */
    const SIDEBAR_MIN = 264
    const SIDEBAR_MAX = 420
    const SIDEBAR_DEFAULT = 280
    const SIDEBAR_RAIL = 56

    /** 详情列宽度范围（px）。 */
    const DETAILS_MIN = 300
    const DETAILS_MAX = 520
    const DETAILS_DEFAULT = 360

    /** 中心列最小宽度（px）。 */
    const CENTER_MIN = 640

    // ── 工具函数 ──────────────────────────────────────────────────

    /** Clamp 值到范围 [min, max]。 */
    const clampWidth = (px, min, max) => Math.min(max, Math.max(min, Math.round(px)))

    /**
     * 计算三列布局宽度。
     */
    const computeColumns = (viewport, sidebar, details) => {
      const s = sidebar === 0 ? SIDEBAR_RAIL : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
      const d0 = details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX)

      if (s + d0 + CENTER_MIN <= viewport) {
        return { sidebar: s, center: viewport - s - d0, details: d0 }
      }

      const d1 = d0 === 0 ? 0 : Math.max(DETAILS_MIN, viewport - s - CENTER_MIN)
      if (s + d1 + CENTER_MIN <= viewport) {
        return { sidebar: s, center: CENTER_MIN, details: d1 }
      }

      return { sidebar: s, center: Math.max(0, viewport - s), details: 0 }
    }

    // ── 状态管理 ──────────────────────────────────────────────────

    /**
     * 创建布局状态存储（与官方布局插件兼容）。
     */
    function createLayoutStore() {
      return runtime.defineStore({
        init: () => ({
          sidebar: SIDEBAR_DEFAULT,
          details: 0,
          narrow: false,
          narrowExpanded: false,
        }),
        actions: {
          setSidebar: (d, px) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
          setDetails: (d, px) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
          toggleSidebar: (d) => {
            if (d.narrow) d.narrowExpanded = !d.narrowExpanded
            else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
          },
          setNarrow: (d, narrow) => {
            if (d.narrow === narrow) return
            d.narrow = narrow
            d.narrowExpanded = false
          },
          openDetails: (d) => { if (d.details === 0) d.details = DETAILS_DEFAULT },
          closeDetails: (d) => { d.details = 0 },
        },
      })
    }

    // ── LayoutController 服务 ──────────────────────────────────────────

    /**
     * 跨插件面板操作服务（ctx.layout）。
     */
    class LayoutController {
      #panels

      attachPanels(actions) {
        this.#panels = actions
      }

      toggleSidebar() {
        this.#require().toggleSidebar()
      }

      openDetails() {
        this.#require().openDetails()
      }

      closeDetails() {
        this.#require().closeDetails()
      }

      #require() {
        if (this.#panels === undefined) {
          throw new Error('layout: panel actions not wired (root entry not mounted)')
        }
        return this.#panels
      }
    }

    // ── 拖拽手柄组件 ──────────────────────────────────────────────────

    function DragHandle({ side, left, onStart, onDrag, onEnd }) {
      const [dragging, setDragging] = useState(false)
      const originRef = useRef(0)
      const latestRef = useRef(0)
      const rafRef = useRef(null)

      const onPointerDown = useCallback((e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        originRef.current = e.clientX
        latestRef.current = e.clientX
        onStart()
        setDragging(true)
      }, [onStart])

      const onPointerMove = useCallback((e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        latestRef.current = e.clientX
        rafRef.current ??= requestAnimationFrame(() => {
          rafRef.current = null
          onDrag(latestRef.current - originRef.current)
        })
      }, [onDrag])

      const onPointerUp = useCallback((e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        onEnd()
        setDragging(false)
      }, [onEnd])

      return React.createElement('div', {
        className: 'dsh-desktop-layout-handle',
        style: { left: left + 'px' },
        'data-side': side,
        'data-dragging': dragging || undefined,
        onPointerDown,
        onPointerMove,
        onPointerUp,
      })
    }

    // ── AppFrame 组件 ──────────────────────────────────────────────────

    /**
     * 桌面版 AppFrame：三列布局根组件。
     * 0.1.2：details 槽位为 strict session scope，须经 SessionProvider 提供 scope
     * 绑定（对齐官方 ui-layout AppFrame 的 `<SessionProvider>{renderSlot('details')}</SessionProvider>`），
     * 否则报 "strict session slot 'details' rendered without a scope binding"。
     */
    function AppFrame({ useStore, useSessions, actions, renderSlot, SessionProvider }) {
      const panels = useStore(s => s)
      const detailsSession = useSessions(s => {
        const current = s.current
        return current !== undefined && s.byId[current]?.blank === false ? current : undefined
      })

      const frameRef = useRef(null)
      const [viewport, setViewport] = useState(() => window.innerWidth)
      const lastSession = useRef(detailsSession)
      const colsRef = useRef({ sidebar: SIDEBAR_DEFAULT, center: 0, details: 0 })
      const sidebarBase = useRef(0)
      const detailsBase = useRef(0)
      const [dragging, setDragging] = useState(false)

      // 详情列会话变化时自动关闭
      useLayoutEffect(() => {
        if (detailsSession === undefined) return
        if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
          actions.closeDetails()
        }
        lastSession.current = detailsSession
      }, [actions, detailsSession])

      // 监听容器宽度变化
      useEffect(() => {
        const el = frameRef.current
        if (el === null) return
        let raf = null
        const observer = new ResizeObserver(() => {
          raf ??= requestAnimationFrame(() => {
            raf = null
            const width = el.getBoundingClientRect().width
            if (width > 0) setViewport(width)
          })
        })
        observer.observe(el)
        return () => {
          observer.disconnect()
          if (raf !== null) cancelAnimationFrame(raf)
        }
      }, [])

      // 响应式：窄屏自动折叠
      const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
      useEffect(() => {
        actions.setNarrow(narrow)
      }, [actions, narrow])

      const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
      const cols = computeColumns(
        viewport,
        sidebarCollapsed ? 0 : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar,
        detailsSession === undefined ? 0 : panels.details,
      )
      colsRef.current = cols

      // 拖拽处理
      const onDragEnd = useCallback(() => setDragging(false), [])

      const onSidebarStart = useCallback(() => {
        sidebarBase.current = colsRef.current.sidebar
        setDragging(true)
      }, [])

      const onDetailsStart = useCallback(() => {
        detailsBase.current = colsRef.current.details
        setDragging(true)
      }, [])

      const onSidebarDrag = useCallback((dx) => {
        actions.setSidebar(sidebarBase.current + dx)
      }, [actions])

      const onDetailsDrag = useCallback((dx) => {
        actions.setDetails(detailsBase.current - dx)
      }, [actions])

      return React.createElement('div', {
        ref: frameRef,
        className: 'dsh-desktop-layout-frame',
        'data-sidebar-collapsed': sidebarCollapsed || undefined,
        'data-details-collapsed': cols.details === 0 || undefined,
        'data-dragging': dragging || undefined,
        children: [
          // 行1：标题栏区（flex:0 0 固定高，不随窗口放大而变高）
          React.createElement('div', {
            key: 'titlebar',
            className: 'dsh-desktop-layout-titlebar',
            children: renderSlot('titlebar', { collapsed: sidebarCollapsed }),
          }),
          // 行2：三列内容区（flex:1 撑满剩余高度；内部用 grid 排 sidebar/center/details）
          React.createElement('div', {
            key: 'body',
            className: 'dsh-desktop-layout-body',
            style: {
              gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px`,
            },
            children: [
              React.createElement('div', {
                key: 'sidebar',
                className: 'dsh-desktop-layout-sidebar',
                style: { gridColumn: 1 },
                children: renderSlot('sidebar', { collapsed: sidebarCollapsed, width: cols.sidebar }),
              }),
              React.createElement('div', {
                key: 'center',
                className: 'dsh-desktop-layout-center',
                style: { gridColumn: 2 },
                children: renderSlot('conversation', {}),
              }),
              React.createElement('div', {
                key: 'details',
                className: 'dsh-desktop-layout-details',
                style: { gridColumn: 3 },
                // 0.1.2：strict session 槽位须经 SessionProvider 绑定 scope。
                children: React.createElement(SessionProvider, {}, renderSlot('details', {})),
              }),
            ],
          }),
          // 遮罩层（覆盖整个 frame，含标题栏行；标题栏自身 z-index 高于它）
          React.createElement('div', {
            key: 'overlay',
            className: 'dsh-desktop-layout-overlay',
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
          // 详情列拖拽手柄
          cols.details > 0 && React.createElement(DragHandle, {
            key: 'details-handle',
            side: 'details',
            left: viewport - cols.details,
            onStart: onDetailsStart,
            onDrag: onDetailsDrag,
            onEnd: onDragEnd,
          }),
        ],
      })
    }

    // ── 样式注入 ──────────────────────────────────────────────────

    /** 注入布局插件自身样式（骨架由宿主 LAYOUT_SKELETON_CSS 负责，此处不做越界覆盖）。 */
    function injectStyles() {
      const css = `
.dsh-desktop-layout-frame {
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
.dsh-desktop-layout-titlebar {
  flex: 0 0 var(--dsd-titlebar-h, 50px);
  height: var(--dsd-titlebar-h, 50px);
  min-width: 0;
  overflow: hidden;
  position: relative;
  z-index: 30;
}
/* 内容区（行2，flex:1 撑满剩余高度）：内部用 grid 排 sidebar/center/details。
   flex:1 保证窗口放大时内容区随高度增长，而 titlebar 保持固定。 */
.dsh-desktop-layout-body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: grid;
  grid-template-rows: 100%;
  transition: grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out);
  position: relative;
}
.dsh-desktop-layout-frame[data-dragging] .dsh-desktop-layout-body {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-desktop-layout-body { transition: none; }
}
.dsh-desktop-layout-sidebar {
  min-width: 0;
  overflow: hidden;
}
.dsh-desktop-layout-center {
  flex-direction: column;
  min-width: 0;
  display: flex;
  overflow: hidden;
  padding: 0 15px 15px 15px;
}
.dsh-desktop-layout-details {
  border-left: 1px solid var(--dsw-alias-border-l2);
  min-width: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
}
.dsh-desktop-layout-frame[data-details-collapsed] .dsh-desktop-layout-details {
  border-left: none;
}
.dsh-desktop-layout-handle {
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
.dsh-desktop-layout-frame[data-dragging] .dsh-desktop-layout-handle {
  transition: none;
}
.dsh-desktop-layout-handle::after {
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
.dsh-desktop-layout-handle:hover::after,
.dsh-desktop-layout-handle[data-dragging="true"]::after {
  opacity: 1;
}
.dsh-desktop-layout-handle[data-side="details"]:hover::after,
.dsh-desktop-layout-handle[data-side="details"][data-dragging="true"]::after {
  background: var(--dsw-alias-button-floating-hover);
  border-color: var(--dsw-alias-border-l3);
}
.dsh-desktop-layout-overlay {
  z-index: 20;
  pointer-events: none;
  position: absolute;
  inset: 0;
}
.dsh-desktop-layout-overlay > * {
  pointer-events: auto;
}
`
      const tag = document.createElement('style')
      tag.dataset.plugin = '@lansi-ai/dsh-desktop-layout'
      tag.textContent = css
      document.head.appendChild(tag)
    }

    // ── 插件导出 ──────────────────────────────────────────────────

    exports.inject = ['slots', 'theme']

    exports.apply = (ctx) => {
      const layout = new LayoutController()
      const disposeService = ctx.reflect.provide('layout', layout)

      // 注入样式
      injectStyles()

      const disposeRegistration = ctx.slots.register({
        name: 'root',
        children: {
          'titlebar': { kind: 'single', scope: 'root' },
          'sidebar': { kind: 'single', scope: 'root' },
          'conversation': { kind: 'single', scope: 'session-maybe' },
          'details': { kind: 'single', scope: 'session' },
          'shell.overlay': { kind: 'list', scope: 'root' },
        },
        store: createLayoutStore,
        inject: (actions) => {
          layout.attachPanels(actions)
          return {}
        },
      }, AppFrame)

      return () => {
        disposeRegistration()
        disposeService()
      }
    }

    return module.exports
  },
})
