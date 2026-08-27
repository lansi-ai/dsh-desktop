import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { generateFullBootScript, resolveBundleRequest, buildThirdPartyBundles } from '../desktop-host/manifest.js'
import { dispatchHttpCompat, matchesCompatRoute } from '../desktop-host/compat-webserver.js'

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
      console.log('[dsh-ui-protocol] 使用官方 web-frontend dist')
    } else {
      hasDist = false
      console.warn('[dsh-ui-protocol] web-frontend dist 不存在，使用占位页面')
    }
  } catch {
    hasDist = false
    console.warn('[dsh-ui-protocol] 无法解析 web-frontend，使用占位页面')
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

/** Full boot manifest 注入脚本（含 IPC 载波 roster 条目 + queueLoader shim）。 */
function bootManifestScript(useDist: boolean): string {
  // 官方 dist 模式：额外装载第三方 client 插件（清单见 boot-graph.THIRD_PARTY_CLIENT_IDS）；
  // 占位页回退模式：注入最小样例 client 插件作为零端口装载路径验证载体。
  const extraBundles = useDist ? buildThirdPartyBundles() : [{ id: 'dsh-spike-sample', path: join(PLACEHOLDER_ROOT, 'dsh-spike-sample.js') }]
  return generateFullBootScript('desktop-m1-ipc', extraBundles)
}

/** 将 boot manifest 注入到 index.html 的 <head> 之后（对齐官方 IndexTap 语义）。 */
function injectBootManifest(html: string, useDist: boolean): string {
  const headEnd = html.indexOf('</head>')
  const script = bootManifestScript(useDist)
  if (headEnd === -1) return `${script}${html}`
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
      console.log(`[dsh-ui-protocol] 使用 ${useDist ? '官方 dist' : '占位页面'}，根目录: ${root}`)

      const url = new URL(request.url)

      // 方案 A：零端口 bundle route — /plugins/<id>/client.js[.map]?rev=...
      // 必须在 resolveRelative 之前判断（绝对路径 /plugins/ 不依赖 host）。
      const bundle = resolveBundleRequest(url.pathname)
      if (bundle !== undefined) {
        console.log(`[dsh-ui-protocol] 200 (bundle route) ${request.url}`)
        return new Response(new Uint8Array(bundle.body), { headers: { 'content-type': bundle.contentType } })
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
        console.log(`[dsh-ui-protocol] compat route ${request.method} ${url.pathname} → ${compatResult.status}`)
        return new Response(compatResult.body, { status: compatResult.status, headers: compatResult.headers })
      }

      const rel = resolveRelative(url, root)
      if (rel === undefined) {
        console.log(`[dsh-ui-protocol] 403 ${request.url} (越界)`)
        return new Response('forbidden', { status: 403 })
      }

      const filePath = join(root, rel)
      const data = await readFile(filePath)
      const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      const isIndex = rel.endsWith('index.html')
      const body = isIndex ? injectBootManifest(data.toString('utf8'), useDist) : data
      console.log(`[dsh-ui-protocol] 200 ${request.url} → ${rel} (${contentType})`)
      return new Response(body, { headers: { 'content-type': contentType } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`[dsh-ui-protocol] 404 ${request.url} (${message})`)
      return new Response(`not found: ${message}`, { status: 404 })
    }
  })
}