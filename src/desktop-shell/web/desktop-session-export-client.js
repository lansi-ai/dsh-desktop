/**
 * @lansi-ai/dsh-desktop-session-export —— Session 日志导出自有化（M6 外壳小件）。
 *
 * 替换官方 @deepseek-ai/dsh-session-log-export 的 client 半（boot-graph CLIENT_EXCLUDE_IDS
 * 排除；host 半 `session-log-download` 行保留，继续提供 /export 命令 + /api/session.export
 * ZIP 流式路由——两条装配线互不影响）。
 *
 * 与官方 client 半的行为差异（自有化动机）：
 *   - 官方中文文案写死「浏览器正在下载 Session ZIP 文件」，在桌面端语义错误；
 *     自有化后文案改为「正在将 Session ZIP 保存到系统"下载"文件夹」。
 *   - 下载机制与官方一致：同源 HEAD 预检（经协议层 connection fetch 桥）+ anchor
 *     下载交给 Electron 下载管理器（默认落盘系统"下载"目录）。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-desktop-session-export',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement

    // ── locale 词典（自有 NS，避开官方 session-log-download 以防未来双激活冲突）──
    const NS = 'desktop-session-export'
    const zh = {
      'header.action': 'Session 日志',
      'dialog.preparingTitle': '正在导出 Session',
      'dialog.preparingDescription': '正在准备包含当前会话、子会话与附件的 ZIP 文件。',
      'dialog.successTitle': 'Session 导出已开始下载',
      'dialog.successDescription': '正在将 Session ZIP 保存到系统"下载"文件夹。',
      'dialog.errorTitle': 'Session 导出失败',
      'dialog.close': '关闭',
      'dialog.commandFailed': '无法启动 Session 导出。',
    }
    const en = {
      'header.action': 'Session log',
      'dialog.preparingTitle': 'Exporting Session',
      'dialog.preparingDescription': 'Preparing a ZIP containing this session, its sub-sessions, and attachments.',
      'dialog.successTitle': 'Session download started',
      'dialog.successDescription': 'The Session ZIP is being saved to your system Downloads folder.',
      'dialog.errorTitle': 'Session export failed',
      'dialog.close': 'Close',
      'dialog.commandFailed': 'Could not start the Session export.',
    }

    // ── 极简可订阅 store（uSES 契约：getSnapshot/subscribe，供槽位 hooks 隔间绑定）──
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        update(recipe) {
          const next = recipe(state)
          if (next !== state) {
            state = next
            listeners.forEach((fn) => { try { fn() } catch { /* noop */ } })
          }
        },
      }
    }

    // ── 下载 controller（逻辑对齐官方 SessionLogDownloadController）──
    const INITIAL = { bySession: {} }
    function sanitizeSessionId(id) {
      return String(id).replace(/[^A-Za-z0-9_-]/g, '_')
    }
    function zipFilename(sessionId) {
      return `dsh-session-${sanitizeSessionId(sessionId)}.zip`
    }
    function hostBase() {
      const origin = globalThis.location?.origin
      return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
    }
    function downloadUrl(url, filename) {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
    }

    const store = createStore(INITIAL)
    const active = new Map()
    let disposed = false

    function publish(sessionId, entry) {
      store.update((state) => ({
        bySession: { ...state.bySession, [String(sessionId)]: entry },
      }))
    }

    async function run(sessionId, signal) {
      publish(sessionId, { open: true, status: 'downloading', error: null })
      try {
        const url = new URL('/api/session.export', hostBase())
        url.searchParams.set('sessionId', sessionId)
        url.searchParams.set('includeDescendants', 'true')
        const response = await fetch(url, { method: 'HEAD', signal })
        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          throw new Error(`Export failed: HTTP ${response.status}${detail === '' ? '' : ` ${detail}`}`)
        }
        downloadUrl(url.toString(), zipFilename(sessionId))
        const entry = store.getSnapshot().bySession[String(sessionId)]
        publish(sessionId, { open: entry?.open ?? true, status: 'success', error: null })
      } catch (error) {
        if (signal.aborted) return
        const entry = store.getSnapshot().bySession[String(sessionId)]
        publish(sessionId, {
          open: entry?.open ?? true,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    function download(sessionId) {
      const existing = active.get(sessionId)
      if (existing !== undefined) return existing.done
      if (disposed) return Promise.resolve()
      const abort = new AbortController()
      const done = run(sessionId, abort.signal).finally(() => active.delete(sessionId))
      active.set(sessionId, { abort, done })
      return done
    }

    function dismiss(sessionId) {
      const current = store.getSnapshot().bySession[String(sessionId)]
      if (current === undefined || !current.open) return
      publish(sessionId, { ...current, open: false })
    }

    async function dispose() {
      disposed = true
      for (const operation of [...active.values()]) operation.abort.abort()
      await Promise.allSettled([...active.values()].map((o) => o.done))
    }

    // ── 官方 primitives 守卫 require（坑 23 同款；失败回退内置弹层）──
    let primitivesCache = undefined
    function getPrimitives() {
      if (primitivesCache !== undefined) return primitivesCache
      try {
        const p = require('@deepseek-ai/dsh-client-ui-primitives')
        if (p && typeof p.Modal === 'function' && typeof p.Button === 'function') {
          primitivesCache = { Modal: p.Modal, Button: p.Button }
          return primitivesCache
        }
      } catch (error) {
        console.warn('[dsh-desktop-session-export] 官方 primitives 不可用，回退内置弹层:', error)
      }
      primitivesCache = null
      return primitivesCache
    }

    /** 回退弹层（primitives 不可用时）：极简居中卡片。 */
    function FallbackModal({ open, onClose, title, description, closeLabel }) {
      if (!open) return null
      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 10000, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.4)',
        },
        onClick: onClose,
      },
        h('div', {
          role: 'dialog',
          style: {
            background: 'var(--dsw-alias-surface-primary, #fff)', borderRadius: 12,
            padding: '20px 24px', maxWidth: 360, minWidth: 280,
            boxShadow: '0 8px 32px rgba(0,0,0,.2)',
          },
          onClick: (e) => e.stopPropagation(),
        },
          h('div', { style: { fontWeight: 600, marginBottom: 8, fontSize: 15 } }, title),
          h('div', { style: { fontSize: 13, opacity: .8, marginBottom: 16, lineHeight: 1.5 } }, description),
          h('button', {
            type: 'button',
            onClick: onClose,
            style: {
              padding: '6px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
              border: '0.5px solid var(--dsw-alias-border-l4)',
              background: 'var(--dsw-alias-interactive-bg-hover, transparent)',
              color: 'var(--dsw-alias-label-primary)',
            },
          }, closeLabel),
        ),
      )
    }

    function SessionExportDialog({ sessionId, useSessionExportDownload, dismiss: onDismiss, t }) {
      const entry = useSessionExportDownload((state) => state.bySession[String(sessionId)])
      const status = entry?.status
      const open = entry?.open === true
      const error = status === 'error' ? entry?.error || t('dialog.commandFailed') : null
      const primitives = getPrimitives()
      const title = status === 'downloading' ? t('dialog.preparingTitle')
        : status === 'success' ? t('dialog.successTitle') : t('dialog.errorTitle')
      const description = status === 'downloading' ? t('dialog.preparingDescription')
        : status === 'success' ? t('dialog.successDescription') : error ?? t('dialog.commandFailed')
      const closeLabel = t('dialog.close')
      if (primitives === null) {
        return h(FallbackModal, { open, onClose: () => onDismiss(sessionId), title, description, closeLabel })
      }
      const { Modal, Button } = primitives
      return h(Modal, {
        open,
        onClose: () => { onDismiss(sessionId) },
        title,
        description,
        closeLabel,
        footer: h(Button, {
          variant: 'primary',
          onClick: () => { onDismiss(sessionId) },
        }, closeLabel),
      })
    }

    /** 注入胶囊样式（幂等，视觉对齐官方 HeaderAction 胶囊）。 */
    function injectStyles() {
      const tagId = '@lansi-ai/dsh-desktop-session-export/HeaderAction.module.css'
      if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = '@lansi-ai/dsh-desktop-session-export'
      tag.dataset.pluginCss = tagId
      tag.textContent = `
.dsh-desktop-session-export-button{border:.5px solid var(--dsw-alias-border-l4);min-width:111px;height:32px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);cursor:pointer;background:0 0;border-radius:18px;justify-content:center;align-items:center;gap:4px;padding:6px 12px;font-size:13px;font-weight:400;line-height:20px;display:inline-flex}
.dsh-desktop-session-export-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-desktop-session-export-button:disabled{color:var(--dsw-alias-label-dimmed);cursor:wait}
.dsh-desktop-session-export-button span,.dsh-desktop-session-export-button svg{flex:none}
.dsh-desktop-session-export-button span{white-space:nowrap}`
      document.head.appendChild(tag)
    }

    /** 内联下载图标（12px，currentColor 随主题）。 */
    function DownloadIcon() {
      return h('svg', {
        width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        h('path', { d: 'M8 2v8m0 0l-3-3m3 3l3-3' }),
        h('path', { d: 'M2.5 12.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1' }),
      )
    }

    function SessionExportHeaderAction(props) {
      const { sessionId, useSessionExportDownload, request, t } = props
      const busy = useSessionExportDownload((state) => state.bySession[String(sessionId)])?.status === 'downloading'
      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          className: 'dsh-desktop-session-export-button',
          disabled: busy === true,
          'aria-busy': busy === true,
          onClick: () => { request(sessionId) },
        },
          h('span', null, t('header.action')),
          h(DownloadIcon),
        ),
        h(SessionExportDialog, props),
      )
    }

    exports.inject = ['slots', 'locale']
    exports.apply = (ctx) => {
      injectStyles()
      ctx.provide('sessionLogDownload', { download, dismiss, dispose, store })
      ctx.effect(() => async () => {
        await dispose()
      }, 'desktop-session-export: browser download lifecycle')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'desktop-session-export: dictionaries')
      // /export 斜杠命令成功后自动触发下载（对齐官方行为；命令本身由 host 半注册）
      ctx.on('command/executed', (sessionId, commandName, result) => {
        if (commandName === 'export' && result.kind === 'success') download(sessionId)
      })
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'desktop-session-export',
        locale: NS,
        inject: () => ({
          hooks: { sessionExportDownload: store },
          request: (sessionId) => download(sessionId),
          dismiss: (sessionId) => dismiss(sessionId),
        }),
      }, SessionExportHeaderAction))
    }

    return exports
  },
})
