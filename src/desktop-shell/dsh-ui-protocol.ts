import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { generateFullBootScript, resolveBundleRequest, buildThirdPartyBundles } from '../desktop-host/manifest.js'
import { dispatchHttpCompat, matchesCompatRoute } from '../desktop-host/compat-webserver.js'
import { dispatchConnectionFetch } from '../desktop-host/connection-fetch-bridge.js'
import { log, logVerbose } from '../desktop-host/log.js'

/**
 * dsh-ui:// 自定义协议：
 * 1. 优先加载官方 Web UI dist（@deepseek-ai/dsh-web-frontend/dist/）
 * 2. dist 不存在时回退到内置占位页面（src/desktop-shell/web/index.html）
 *
 * 对 index.html 注入完整 __DSH_BOOT__ manifest（含 IPC 载波 roster 条目，
 * 替换官方 WebSocket/HTTP 传输条目）。
 *
 * URL 布局：
 *   dsh-ui://app/index.html               → 主页面（注入 boot manifest；host 为固定虚拟标识）
 *   dsh-ui://app/assets/<file>            → 静态资源（官方 dist 根绝对路径 /assets/... 经此落地）
 */

const nodeRequire = createRequire(__filename)

/** 是否存在官方 web-frontend dist 目录（启动时检测）。 */
let hasDist: boolean | null = null

/** 官方 UI dist 根目录（存在时使用）。 */
let distRoot: string | null = null

/** 占位页面根目录（dist 不存在时使用）。 */
const PLACEHOLDER_ROOT = join(__dirname, 'web')

/**
 * 开发模式：默认使用官方 web-frontend dist（D-3 主线复用官方发行物）。
 * 仅当官方 dist 缺失时才回退到占位页面。
 * 注：官方 dist 需确保 npm 安装完整落盘（dsh-web-frontend dist 内含 assets/）。
 */
const FORCE_PLACEHOLDER = false

/** MIME 映射（覆盖 dist 实际产出类型）。 */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/**
 * 检测 dist 目录可用性（懒加载，首次访问时检测）。
 * 若 FORCE_PLACEHOLDER = true，则始终返回 false。
 */
function checkDistAvailable(): boolean {
  if (FORCE_PLACEHOLDER) {
    hasDist = false
    return false
  }
  if (hasDist !== null) return hasDist
  try {
    const pkg = nodeRequire.resolve('@deepseek-ai/dsh-web-frontend/package.json')
    const root = join(dirname(pkg), 'dist')
    if (existsSync(join(root, 'index.html'))) {
      distRoot = root
      hasDist = true
      log.ok('[dsh-ui-protocol] 使用官方 web-frontend dist')
    } else {
      hasDist = false
      log.warn('[dsh-ui-protocol] web-frontend dist 不存在，使用占位页面')
    }
  } catch {
    hasDist = false
    log.warn('[dsh-ui-protocol] 无法解析 web-frontend，使用占位页面')
  }
  return hasDist
}

/**
 * 解析 dsh-ui:// URL 到目标根目录内的相对路径（安全：normalize 后必须留在根目录内）。
 *
 * 仅用 pathname 映射（**忽略 host**）：官方 dist 资源为根绝对路径（/assets/...），
 * 页面以固定虚拟 host `dsh-ui://app` 加载，浏览器把 /assets/... 解析为
 * `dsh-ui://app/assets/...`；host 恒为虚拟标识，不参与文件路径（R5 修复：
 * 空 host 会被 Electron 规范化为 dsh-ui://index.html/，若把 host 拼入 rel 会错位）。
 * @param url - 协议请求 URL。
 * @param root - 根目录（dist 或占位页面）。
 * @returns 相对路径（'/' 时归一为 index.html），或 undefined 表示越界。
 */
function resolveRelative(url: URL, root: string): string | undefined {
  const rawPath = decodeURIComponent(url.pathname)
  const rel = rawPath.replace(/^\/+/, '')
  if (rel === '' || rel === '/' || rel.endsWith('/')) return 'index.html'
  const filePath = normalize(join(root, rel))
  if (!filePath.startsWith(root + sep) && filePath !== root) return undefined
  return rel
}

