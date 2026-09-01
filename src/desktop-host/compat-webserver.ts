/**
 * dsh-desktop `ctx.webServer` 等价面（ADR-007·host 半全兼容，M1 门禁·第三方 web 插件无改动装载）。
 *
 * 官方旧插件（含第三方 `@lnyanhongyan/dsh-opencode-usage`）host 半 `inject: ["webServer"]`
 * 硬依赖 `ctx.webServer`，其 apply 调用 `ctx.webServer.register({kind, path, handler})` 注册
 * HTTP 路由。零端口 IPC 载波模式禁用了官方 webserver（无真实端口监听），本模块提供一个
 * **内存路由表等价服务**：
 *   - 注册面：保留 `webServer.register({kind, path, handler})` 语义（前缀/精确匹配、dispose 幂等）
 *   - 分发面：`dispatchHttpCompat({method, url, headers, body})` 构造官方 handler 所需的
 *     req/res 接口（`req.method/req.url`、`for await (chunk of req)` 读 POST body、
 *     `res.writeHead(status, headers)`/`res.end(body)`），供 renderer 同源 `fetch()` 拦截
 *     （`dsh-ui://` 协议层）转发到 host 路由，返回其响应 —— 对旧插件完全透明。
 *
 * 模块被 boot() 的 prepare 钩子安装（extends Cordis Service 注册为 `ctx.webServer`），
 * 并在主进程侧保留上次安装的 dispatch 句柄供协议层复用。
 */

import { Buffer } from 'node:buffer'

import { log } from './log.js'

// ── 类型定义 ─────────────────────────────────────────────────────────

/** 路由注册项（对齐官方 webServer.register 的 {kind, path, handler}）。 */
export interface HttpCompatRoute {
  /** 匹配模式：prefix = 路径前缀；exact = 精确匹配。 */
  kind: 'prefix' | 'exact'
  /** 路由路径（如 `/opencode-usage`）。 */
  path: string
  /** 处理器（官方 req/res 契约，可能异步）。 */
  handler: (req: HttpReqLike, res: HttpResLike) => void | Promise<void>
}

/** 官方 handler 入参 req 的可读流形状（`for await (const chunk of req)` 可取 POST body）。 */
export interface HttpReqLike {
  method: string
  url: string
  headers: Record<string, string>
  [Symbol.asyncIterator](): AsyncIterator<Buffer>
}

/** 官方 handler 出参 res 的响应接口（writeHead + end，零端口下收集到内存）。 */
export interface HttpResLike {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Buffer): void
}

/** 分发入参（协议层 fetch 拦截转译）。 */
export interface HttpCompatDispatchInput {
  method: string
  url: string
  headers?: Record<string, string>
  body?: Buffer
}

/** 分发出参（可转成标准 Response）。 */
export interface HttpCompatDispatchResult {
  status: number
  headers: Record<string, string>
  body: string
}

// ── 内存路由表（纯逻辑，不依赖 Electron / Cordis）────────────────────

/** webServer 等价注册表：维护路由 + 提供 register/dispatch。 */
export class HttpCompatRegistry {
  private routes: HttpCompatRoute[] = []

  /** 注册路由（对齐 webServer.register），返回 dispose 解除注册。 */
  register(route: HttpCompatRoute): () => void {
    this.routes.push(route)
    return () => {
      const index = this.routes.indexOf(route)
      if (index !== -1) this.routes.splice(index, 1)
    }
  }

  /** 将 HTTP 请求分发给匹配路由，收集 handler 的响应。未命中返回 404。 */
  async dispatch(input: HttpCompatDispatchInput): Promise<HttpCompatDispatchResult> {
    const pathname = new URL(input.url, 'http://internal').pathname
    const route = this.routes.find((r) =>
      r.kind === 'prefix' ? pathname.startsWith(r.path) : pathname === r.path,
    )
    if (route === undefined) {
      return { status: 404, headers: {}, body: 'not found' }
    }
    const state = { status: 200, headers: {} as Record<string, string>, body: '' }
    const body = input.body
    async function* bodyStream(): AsyncGenerator<Buffer> {
      if (body !== undefined && body.length > 0) yield body
    }
    // 官方 handler 用 async iterable 读 POST body、new URL(req.url).pathname 细分子路由。
    const req: HttpReqLike = {
      method: String(input.method).toUpperCase(),
      url: pathname,
      headers: input.headers ?? {},
      [Symbol.asyncIterator]: bodyStream,
    }
    const res: HttpResLike = {
      writeHead(status, headers) {
        state.status = status
        if (headers !== undefined) Object.assign(state.headers, headers)
      },
      end(b) {
        if (b !== undefined) state.body = typeof b === 'string' ? b : Buffer.from(b).toString('utf8')
      },
    }
    await route.handler(req, res)
    return { status: state.status, headers: state.headers, body: state.body }
  }

