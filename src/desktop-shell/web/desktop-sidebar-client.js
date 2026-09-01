/**
 * @lansi-ai/dsh-desktop-sidebar —— 侧栏壳插件（M6-P3 · D-20 全量自绘「先换壳不换内容」）。
 *
 * 复刻官方 `dsh-client-ui-sidebar` 的壳能力并接管 `sidebar` 槽位：
 *   - fold 折叠状态机（宽列 ↔ 56px rail，折叠动画播完再切 rail 内容）；
 *   - 新会话按钮（`ctx.workspaces.startSession`，复用-or-新建 workspace 会话语义）；
 *   - 折叠切换按钮（`ctx.layout.toggleSidebar`，走桌面布局插件 LayoutController）；
 *   - 声明官方同款 5 个子槽位（brand.mark / brand.name / workspaces / settings /
 *     footer.action）——官方 `ui-workspace`（会话树）与 `ui-settings`（设置入口）
 *     **无改动继续工作**，注册进同名子槽位。
 *
 * 与官方差异（v1 有意为之）：
 *   - 不依赖 `dsh-client-ui-primitives`（图标用内联 SVG、Tooltip 用 title 属性）；
 *   - 不接 locale 服务（v1 中文硬编码，P6 统一接 locale）；
 *   - 品牌占位 fallback 待 M6-P2 `dsh-desktop-brand` 替换。
 *
 * 契约事实（摸底 2026-08-27）：布局插件 renderSlot('sidebar', {collapsed, width})
 * 的 owner props 与官方 SidebarRoot 签名一致；`ui-workspace` 运行时不 require
 * ui-sidebar（package.json dsh.client.inject 仅为装载顺序提示），排除官方壳不连坐。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-desktop-sidebar',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const { useState, useEffect, useRef } = React
    const h = React.createElement

    /** 折叠动画播完再切 rail 内容的settling 延迟（ms）。 */
    const COLLAPSE_SETTLE_MS = 200

    /** 壳自有样式（布局容器背景/边框由 dsh-desktop-layout 的 .dsh-desktop-layout-sidebar 负责）。 */
    const CSS_TEXT = `
.dsh-desktop-sidebar-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  color-scheme: light dark;
}
.dsh-desktop-sidebar-new-session {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 10px 8px;
  padding: 8px 12px;
  background: transparent;
  border: 1px solid rgba(0, 0, 0, 0.10);
  border-radius: 10px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  color: inherit;
}
.dsh-desktop-sidebar-new-session:hover {
  background: rgba(0, 0, 0, 0.05);
}
.dsh-desktop-sidebar-region {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  /* 工作区内容（官方 ui-workspace）离面板边缘留白，避免 section 标签贴边 */
  padding: 0 10px;
}
.dsh-desktop-sidebar-foot {
  padding: 6px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsh-desktop-sidebar-rail-label {
  font-size: 10px;
  color: rgba(0, 0, 0, 0.45);
}
`

    /** 新会话加号图标。 */
    function PlusIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true,
      },
        h('line', { x1: 8, y1: 3, x2: 8, y2: 13 }),
        h('line', { x1: 3, y1: 8, x2: 13, y2: 8 }),
      )
    }

    /**
     * 侧栏壳根组件（props 契约对齐官方 SidebarRoot）。
     * @param {object} props collapsed/width（布局 owner props）+ startSession/toggleSidebar
     *   （register inject）+ renderSlot（5 洞渲染）。
     */
    function SidebarRoot({ collapsed, width, startSession, toggleSidebar, renderSlot }) {
      // 折叠动画播完再切 rail 内容（官方同款 settling 机制）
      const [settled, setSettled] = useState(collapsed)
      useEffect(() => {
        if (!collapsed) {
          setSettled(false)
          return undefined
        }
        const timer = window.setTimeout(() => setSettled(true), COLLAPSE_SETTLE_MS)
        return () => window.clearTimeout(timer)
      }, [collapsed])
      const wide = !collapsed || !settled
      // 折叠动画期间保持最后一次宽列宽度（避免内容挤压跳动）
      const lastWideWidth = useRef(width)
      if (!collapsed) lastWideWidth.current = width

      return h('div', {
        className: 'dsh-desktop-sidebar-root',
        style: { width: collapsed ? lastWideWidth.current : width },
      },
        // 新会话按钮（宽列带文案，rail 仅图标）
        h('button', {
          type: 'button',
          className: 'dsh-desktop-sidebar-new-session',
          title: '新建会话',
          'aria-label': '新建会话',
          onClick: () => startSession(),
        },
          h(PlusIcon, { size: wide ? 14 : 18 }),
          wide && h('span', null, '新会话'),
        ),
        // 工作区/会话浏览区（官方 ui-workspace 注册，契约 {wide, expandSidebar}）
        h('div', { className: 'dsh-desktop-sidebar-region' },
          renderSlot('sidebar.workspaces', {
            wide,
            expandSidebar: () => {
              if (collapsed) toggleSidebar()
            },
          }),
        ),
        // 底部：动作区（desktop-panel 已注册）+ 设置入口（官方 ui-settings 注册）
        h('div', { className: 'dsh-desktop-sidebar-foot' },
          h('div', null, renderSlot('sidebar.footer.action', { wide })),
          h('div', null, renderSlot('sidebar.settings', { wide })),
        ),
      )
    }

    exports.inject = ['slots', 'layout', 'workspaces']

    exports.apply = (ctx) => {
      // 注入壳样式（幂等：style 标签带插件标识，重复装载先移除）
      document.getElementById('dsh-desktop-sidebar-css')?.remove()
      const style = document.createElement('style')
      style.id = 'dsh-desktop-sidebar-css'
      style.textContent = CSS_TEXT
      document.head.appendChild(style)

      // 注册 sidebar 槽位 + 声明官方同款 5 个子槽位（官方 workspaces/settings
      // 注册者无改动继续工作）；inject 函数返回壳组件的注入 props（对齐官方）。
      const disposeRegistration = ctx.slots.register({
        name: 'sidebar',
        children: {
          'sidebar.brand.mark': { kind: 'single', scope: 'root' },
          'sidebar.brand.name': { kind: 'single', scope: 'root' },
          'sidebar.workspaces': { kind: 'single', scope: 'root' },
          'sidebar.settings': { kind: 'single', scope: 'root' },
          'sidebar.footer.action': { kind: 'list', scope: 'root' },
        },
        inject: () => ({
          startSession: (workspaceId) => {
            ctx.workspaces.startSession(workspaceId)
          },
          toggleSidebar: () => {
            ctx.layout.toggleSidebar()
          },
        }),
      }, SidebarRoot)

      return () => {
        disposeRegistration()
        document.getElementById('dsh-desktop-sidebar-css')?.remove()
      }
    }

    return module.exports
  },
})