/** Full boot manifest 注入脚本（含 IPC 载波 roster 条目 + queueLoader shim + 基线版本全局）。 */
function bootManifestScript(useDist: boolean): string {
  // 官方 dist 模式：额外装载第三方 client 插件（清单见 boot-graph.THIRD_PARTY_CLIENT_IDS）；
  // 占位页回退模式：注入最小样例 client 插件作为零端口装载路径验证载体。
  const extraBundles = useDist ? buildThirdPartyBundles() : [{ id: 'dsh-spike-sample', path: join(PLACEHOLDER_ROOT, 'dsh-spike-sample.js') }]
  const boot = generateFullBootScript('desktop-m1-ipc', extraBundles)
  // 注入当前实际安装的 DSH 基线版本全局，供自绘 UI（如标题栏）渲染展示。
  const baseVersion = resolveDshBaseVersion()
  const versionScript = `<script>window.__DSH_BASE_VERSION__ = ${JSON.stringify(baseVersion)}</script>`
  // 0.1.2 自持传输载波：官方 client-connection 的 apply() 读 `window.__DSH_TRANSPORT__`
  // 选传输。必须在 plugin boot 前把桌面 IPC 传输装成页面全局（对齐官方 worker-preview
  // 的 connectWorkerHost 形态），官方 createWebConnectionRpc 自动装配 ctx.connection。
  //   fetch       → desktopBridge.request（unary，host connection.createSharedFetchHandler.fetch）
  //   openStream  → preload 逻辑流载波（$events / 业务流经 host typertGateway.wireStream.open）
  //   ownsHost    → isLoopback 恒真，绕过 Host/Origin 信任围栏
  const transportScript = `<script>
(()=>{
  const transport = {
    async fetch(input, init) {
      const url = input instanceof URL ? input : new URL(String(input))
      const method = String(init?.method ?? 'GET').toUpperCase()
      const body = init?.body != null ? JSON.parse(String(init.body)) : undefined
      if (method !== 'POST' || body == null) {
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const rpcId = body.rpcId
      const rpcMethod = body.method ?? url.pathname.replace(/^\\/api\\//, '')
      if (rpcId === undefined || rpcMethod === undefined) {
        return new Response('invalid client-request', { status: 400 })
      }
      const raw = await window.desktopBridge.request({ rpcId, method: rpcMethod, params: body.payload })
      const result = raw && typeof raw === 'object' && 'error' in raw
        ? { ok: false, error: raw.error }
        : { ok: true, value: raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw }
      return new Response(JSON.stringify({ type: 'server-response', rpcId, result }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    },
    async *openStream(endpoint, payload, signal) {
      const db = window.desktopBridge
      const streamId = (() => {
        return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : \`\${Date.now()}-\${Math.random().toString(36).slice(2)}\`
      })()
      const queue = []
      const waiters = []
      const offFrame = db.onStreamFrame((frame) => {
        if (frame.streamId !== streamId) return
        queue.push(frame.value)
        const waiter = waiters.shift()
        if (waiter !== undefined) waiter()
      })
      let closed = false
      let closeMessage = null
      const offClose = db.onStreamClose((frame) => {
        if (frame.streamId !== streamId) return
        closed = true
        closeMessage = frame.message
        const waiter = waiters.shift()
        if (waiter !== undefined) waiter()
      })
      const onAbort = () => { db.closeStream(streamId) }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        await db.openStream(streamId, endpoint, payload)
        while (true) {
          if (queue.length > 0) { yield queue.shift(); continue }
          if (closed) { if (closeMessage !== null) throw new Error(closeMessage); return }
          await new Promise((resolve) => { waiters.push(resolve) })
        }
      } finally {
        signal.removeEventListener('abort', onAbort)
        offFrame()
        offClose()
        db.closeStream(streamId)
      }
    },
    loadBundle: undefined,
    ownsHost: true,
  }
  window.__DSH_TRANSPORT__ = transport
})()</script>`
  // 0.1.2 就绪门控：官方 `AppWebEntry.run()` 首行 `await __DSH_BOOT_READY__.promise`。
  // 桌面在 `__DSH_BOOT__` + 模块系统 bootstrap 脚本之后 resolve（对齐官方 webserver
  // tail 脚本 `READY_MARKUP`：`??= Promise.withResolvers()` 后 resolve）。
  // 调试：`DSH_BARE_SCREEN_MS` > 0 时延迟 resolve，拉长「骨架裸屏期」（插件未装载）
  // 供观察首帧样式，如 `$env:DSH_BARE_SCREEN_MS='10000'`。
  const bareScreenMs = Number.parseInt(process.env.DSH_BARE_SCREEN_MS ?? '', 10)
  const bareScreenDelay = Number.isFinite(bareScreenMs) && bareScreenMs > 0 ? bareScreenMs : 0
  const readyScript = `<script>
(()=>{
  const ready = globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()
  const delay = ${bareScreenDelay}
  if (delay > 0) {
    console.warn('[dsh-ui-protocol] 裸屏观察模式：延迟 ' + delay + 'ms 后再装载插件')
    setTimeout(() => ready.resolve(), delay)
  } else {
    ready.resolve()
  }
})()</script>`
  return boot + versionScript + transportScript + readyScript
}

/** 读取当前实际安装的 `@deepseek-ai/dsh` 基线版本（主进程侧，require 已安装包）。 */
function resolveDshBaseVersion(): string {
  try {
    const version = nodeRequire('@deepseek-ai/dsh/package.json').version
    return typeof version === 'string' && version !== '' ? version : 'unknown'
  } catch (error) {
    log.warn('[dsh-ui-protocol] 解析 DSH 基线版本失败:', error)
    return 'unknown'
  }
}

