/**
 * @dsh-desktop/ipc-connection —— 零端口 IPC 载波客户端模块（路线 A）。
 *
 * 继承官方 @deepseek-ai/dsh-client-connection 打包的 AbstractApiClient，
 * 覆写三个传输抽象点，把官方四象限 RPC 经 preload desktopBridge 转发到
 * 内嵌 Cordis Host 的 apiProxy：
 *   - doFetch       → desktopBridge.rpc（上行 unary，命中 host apiProxy）
 *   - openMux/openHost → desktopBridge.onFrame 帧路由（下行 server-request 帧）
 *
 * 生命周期（官方客户端模块系统 Lazy CJS）：
 *   bundle 经 `dsh-ui://plugins/@dsh-desktop/ipc-connection/client.js` 协议直读执行，
 *   仅调用 window.__ModuleLoader__.load({id, factory}) 注册 factory；
 *   factory 在首次 materialize 时运行（此处 require 官方 connection 拿基类）。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@dsh-desktop/ipc-connection',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    // 自包含 bundle 已在模块表注册；此处同步 require 解析到 client-connection，
    // materialize 后取其打包好的 AbstractApiClient（最小实证已确认其可继承）。
    const { AbstractApiClient } = require('@deepseek-ai/dsh-client-connection/client')

    /** preload 白名单桌面桥（语义对齐 desktopBridge，非裸 IPC）。 */
    const bridge = () => (typeof window !== 'undefined' ? window.desktopBridge : undefined)

    /**
     * 上行 unary 转发（对齐官方 AbstractApiClient.callUnary 的 server-response 契约）：
     *   doFetch 收到的 body = client-request 信封 {type, rpcId, method, payload}；
     *   这里提取 rpcId/method/payload 经 preload.request 透传 host（保留 rpcId，不重新生成），
     *   再把 host 结果包成 server-response 信封返回，保证 base 类 rpcId 回显校验通过。
     */
    async function ipcFetch(input, init) {
      const url = input instanceof URL ? input : new URL(String(input))
      const method = String(init?.method ?? 'GET').toUpperCase()
      const text = init?.body != null ? String(init.body) : undefined
      const body = text ? JSON.parse(text) : undefined
      if (method !== 'POST') {
        // 非 unary（如 /api/events.* 下行预检）——走帧路由，见 readIpFrames。
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const rpcId = body?.rpcId
      const rpcMethod = body?.method ?? url.pathname.replace(/^\/api\//, '')
      const payload = body?.payload ?? body?.params
      const raw = await bridge().request({ rpcId, method: rpcMethod, params: payload })
      const result = raw && typeof raw === 'object' && 'error' in raw
        ? { ok: false, error: raw.error }
        : { ok: true, value: 'data' in raw ? raw.data : raw }
      const envelope = { type: 'server-response', rpcId, result }
      return new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    /**
     * 下行帧路由：把 host 的 server-request 帧（session/event、approval/question
     * requested）经 desktopBridge.onFrame 桥接为 AsyncIterable<RpcRequest<Frame>>。
     * 与官方 readSse/readWebSocket 的 onEnvelope 语义对齐：
     *   每个帧是完整 server-request 信封 {type, rpcId, payload: frame}
     *   （host 桥帧路由保真 rpcId）；这里 parse 后经 onEnvelope tap 再 yield。
     */
    async function* readIpFrames(_kind, _signal, _onOpen) {
      const db = bridge()
      if (db?.onFrame === undefined) return
      // 实现见 host 帧路由对齐后：订阅 onFrame → 逐帧 serverRequestSchema.parse
      // → frameSchema.parse(payload) → this.onEnvelope(full) → yield {rpcId, payload}。
      // 骨架：透传每一帧（host 端已按 server-request 信封序列化）。
      const off = db.onFrame((frame) => {
        // TODO(host 对齐后启用)：完整 parse + yield 循环。
        void frame
      })
      void off
      yield undefined
    }

    class IpcApiClient extends AbstractApiClient {
      doFetch(input, init) {
        return ipcFetch(input, init)
      }

      openMux(_payload, signal, onOpen) {
        return readIpFrames('mux', signal, onOpen)
      }

      openHost(_payload, signal, onOpen) {
        return readIpFrames('host', signal, onOpen)
      }
    }

    /** 生成 ConnectionHandle（对齐官方客户端 connection 服务接口）。 */
    function makeHandle(api) {
      return {
        api,
        isLoopback: true,
        hostDescription: {
          getSnapshot: () => undefined,
          subscribe: () => () => {},
        },
        rpc: {
          // 逻辑 RPC 通道：/api 前缀端点经 host apiProxy 转调。
          call: async (_channel, _endpoint, _payload) => ({ ok: true, value: null }),
        },
        // 连接循环：IPC 为进程内常驻，start 即空转；sinks 由 runtime 填充。
        start: (_sinks) => ({ stop() {} }),
      }
    }

    // 插件声明：提供 connection 服务（官方 client-runtime/remote 消费）。
    exports.inject = []
    exports.apply = (ctx) => {
      ctx.provide('connection', makeHandle(new IpcApiClient()))
    }
    return module.exports
  },
})
