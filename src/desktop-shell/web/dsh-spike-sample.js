/**
 * dsh-spike-sample：最小样例 client 插件 bundle（Step 5·零端口 bundle 装载 spike 验证载体）。
 *
 * 生命周期（官方客户端模块系统 Lazy CJS）：
 * - bundle 经 `dsh-ui://plugins/dsh-spike-sample/client.js` 协议直读后执行
 * - 执行时仅调用 `window.__ModuleLoader__.load({ id, factory })` 注册 factory
 * - factory 在首次 materialize（模块被 import）时才运行，副作用集中在工厂闭包内
 *
 * 验证目标：证明零端口下插件 bundle 能被协议正确送达并注册为可装载模块；
 * 工厂内注入可见标记并通过 preload 白名单 `desktopBridge.rpc` 证明运行时通信可达。
 */
window.__ModuleLoader__.load({
  id: 'dsh-spike-sample',
  factory() {
    // 渲染安全：仅用 textContent 注入静态文案，未使用任何未过滤的动态字符串。
    const banner = document.createElement('div')
    banner.setAttribute('data-dsh-spike-sample', 'loaded')
    banner.style.cssText =
      'padding:8px 16px;background:#1a1a24;border:1px solid #5b8dff;color:#e4e4ef;' +
      'font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
    banner.textContent = '[dsh-spike-sample] bundle 已通过 dsh-ui:// 零端口装载'
    document.body?.prepend(banner)

    // 运行时通信验证：走 preload 白名单，非裸 IPC。
    const bridge = typeof window !== 'undefined' ? (window as unknown as { desktopBridge?: { rpc: (method: string, body?: unknown) => Promise<unknown> } }).desktopBridge : undefined
    bridge?.rpc('desktop.getPlatformInfo').then((info) => {
      console.log('[dsh-spike-sample] desktopBridge.rpc 成功:', JSON.stringify(info))
    }).catch((error) => {
      console.error('[dsh-spike-sample] desktopBridge.rpc 失败:', error)
    })

    return {}
  },
})