/** 将 boot manifest 注入到 index.html 的 <head> 之后（对齐官方 IndexTap 语义）。 */
function injectBootManifest(html: string, useDist: boolean): string {
  const headEnd = html.indexOf('</head>')
  const script = bootManifestScript(useDist)
  if (headEnd === -1) return script + html
  return `${html.slice(0, headEnd)}${script}${html.slice(headEnd)}`
}

/**
 * 注册 dsh-ui:// 协议方案特权（必须在 app.whenReady 前调用）。
 *
 * 将 dsh-ui 注册为标准协议，赋予 origin、secure context 等能力，
 * 避免 CORS 策略将 origin 判定为 null 导致资源加载被拦截。
 */
export function registerDshUiScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'dsh-ui',
      privileges: {
        standard: true,
        secure: true,
        allowServiceWorkers: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ])
}

/** 注册 dsh-ui:// 协议（app.whenReady 后调用一次）。 */
export function registerDshUiProtocol(): void {
  protocol.handle('dsh-ui', async (request: Request): Promise<Response> => {
    try {
      const useDist = checkDistAvailable()
      const root = useDist && distRoot !== null ? distRoot : PLACEHOLDER_ROOT
      logVerbose('dsh-ui-protocol', `使用 ${useDist ? '官方 dist' : '占位页面'}，根目录: ${root}`)

      const url = new URL(request.url)

      // 方案 A：零端口 bundle route — /plugins/<id>/client.js[.map]?rev=...
      // 必须在 resolveRelative 之前判断（绝对路径 /plugins/ 不依赖 host）。
      const bundle = resolveBundleRequest(url.pathname)
      if (bundle !== undefined) {
        logVerbose('dsh-ui-protocol', `200 (bundle route) ${request.url}`)
        return new Response(new Uint8Array(bundle.body), { headers: { 'content-type': bundle.contentType } })
      }

      // connection fetch 精确路由桥（0.1.2 · dogfood #6）：官方 client 半部分能力
      // （Session 日志导出等）用浏览器原生 fetch 同源请求 /api/<route>（HEAD 探测 +
      // anchor 下载），不经 __DSH_TRANSPORT__。非 POST 的 /api/ 请求转发到 host
      // connection 共享 fetch 处理器：命中 connection.fetch 精确路由（如
      // /api/session.export，GET/HEAD）→ 官方流式响应；未命中 → 官方处理器自身 404。
      // 必须在 compat 匹配前判断（官方 host connection 注册的 /api 前缀 compat 路由
      // 首行做浏览器信任围栏检查，对桌面请求恒 403）；POST /api unary 走
      // desktopBridge.request IPC 载波，不经协议层。
      if (request.method !== 'POST' && url.pathname.startsWith('/api/')) {
        const bridged = dispatchConnectionFetch(request)
        if (bridged !== null) {
          logVerbose('dsh-ui-protocol', `connection fetch bridge ${request.method} ${url.pathname}`)
          return bridged
        }
        return new Response('not found', { status: 404 })
      }

      // 第三方 web 插件同源 fetch 拦截（M1 门禁·ADR-007 → M2-b 动态白名单）：
      // 旧/第三方插件 client 半用浏览器 `fetch('/<route-prefix>/*')` 调用 host webServer 路由。
      // 零端口下无 HTTP 服务器，此处经 dsh-ui:// 协议转发到 host 的 ctx.webServer 等价面
      // （dispatchHttpCompat），对插件透明。白名单由 compat 注册表动态生成，不再硬编码。
      if (matchesCompatRoute(url.pathname)) {
        const compatResult = await dispatchHttpCompat({
          method: request.method,
          url: url.pathname,
          headers: Object.fromEntries(request.headers.entries()),
          body: Buffer.from(await request.arrayBuffer()),
        })
        logVerbose('dsh-ui-protocol', `compat route ${request.method} ${url.pathname} → ${compatResult.status}`)
        return new Response(compatResult.body, { status: compatResult.status, headers: compatResult.headers })
      }

      const rel = resolveRelative(url, root)
      if (rel === undefined) {
        log.warn(`[dsh-ui-protocol] 403 ${request.url} (越界)`)
        return new Response('forbidden', { status: 403 })
      }

      const filePath = join(root, rel)
      const data = await readFile(filePath)
      const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      const isIndex = rel.endsWith('index.html')
      const body = isIndex ? injectBootManifest(data.toString('utf8'), useDist) : data
      logVerbose('dsh-ui-protocol', `200 ${request.url} → ${rel} (${contentType})`)
      return new Response(body, { headers: { 'content-type': contentType } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`[dsh-ui-protocol] 404 ${request.url} (${message})`)
      return new Response(`not found: ${message}`, { status: 404 })
    }
  })
}