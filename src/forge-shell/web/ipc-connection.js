/**
 * @lansi-ai/dsh-ipc-connection —— 0.1.2 自持传输载波（图谱占位模块）。
 *
 * 0.1.2 中官方 Connection 架构重构为「renderer 读取页面全局 `__DSH_TRANSPORT__`
 * 选传输」。桌面作为拥有异物理（Electron IPC）传输的 shell，真正的传输定义
 * 由 HTML boot 脚本（dsh-ui-protocol.ts bootManifestScript）在 plugin boot 前
 * 安装到页面全局——官方 `@deepseek-ai/dsh-client-connection` 的 apply() 读到后
 * 用 createWebConnectionRpc(transport.fetch, transport.openStream) 装配
 * ctx.connection，官方 api-gateway(client) 拥有连接循环。
 *
 * 本文件仅为图谱内激活占位（合法插件形态），实际传输承载见 __DSH_TRANSPORT__ 全局。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__?.load?.({
  id: '@lansi-ai/dsh-ipc-connection',
  factory: (_require) => {
    const module = { exports: {} }
    // 真正的传输由 __DSH_TRANSPORT__ 全局承载（HTML boot 脚本注入），此处占位。
    module.exports.inject = []
    module.exports.apply = () => {}
    return module.exports
  },
})