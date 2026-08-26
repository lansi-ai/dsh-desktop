import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, join, normalize, sep } from 'node:path'

/**
 * dsh-ui:// 自定义协议：将官方 Web UI dist（@deepseek-ai/dsh-web-frontend/dist/）
 * 映射为可加载的页面与静态资源，并对 index.html 注入最小 __DSH_BOOT__ manifest。
 *
 * URL 布局（官方 dist 使用绝对路径 /assets/...，host 承载首段）：
 *   dsh-ui://index.html                  → dist/index.html（注入 boot manifest）
 *   dsh-ui://index.html/assets/<file>    → dist/assets/<file>
 *   dsh-ui:///assets/<file>              → dist/assets/<file>（host 为空兜底）
 *
 * __DSH_BOOT__ 为最小空 graph（rev + 空 entries，wire 格式对齐
 * dsh-client-modules client/manifest.ts WebBootGraph），步骤 4 roster 注入前
 * 仅用于验证官方 UI 可经协议装载（M1 spike，R5 取证）。
 */

const nodeRequire = createRequire(__filename)

/** 官方 web 前端包根（npm 包内 package.json 的绝对路径）。 */
const WEB_FRONTEND_PKG = nodeRequire.resolve('@deepseek-ai/dsh-web-frontend/package.json')

/** 官方 UI dist 根目录。 */
const DIST_ROOT = join(dirname(WEB_FRONTEND_PKG), 'dist')

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
 * 解析 dsh-ui:// URL 到 dist 内的相对路径（安全：normalize 后必须留在 DIST_ROOT 内）。
 * @param url - 协议请求 URL。
 * @returns dist 相对路径（'/' 时归一为 index.html），或 undefined 表示越界。
 */
function resolveDistRelative(url: URL): string | undefined {
  const host = url.hostname
  const rawPath = decodeURIComponent(url.pathname)
  const rel = (host === '' ? rawPath : `${host}${rawPath}`).replace(/^\/+/, '')
  if (rel === '' || rel === '/' || rel.endsWith('/')) return 'index.html'
  const filePath = normalize(join(DIST_ROOT, rel))
  if (!filePath.startsWith(DIST_ROOT + sep) && filePath !== DIST_ROOT) return undefined
  return rel
}

/** 空 boot manifest 注入脚本（wire 对齐 WebBootGraph：rev + entries）。 */
function bootManifestScript(): string {
  const graph = { rev: 'desktop-m1', entries: [] }
  const queueLoader = `(()=>{
const pendingQueue=[]
window.__ModuleLoader__={
  mode:"queue",
  pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(options){
    if(this.mode!=="queue")throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot")
    const index=pendingQueue.findIndex(registration=>registration.id==="@deepseek-ai/dsh-client-modules/client.js")
    const registration=pendingQueue[index]
    if(registration===undefined)throw new Error("client-modules: HTML did not preload @deepseek-ai/dsh-client-modules/client.js")
    pendingQueue.splice(index,1)
    const exports=registration.factory(specifier=>{
      throw new Error('client-modules: @deepseek-ai/dsh-client-modules/client.js requested external "'+specifier+'" before the module system existed')
    })
    if(typeof exports!=="object"||exports===null||typeof exports.createClientModuleSystem!=="function"||typeof exports.apply!=="function"){
      throw new Error("client-modules: @deepseek-ai/dsh-client-modules/client.js did not export the bootstrap module face")
    }
    return exports.createClientModuleSystem(this,{id:registration.id,exports},options)
  }
}
})()`
  return `<script>${queueLoader}</script><script>window.__DSH_BOOT__ = ${JSON.stringify(graph)}</script>`
}

/** 将最小 boot manifest 注入到 index.html 的 <head> 之后（对齐官方 IndexTap 语义）。 */
function injectBootManifest(html: string): string {
  const headEnd = html.indexOf('</head>')
  const script = bootManifestScript()
  if (headEnd === -1) return `${script}${html}`
  return `${html.slice(0, headEnd)}${script}${html.slice(headEnd)}`
}

/** 注册 dsh-ui:// 协议（app.whenReady 后调用一次）。 */
export function registerDshUiProtocol(): void {
  protocol.handle('dsh-ui', async (request: Request): Promise<Response> => {
    try {
      const rel = resolveDistRelative(new URL(request.url))
      if (rel === undefined) return new Response('forbidden', { status: 403 })
      const filePath = join(DIST_ROOT, rel)
      const data = await readFile(filePath)
      const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      const body = rel.endsWith('index.html') ? injectBootManifest(data.toString('utf8')) : data
      return new Response(body, { headers: { 'content-type': contentType } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new Response(`not found: ${message}`, { status: 404 })
    }
  })
}