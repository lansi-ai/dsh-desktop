/**
 * @lansi-ai/dsh-desktop-icons —— 主题 SVG 内联加载器（方案 A：内联 + CSS 变量上色）。
 *
 * 背景：`<img>` 加载的外部 SVG 是独立文档，颜色写死、不随页面明暗主题自适应。
 * 本插件提供唯一的内联渲染途径，让**单色线条型**图标随明暗自适应：
 *
 *   主题包 icons/<file>.svg → fetch 文本 → DOMParser 解析 → 内联进 DOM →
 *   单色稿（黑白/currentColor）整体接管为 `currentColor`，容器 color 用官方
 *   文字色 token `--dsw-alias-label-primary`（浅色=深字、深色=浅字）；
 *   含彩色的图（如带色块底的 logo）不接管，保留文件原色。
 *
 * **光学归一**：内联前按字形真实包围盒（离屏 `getBBox()`）重设 viewBox 为
 * 「最长边 + 每侧 1/16 内边距」的正方形并居中。不同图标库画布留白差异极大
 * （Material Symbols 24 网格字形仅占约 79%，官方 16 网格近乎满幅），不裁切则
 * 同一槽位里自定义图标会明显比官方图标小一圈。1/16 对齐官方留白比例。
 *
 * **跨插件复用契约**：`ctx.themeIcon.renderSvg(src, size)` 返回 `Promise<string>`
 * （已内联上色的 SVG 字符串，缓存复用）；`ctx.themeIcon.peekSvg(src, size)` 同步取
 * 缓存（未命中返回 null 并后台预热，供首帧就要正确的窗控类图标用）。消费插件
 * `inject: ['themeIcon']` 取服务，经 `dangerouslySetInnerHTML` 渲染。
 * 跨 bundle 只传字符串，无 React 实例耦合。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-desktop-icons',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement

    /** 内联 SVG 字符串缓存（src → html，避免主题切换外的重复 fetch）。 */
    const svgCache = new Map()

    /** 视为「可着色」的颜色（黑白/currentColor；接管后换为 currentColor）。 */
    const MONO_COLORS = new Set([
      '#000', '#000000', '#fff', '#ffffff', '#f8fafc', '#1a1a24', '#ffffff00',
      'black', 'white', 'currentcolor', 'none', '',
    ])

    /** 判断 SVG 是否为纯单色线条稿（存在彩色元素则视为非单色）。 */
    function isMonochrome(svg) {
      for (const el of svg.querySelectorAll('*')) {
        for (const attr of ['fill', 'stroke']) {
          const value = (el.getAttribute(attr) ?? '').trim().toLowerCase()
          if (value !== '' && !MONO_COLORS.has(value)) return false
        }
      }
      return true
    }

    /** 把可着色元素的 fill/stroke 统一接管为 currentColor（纯单色稿才调用）。 */
    function recolorToCurrent(svg) {
      for (const el of [svg, ...svg.querySelectorAll('*')]) {
        for (const attr of ['fill', 'stroke']) {
          const value = (el.getAttribute(attr) ?? '').trim().toLowerCase()
          if (value !== '' && value !== 'none') el.setAttribute(attr, 'currentColor')
        }
      }
    }

    /** 规范化尺寸与 viewBox（有 size 用 1:1，缺失时按 width/height 推导）。 */
    function normalizeSize(svg, size) {
      if (size !== undefined && size !== null) {
        svg.setAttribute('width', String(size))
        svg.setAttribute('height', String(size))
        if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
      } else if (!svg.getAttribute('viewBox')) {
        const width = Number.parseFloat(svg.getAttribute('width') ?? '')
        const height = Number.parseFloat(svg.getAttribute('height') ?? '')
        if (Number.isFinite(width) && Number.isFinite(height) && width !== 0 && height !== 0) {
          svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
        }
      }
    }

    /**
     * 拉取并内联主题 SVG，返回已上色的 SVG 字符串。
     * 纯单色稿 → 元素接管 currentColor（容器再用 color 定色）；
     * 含彩色 → 保留原色；最后按字形包围盒重设 viewBox 做光学归一。
     * 失败抛错（调用方回退官方图标）。
     */
    async function renderSvg(src, size) {
      const cacheKey = `${src}|${size ?? ''}`
      const cached = svgCache.get(cacheKey)
      if (cached !== undefined) return cached
      const response = await fetch(src)
      if (!response.ok) throw new Error(`theme icon fetch failed: ${response.status}`)
      const text = await response.text()
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
      const svg = doc.documentElement
      if (svg === null || svg.nodeName.toLowerCase() !== 'svg') throw new Error('invalid svg payload')
      // 去除可能由 fetch 引入的宽度自适应干扰：优先 size，其次原 width/height，最次比例
      normalizeSize(svg, size)
      if (isMonochrome(svg)) recolorToCurrent(svg)
      fitViewBox(svg)
      const html = svg.outerHTML
      svgCache.set(cacheKey, html)
      return html
    }

    /** 离屏测量容器（getBBox 要求元素在渲染树内；单例复用）。 */
    let measureHost = null

    /** 取（或重建）离屏测量容器：不可见但参与渲染，够 getBBox 用。 */
    function ensureMeasureHost() {
      if (measureHost !== null && document.body.contains(measureHost)) return measureHost
      const host = document.createElement('div')
      host.setAttribute('aria-hidden', 'true')
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none'
      document.body.appendChild(host)
      measureHost = host
      return host
    }

    /** 读单个元素包围盒（不支持、未入树或零尺寸返回 null）。 */
    function readBox(node) {
      try {
        const box = node.getBBox()
        if (box.width > 0 && box.height > 0) return { x: box.x, y: box.y, w: box.width, h: box.height }
      } catch {
        // 元素不支持 getBBox 或尚未进入渲染树
      }
      return null
    }

    /** 子元素包围盒并集（根 getBBox 为零时的兜底；忽略祖先 transform 的近似值）。 */
    function unionOfChildBoxes(root) {
      let box = null
      for (const node of root.querySelectorAll('*')) {
        const b = readBox(node)
        if (b === null) continue
        if (box === null) {
          box = b
          continue
        }
        const right = Math.max(box.x + box.w, b.x + b.w)
        const bottom = Math.max(box.y + box.h, b.y + b.h)
        box.x = Math.min(box.x, b.x)
        box.y = Math.min(box.y, b.y)
        box.w = right - box.x
        box.h = bottom - box.y
      }
      return box
    }

    /**
     * 光学归一：按字形真实包围盒把 viewBox 收成「最长边 + 每侧 1/16 内边距」的
     * 正方形并居中，使不同画布习惯的图标在同一槽位里视觉等大。
     *
     * 背景：主题图标来自不同图标库，留白差异极大——Material Symbols 的
     * `viewBox="0 -960 960 960"` 字形只占画布约 79%，官方 16 网格图标近乎满幅；
     * 两者都被强制成同一个 16px 盒子时，自定义图标会明显「小一圈、更细」。
     * 1/16 内边距即对齐官方 16 网格图标的留白比例。
     *
     * 测不到包围盒（无图形元素等）时保持原 viewBox，退化为不裁切。
     */
    function fitViewBox(svg) {
      const host = ensureMeasureHost()
      const probe = svg.cloneNode(true)
      probe.removeAttribute('width')
      probe.removeAttribute('height')
      probe.style.position = 'absolute'
      host.appendChild(probe)
      try {
        const box = readBox(probe) ?? unionOfChildBoxes(probe)
        if (box === null) return
        const side = Math.max(box.w, box.h)
        const total = side * (17 / 16)
        const cx = box.x + box.w / 2
        const cy = box.y + box.h / 2
        const r = (n) => Math.round(n * 1000) / 1000
        svg.setAttribute('viewBox', `${r(cx - total / 2)} ${r(cy - total / 2)} ${r(total)} ${r(total)}`)
      } finally {
        probe.remove()
      }
    }

    /**
     * React 组件：内联渲染主题 SVG。
     * 纯单色稿随主题文字色变；含彩色保留原色。加载中/失败渲染 null（回退由调用方处理）。
     * @param props.src 主题 SVG 恒定 URL；size 渲染尺寸；title 无障碍标题。
     */
    function ThemeIcon({ src, size, title }) {
      const [html, setHtml] = React.useState(null)
      const [failed, setFailed] = React.useState(false)
      React.useEffect(() => {
        let disposed = false
        renderSvg(src, size).then((value) => {
          if (!disposed) setHtml(value)
        }).catch(() => {
          if (!disposed) setFailed(true)
        })
        return () => {
          disposed = true
        }
      }, [src, size])
      if (failed) return null
      if (html === null) return null
      return h('span', {
        'aria-hidden': title ? undefined : 'true',
        role: title ? 'img' : undefined,
        title,
        // 单色稿随主题文字色；注入内容里的 currentColor 在 `--dsw-alias-label-primary` 下解析
        style: { display: 'inline-flex', color: 'var(--dsw-alias-label-primary, #1a1a24)' },
        // 含彩色的图不设特殊 color，呈现文件原色（继承父容器色彩）
        dangerouslySetInnerHTML: { __html: html },
      })
    }

    /**
     * 同步取内联 SVG 缓存：命中返回字符串，未命中返回 null 并后台预热。
     *
     * 用途：窗控按钮这类**首帧就要正确**的小图标——异步 `renderSvg` 会让按钮空一帧，
     * 而组件初值走 peek（同会话第二次起、或 apply 期已预热的场景直接命中），
     * 未命中时先画内置图形、后台加载完再换。
     */
    function peekSvg(src, size) {
      const cached = svgCache.get(`${src}|${size ?? ''}`)
      if (cached === undefined) {
        renderSvg(src, size).catch(() => { /* 失败由调用方的回退呈现 */ })
        return null
      }
      return cached
    }

    /** 跨插件注入面：提供 renderSvg / peekSvg（纯函数，仅字符串）+ ThemeIcon 组件。 */
    exports.inject = []
    exports.apply = (ctx) => {
      ctx.provide('themeIcon', { renderSvg, peekSvg, ThemeIcon })
    }

    return module.exports
  },
})
