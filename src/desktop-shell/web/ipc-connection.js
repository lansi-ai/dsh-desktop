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

    /** 生成 uuid v4（browser 用 crypto.randomUUID，回退时间戳+随机数）。 */
    const randomUuid = () =>
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`

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
      const raw = await dispatchToHost(rpcId, rpcMethod, payload)
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
     * 经 preload.request 透传 host 的 rpc 调用，返回 host bridge 原始应答。
     * @param rpcId 调用方保留的 rpcId（或本通道新铸）。
     * @param method 方法名（如 session.prompt / host.describe）。
     * @param params 业务参数。
     * @returns raw = {rpcId, data|error}。
     */
    async function dispatchToHost(rpcId, method, params) {
      const db = bridge()
      if (!db?.request) throw new Error('ipc-connection: desktopBridge.request 不可用')
      return await db.request({ rpcId, method, params })
    }

    /**
     * 逻辑 RPC 通道（connection.rpc.call 语义对齐 createWebConnectionRpc）：
     *   api-gateway 远端方法经 connection.rpc.call("/api", endpoint, {args}, signal) 分发，
     *   host 应答包成官方 booleanResult {ok, value|error} 返回，供 api-gateway 解包。
     */
    async function ipcRpcCall(channel, endpoint, payload, _signal) {
      const rpcId = randomUuid()
      const raw = await dispatchToHost(rpcId, endpoint, payload)
      if (raw && typeof raw === 'object' && 'error' in raw) {
        return { ok: false, error: raw.error }
      }
      const value = raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw
      return { ok: true, value }
    }

    /**
     * 下行帧路由：把 host 的 server-request 帧（session/event、approval/question
     * requested）经 desktopBridge.onFrame 桥接为 AsyncIterable<RpcRequest<Frame>>。
     *
     * 与官方 readSse/readWebSocket 的 pumpStream 契约对齐：每个产出 envelope 为
     *   { rpcId, payload: frame }
     * 其中 frame = {type, payload}（host 端按 frameSchema 序列化）。ConnectionController
     * 的 pumpStream 据 envelope.payload.type 判停（stream/error）并投递各帧到对应 sink。
     */
    async function* readIpFrames(_kind, _signal, onOpen) {
      const db = bridge()
      if (db?.onFrame === undefined) {
        throw new Error('ipc-connection: desktopBridge.onFrame 不可用（帧路由缺失）')
      }
      const streamRpcId = randomUuid()
      const queue = []
      const waiters = []
      // 帧只入队列；waiters 仅作「队列非空」的唤醒通知（不携带值），
      // 保证 blocked 的 next() 恢复后在 while 循环读取真实队列帧。
      const off = db.onFrame((frame) => {
        queue.push({ rpcId: streamRpcId, payload: frame })
        const waiter = waiters.shift()
        if (waiter !== undefined) waiter()
      })
      onOpen?.()
      try {
        // 长驻下行流：进程内 IPC 无断连重开，循环直到流被显式关闭（finally 注销）。
        while (true) {
          if (queue.length > 0) {
            yield queue.shift()
            continue
          }
          await new Promise((resolve) => {
            waiters.push(resolve)
          })
        }
      } finally {
        off()
      }
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

    /**
     * 连接循环：IPC 为进程内常驻，start 即打开下行帧泵（mux/host 连续流 → 各 sink），
     * 并对齐官方 ConnectionController 的 onConnected 手牌（host.describe 就绪后触发）。
     * 因无真实网络重连，退避/断线阶段精简；帧已由 onFrame 常驻订阅，进程退出即随 webContents 失效。
     */
    class MinimalConnectionLoop {
      constructor(api, sinks) {
        this.api = api
        this.sinks = sinks ?? {}
        this.ac = new AbortController()
        this.started = false
      }

      start() {
        if (this.started) return
        this.started = true
        // 下行连续流：mux（会话事件流）/ host（宿主流）→ 各 sink。
        this.pump(this.api.events.mux({}, this.ac.signal), this.sinks.onMuxEnvelope)
        this.pump(this.api.events.host({}, this.ac.signal), this.sinks.onHostEnvelope)
        // 就绪手牌：host.describe 成功标志 connection 建立（对齐官方 loop()）。
        this.api.host
          .describe({})
          .then((res) => {
            const value = res?.result?.ok ? res.result.value : undefined
            this.sinks.onConnected?.(value)
            this.sinks.onStateChange?.('connected')
          })
          .catch(() => this.sinks.onStateChange?.('reconnecting'))
      }

      async pump(stream, sink) {
        try {
          for await (const envelope of stream) {
            if (envelope?.payload?.type === 'stream/error') break
            if (sink !== undefined) {
              try {
                sink(envelope)
              } catch (error) {
                console.error('[ipc-connection] connection sink threw:', error)
              }
            }
          }
        } catch {
          // 流终止即帧路由关闭，保持静默。
        }
      }

      stop() {
        this.started = false
        this.ac.abort()
      }
    }

    /** 生成 ConnectionHandle（对齐官方客户端 connection 服务接口）。 */
    function makeHandle(api) {
      let loop = null
      return {
        api,
        isLoopback: true,
        hostDescription: {
          getSnapshot: () => undefined,
          subscribe: () => () => {},
        },
        rpc: {
          // 逻辑 RPC 通道：/api 前缀端点经 host apiProxy 转调（api-gateway 远端方法用）。
          call: ipcRpcCall,
        },
        // 连接循环：IPC 为进程内常驻。
        start(sinks, _config) {
          if (loop !== null) throw new Error('connection: the stream loop is already owned by another consumer')
          loop = new MinimalConnectionLoop(api, sinks)
          loop.start()
          return {
            stop: () => {
              loop?.stop()
              loop = null
            },
          }
        },
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
