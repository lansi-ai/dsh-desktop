/**
 * @lansi-ai/dsh-desktop-ui-icons —— 官方 UI 内部图标主题化覆盖层。
 *
 * 官方 Web UI 的功能图标（工作区搜索/视图/新建/文件夹、设置按钮等）是编译进
 * JS bundle 的 React 内联 SVG，**没有独立资源文件可换**。本插件提供唯一的运行期
 * 替换途径（官方 dist 零改动，纯 DOM 层）：
 *
 *   主题包 icons/ui-overrides.json 声明映射规则（官方 svg path d 前缀 → 主题图标）：
 *     [ { "match": "M19.14 12.94c...", "icon": "settings.svg", "size": 16 } ]
 *     （同一图标覆盖多个官方变体时由 host 上传流程自动展开为多条规则）
 *
 *   插件经 MutationObserver 持续扫描新增 DOM 中的 <svg>，首个 path d 命中前缀即
 *   替换为主题图标。替换呈现两条路径：
 *     - themeIcon 服务（@lansi-ai/dsh-desktop-icons）可用 → **内联上色**：单色稿
 *       接管为 currentColor（随明暗主题与官方按钮 hover 等状态变色）+ 光学归一，
 *       与官方图标同规格；异步注入（WeakSet 防重复受理），失败回退 img；
 *     - 服务不可用 → <img> 兜底（原色呈现，不随明暗）。
 *   渲染尺寸跟随官方 svg 的 width 属性（响应式缩放语义保留），规则 size 兜底。
 *   React 重渲染打回替换时 observer 会再次替换（尽力而为：官方 dist 升级可能
 *   改变 path 特征，需重新登记；特征真源 = desktop-theme.ts 槽位注册表 match 字段）。
 *
 * ui-overrides.json 为空数组/缺失时覆盖层**不激活**（零监听零开销）；theme.icon-change
 * 下行事件触发已替换图标整体刷新（?t= 破缓存）。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-desktop-ui-icons',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports

    /** 映射规则表（ui-overrides.json 解析结果）：d 前缀 → { icon, size }。 */
    let rules = []
    /** 内联上色服务（renderSvg(src, size) → Promise<string>；缺失时回退 img）。 */
    let themeIcon = null
    /** 替换标记属性（防重复替换 + 刷新定位）。 */
    const MARK = 'data-dsh-theme-icon'
    /** 已受理的官方 svg（异步内联期间防重复受理；弱引用不阻碍 React 卸载回收）。 */
    const seen = new WeakSet()
    /** 当前主题标识（刷新已替换图标的 src 用，?t= 破缓存）。 */
    let bustToken = Date.now()
    /** MutationObserver（激活后存在；空表/卸载时断开）。 */
    let observer = null
    /** 覆盖层是否处于激活态（决定空表时是否执行卸载清理）。 */
    let wasActive = false

    /** 替换图标 URL（相对 icons/ 文件名 → 主题协议地址，带破缓存 token）。 */
    function iconUrl(icon) {
      return `dsh-ui://app/theme/current/icons/${icon}?t=${bustToken}`
    }

    /** 渲染尺寸：官方 svg width 属性优先（保留其响应式缩放），规则 size 兜底。 */
    function renderSize(svg, rule) {
      const observed = Number.parseFloat(svg.getAttribute('width') ?? '')
      if (Number.isFinite(observed) && observed > 0) return observed
      return rule.size ?? 16
    }

    /** img 兜底替换（themeIcon 缺失，或内联渲染失败时）。 */
    function replaceWithImg(svg, rule, size) {
      const img = document.createElement('img')
      img.src = iconUrl(rule.icon)
      img.width = size
      img.height = size
      img.alt = ''
      img.setAttribute(MARK, rule.icon)
      svg.replaceWith(img)
    }

    /** 命中规则后的替换：内联上色 span（异步注入，失败回退 img）或 img 兜底。 */
    function applyReplacement(svg, rule, size) {
      if (themeIcon === null) {
        replaceWithImg(svg, rule, size)
        return
      }
      const host = document.createElement('span')
      host.setAttribute(MARK, rule.icon)
      // 盒子与官方 svg 同尺寸；**不接管 color**——currentColor 继承官方按钮/行的
      // 文字色（含 hover/禁用等状态），单色稿即随状态变色
      host.style.cssText = `display:inline-flex;width:${size}px;height:${size}px;align-items:center;justify-content:center`
      svg.replaceWith(host)
      themeIcon.renderSvg(iconUrl(rule.icon), size)
        .then((html) => { host.innerHTML = html })
        .catch(() => replaceWithImg(host, rule, size))
    }

    /** 扫描元素树内未处理的 svg，命中映射即替换为主题图标。 */
    function replaceIn(root) {
      if (rules.length === 0 || root === null || root === undefined) return
      const svgs = root.querySelectorAll ? root.querySelectorAll('svg') : []
      for (const svg of svgs) {
        if (svg.getAttribute(MARK) !== null || seen.has(svg)) continue
        const path = svg.querySelector('path')
        const d = path ? path.getAttribute('d') || '' : ''
        if (d === '') continue
        for (const rule of rules) {
          if (!d.startsWith(rule.match)) continue
          seen.add(svg)
          applyReplacement(svg, rule, renderSize(svg, rule))
          break
        }
      }
    }

    /** 主题切换后刷新所有已替换图标（重渲染破缓存；新增节点由 observer 兜底）。 */
    function refreshReplaced() {
      bustToken = Date.now()
      for (const host of document.querySelectorAll(`[${MARK}]`)) {
        const icon = host.getAttribute(MARK)
        if (!icon) continue
        if (host.tagName === 'IMG') {
          host.src = iconUrl(icon)
          continue
        }
        if (themeIcon === null) continue
        const size = Number.parseFloat(host.style.width) || 16
        themeIcon.renderSvg(iconUrl(icon), size)
          .then((html) => { host.innerHTML = html })
          .catch(() => { /* 保持现状（下次切换再刷新） */ })
      }
    }

    /**
     * 拉取当前主题映射表并维护覆盖层生命周期：
     *   规则非空 → 激活（首次装 observer；已激活则刷新规则与已替换图标）；
     *   规则为空 → 若曾激活则卸载（移除替换节点，断开 observer），回到官方原貌。
     * 失败静默——覆盖层永远不致命。
     */
    async function install() {
      try {
        const res = await fetch(`dsh-ui://app/theme/current/icons/ui-overrides.json?t=${Date.now()}`)
        if (!res.ok) return
        const parsed = await res.json()
        const nextRules = Array.isArray(parsed)
          ? parsed.filter((r) => typeof r?.match === 'string' && typeof r?.icon === 'string')
          : []
        if (nextRules.length === 0) {
          if (wasActive) uninstall()
          return
        }
        rules = nextRules
        if (!wasActive) {
          const pending = new Set()
          observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) pending.add(node)
              }
            }
            if (pending.size === 0) return
            // rAF 合帧：React 提交批次内多次 mutation 一次扫描
            requestAnimationFrame(() => {
              for (const node of pending) {
                if (node.tagName === 'svg') replaceIn(node.parentNode)
                else replaceIn(node)
              }
              pending.clear()
            })
          })
          observer.observe(document.body, { childList: true, subtree: true })
          wasActive = true
          console.log(`[dsh-desktop-ui-icons] 图标覆盖层已激活（${rules.length} 条映射，themeIcon=${themeIcon !== null ? '内联' : 'img 兜底'}）`)
        }
        refreshReplaced()
        replaceIn(document.body)
      } catch {
        return
      }
    }

    /** 卸载覆盖层：移除全部替换节点并断开 observer（切换到无映射主题时）。 */
    function uninstall() {
      rules = []
      observer?.disconnect()
      observer = null
      wasActive = false
      for (const host of document.querySelectorAll(`[${MARK}]`)) host.remove()
      console.log('[dsh-desktop-ui-icons] 当前主题无映射规则，覆盖层已停用')
    }

    exports.inject = ['themeIcon']
    exports.apply = (ctx) => {
      themeIcon = ctx.get('themeIcon') ?? null
      void install()
      // 主题切换：延迟重拉映射表（协议层 current 映射先随主进程切换，50ms 缓冲）
      window.desktopBridge?.onDesktopEvent?.((event) => {
        if (event?.action === 'theme.icon-change') setTimeout(() => void install(), 50)
      })
    }

    return module.exports
  },
})