  /** 返回所有已注册路由的 path 前缀（供协议层动态 fetch 白名单校验）。 */
  getRegisteredPrefixes(): string[] {
    return this.routes.map((r) => r.path)
  }

  // ── 0.1.2 装配兼容（registerUpgrade） ─────────────────────────────
  // 0.1.2 api-gateway 构造时经 `ctx.inject(['connection','webServer'])` 注册
  // `/api/remote.mux` WebSocket upgrade 路由（`webCtx.webServer.registerUpgrade(route)`）。
  // 桌面自持传输走 `typertGateway.wireStream.open` 内存直连，**不经主 ws mux**，
  // 但 gateway 的装配代码仍会调用 registerUpgrade——此处提供内存幂等占位，使 gateway
  // 在零监听 stub 上也能正常激活（route 仅为装配表项，无真实 socket 可升级）。
  // 沿用独立 upgrades 表管理，支持 dispose 幂等。
  private upgrades: Array<{ path: string; handler: unknown }> = []

  /** 注册 HTTP upgrade 路由（对齐 webServer.registerUpgrade），返回 dispose 解除注册。 */
  registerUpgrade(route: { path: string; handler: unknown }): () => void {
    this.upgrades.push({ path: route.path, handler: route.handler })
    return () => {
      const index = this.upgrades.findIndex((u) => u.path === route.path)
      if (index !== -1) this.upgrades.splice(index, 1)
    }
  }

  /** 判断一个 pathname 是否命中已注册路由（用于协议层白名单过滤）。 */
  matchesRegisteredRoute(pathname: string): boolean {
    return this.routes.some((r) =>
      r.kind === 'prefix' ? pathname.startsWith(r.path) : pathname === r.path,
    )
  }
}

// ── 主进程侧安装与分发句柄 ───────────────────────────────────────────

/** 当前生效的 webServer 等价注册表（boot() prepare 安装）。 */
let activeRegistry: HttpCompatRegistry | null = null

/**
 * 在 Cordis 上下文安装 `ctx.webServer` 等价服务（boot() prepare 阶段调用）。
 *
 * 以 Cordis Service 形态注册（`ctx.provide('webServer')`），使旧/第三方插件
 * `inject: ["webServer"]` 能被解析并激活其 apply。
 * 注册表逻辑复用 `HttpCompatRegistry`（纯逻辑），模块级句柄供协议层 dispatch 复用。
 *
 * @param ctx Cordis Host 上下文。
 */
export async function installWebServerCompat(ctx: unknown): Promise<void> {
  const { Service } = await import('@deepseek-ai/cordis')
  const registry = new HttpCompatRegistry()
  activeRegistry = registry
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  class WebServerCompat extends (Service as any) {
    register(route: HttpCompatRoute): () => void {
      return registry.register(route)
    }
    registerUpgrade(route: { path: string; handler: unknown }): () => void {
      // 0.1.2 api-gateway 的 `/api/remote.mux` WS upgrade 装配占位（内存幂等，零监听）。
      return registry.registerUpgrade(route)
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (WebServerCompat as any)(ctx, 'webServer')
  log.ok('[dsh-compat] ctx.webServer 等价面已注入（memory register/dispatch，零监听）')
}

/** 协议层复用：分发一个 HTTP 请求到当前 webServer 等价注册表（未安装时返回 501）。 */
export async function dispatchHttpCompat(input: HttpCompatDispatchInput): Promise<HttpCompatDispatchResult> {
  if (activeRegistry === null) return { status: 501, headers: {}, body: 'compat webServer not installed' }
  return activeRegistry.dispatch(input)
}

/** 协议层复用：判断 pathname 是否命中已注册的 compat 路由（动态 fetch 白名单）。 */
export function matchesCompatRoute(pathname: string): boolean {
  if (activeRegistry === null) return false
  return activeRegistry.matchesRegisteredRoute(pathname)
}
