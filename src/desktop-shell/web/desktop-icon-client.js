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
 * **跨插件复用契约**：`ctx.themeIcon.renderSvg(src, size)` 返回 `Promise<string>`
 * （已内联上色的 SVG 字符串，缓存复用）；消费插件 `inject: ['themeIcon']` 取服务，
 * 经 `dangerouslySetInnerHTML` 渲染。跨 bundle 只传字符串，无 React 实例耦合。
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
     * 含彩色 → 保留原色。失败抛错（调用方回退官方图标）。
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
      const html = svg.outerHTML
      svgCache.set(cacheKey, html)
      return html
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

    /** 跨插件注入面：提供 renderSvg（纯函数，仅字符串）+ ThemeIcon 组件。 */
    exports.inject = []
    exports.apply = (ctx) => {
      ctx.provide('themeIcon', { renderSvg, ThemeIcon })
    }

    return module.exports
  },
})
