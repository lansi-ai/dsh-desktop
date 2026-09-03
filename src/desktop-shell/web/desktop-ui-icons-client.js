/**
 * @lansi-ai/dsh-desktop-ui-icons —— 官方 UI 内部图标主题化覆盖层。
 *
 * 官方 Web UI 的功能图标（设置按钮/文件夹/设置面板内等）是编译进 JS bundle 的
 * React 内联 SVG，**没有独立资源文件可换**。本插件提供唯一的运行期替换途径：
 *
 *   主题包 icons/ui-overrides.json 声明映射规则（官方 svg path d 前缀 → 主题图标）：
 *     [ { "match": "M19.14 12.94c...", "icon": "settings.svg", "size": 16 } ]
 *
 *   插件经 MutationObserver 持续扫描新增 DOM 中的 <svg>，path d 命中前缀即替换为
 *   <img src="dsh-ui://app/theme/current/icons/<icon>">。React 重渲染打回替换时
 *   observer 会再次替换（尽力而为：官方 dist 升级可能改变 path 特征，需重新登记）。
 *
 * ui-overrides.json 为空数组时覆盖层**不激活**（零监听零开销）；theme.icon-change
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
    /** 替换标记属性（防重复替换）。 */
    const MARK = 'data-dsh-theme-icon'
    /** 当前主题标识（刷新已替换 img 的 src 用，?t= 破缓存）。 */
    let bustToken = Date.now()
    /** MutationObserver（激活后存在；空表/卸载时断开）。 */
    let observer = null
    /** 覆盖层是否处于激活态（决定空表时是否执行卸载清理）。 */
    let wasActive = false

    /** 扫描元素树内未处理的 svg，命中映射即替换为主题图标 img。 */
    function replaceIn(root) {
      if (rules.length === 0 || root === null || root === undefined) return
      const svgs = root.querySelectorAll ? root.querySelectorAll('svg') : []
      for (const svg of svgs) {
        if (svg.getAttribute(MARK) !== null) continue
        const path = svg.querySelector('path')
        const d = path ? path.getAttribute('d') || '' : ''
        if (d === '') continue
        for (const rule of rules) {
          if (!d.startsWith(rule.match)) continue
          const img = document.createElement('img')
          img.src = `dsh-ui://app/theme/current/icons/${rule.icon}?t=${bustToken}`
          const size = rule.size ?? svg.getAttribute('width') ?? 16
          img.width = Number(size) || 16
          img.height = Number(size) || 16
          img.alt = ''
          img.setAttribute(MARK, rule.icon)
          svg.replaceWith(img)
          break
        }
      }
    }

    /** 主题切换后刷新所有已替换图标（重写 src 破缓存；新增节点由 observer 兜底）。 */
    function refreshReplaced() {
      bustToken = Date.now()
      for (const img of document.querySelectorAll(`img[${MARK}]`)) {
        const icon = img.getAttribute(MARK)
        if (icon) img.src = `dsh-ui://app/theme/current/icons/${icon}?t=${bustToken}`
      }
    }

    /**
     * 拉取当前主题映射表并维护覆盖层生命周期：
     *   规则非空 → 激活（首次装 observer；已激活则刷新规则与已替换图标）；
     *   规则为空 → 若曾激活则卸载（移除替换 img，断开 observer），回到官方原貌。
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
          console.log(`[dsh-desktop-ui-icons] 图标覆盖层已激活（${rules.length} 条映射）`)
        }
        refreshReplaced()
        replaceIn(document.body)
      } catch {
        return
      }
    }

    /** 卸载覆盖层：移除全部替换图标并断开 observer（切换到无映射主题时）。 */
    function uninstall() {
      rules = []
      observer?.disconnect()
      observer = null
      wasActive = false
      for (const img of document.querySelectorAll(`img[${MARK}]`)) img.remove()
      console.log('[dsh-desktop-ui-icons] 当前主题无映射规则，覆盖层已停用')
    }

    exports.inject = []
    exports.apply = () => {
      void install()
      // 主题切换：延迟重拉映射表（协议层 current 映射先随主进程切换，50ms 缓冲）
      window.desktopBridge?.onDesktopEvent?.((event) => {
        if (event?.action === 'theme.icon-change') setTimeout(() => void install(), 50)
      })
    }

    return module.exports
  },
})
