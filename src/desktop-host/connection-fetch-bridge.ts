/**
 * dsh-desktop connection fetch 桥（协议层 → host connection 共享 fetch 处理器）。
 *
 * 背景（0.1.2 · dogfood #6）：官方 client 半部分能力（如 `dsh-session-log-export`
 * 的 Session 日志导出）不走 `__DSH_TRANSPORT__`，而是用浏览器原生 fetch 请求
 * 同源 `dsh-ui://app/api/<route>`（HEAD 探测 + anchor 下载），落 `dsh-ui://`
 * 协议层。官方 host 半 `dsh-client-connection` 会把此类端点注册为 connection
 * **精确 fetch 路由**（`connection.fetch.register({path: '/api/session.export',
 * methods: ['GET','HEAD'], fetch})`），由 `createSharedFetchHandler('/api')`
 * 统一分发——但该入口此前只被 IPC unary 载波（POST）使用，浏览器层 GET/HEAD
 * 无人认领（落 compat `/api` 前缀路由会被官方信任围栏 403）。
 *
 * 本模块持有共享 fetch 处理器的模块级引用：
 *   - 安装面：`main.ts` 载波桥接阶段（boot 完成、connection 服务就绪）调用 install
 *   - 消费面：`dsh-ui-protocol.ts` 对非 POST `/api/` 请求转发，命中精确路由返回
 *     官方流式响应（ZIP 等），未命中由官方共享处理器自身 404
 *
 * 信任模型说明：刻意绕开 compat `/api` 前缀路由的 Host/Origin 浏览器信任围栏
 * （该围栏面向官方 HTTP 部署的浏览器鉴权）；桌面信任边界 = preload 白名单 +
 * IPC 载波，renderer 本身即受信上下文。
 */

/** 共享 fetch 处理器签名（官方 ConnectionFetchHandler.fetch）。 */
export type ConnectionFetchFn = (request: Request) => Promise<Response>

/** 当前生效的 connection 共享 fetch 处理器（未安装时为 null）。 */
let sharedFetch: ConnectionFetchFn | null = null

/** 载波桥接阶段安装（main.ts boot 完成后调用；重复安装以最后一次为准）。 */
export function installConnectionFetchBridge(fetchFn: ConnectionFetchFn): void {
  sharedFetch = fetchFn
}

/**
 * 协议层转发一个请求到 connection 共享 fetch 处理器。
 * @returns 处理器未安装时返回 null（调用方自行 404），否则返回官方响应 Promise。
 */
export function dispatchConnectionFetch(request: Request): Promise<Response> | null {
  if (sharedFetch === null) return null
  return sharedFetch(request)
}
