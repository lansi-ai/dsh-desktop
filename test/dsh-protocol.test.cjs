/**
 * M4-a2 · dsh:// 协议安全白名单（R10）纯逻辑断言。
 *
 * 守护 `parseDshUrl` / `authorizeDshUrl` / `extractDshUrlFromArgv` 与
 * `routeDshProtocol` 的授权决策：
 *   - 参数强校验：未知 key / 非法 session 格式 / 超长文本 / 多余 pathname 一律拒绝；
 *   - 来源授权三态：白名单命中 allow；未命中且外部开启 degrade（open 拒绝新建）；
 *     未命中且外部关闭 deny，并落 `protocol.deny` / `protocol.degrade` 审计。
 *
 * dsh-protocol.js 编译产物仅依赖纯 zod（electron / window-manager 已被类型擦除），
 * 故可脱离 Electron 直接加载。依赖：Node >= 20，运行 `npm test`（先 `npm run build`）。
 */
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const proto = require(path.join(__dirname, '..', 'dist', 'desktop-host', 'dsh-protocol.js'))
const { parseDshUrl, authorizeDshUrl, extractDshUrlFromArgv, routeDshProtocol, MAX_DSH_URL_LENGTH } = proto

// ── parseDshUrl：参数强校验 ─────────────────────────────────────────────

test('parseDshUrl 接受合法 open/ask/settings', () => {
  assert.deepEqual(parseDshUrl('dsh://open?session=abc123'), {
    action: 'open',
    params: { session: 'abc123' },
  })
  assert.deepEqual(parseDshUrl('dsh://ask?q=你好'), { action: 'ask', params: { q: '你好' } })
  assert.deepEqual(parseDshUrl('dsh://settings'), { action: 'settings', params: {} })
})

test('parseDshUrl 拒绝非法 session（字符/超长/缺失）', () => {
  assert.equal(parseDshUrl('dsh://open?session=../etc'), null)
  assert.equal(parseDshUrl('dsh://open?session=%2e%2e%2fetc'), null)
  assert.equal(parseDshUrl(`dsh://open?session=${'a'.repeat(65)}`), null)
  assert.equal(parseDshUrl('dsh://open'), null)
})

test('parseDshUrl 拒绝 q 超长与未知 query key', () => {
  assert.equal(parseDshUrl(`dsh://ask?q=${'x'.repeat(2001)}`), null)
  assert.equal(parseDshUrl('dsh://open?session=abc123&evil=1'), null)
  assert.equal(parseDshUrl('dsh://ask?q=hi&evil=1'), null)
})

test('parseDshUrl 拒绝 settings 携带 query / 多余 pathname / 非 dsh scheme', () => {
  assert.equal(parseDshUrl('dsh://settings?session=abc'), null)
  assert.equal(parseDshUrl('dsh://open/x?session=abc'), null)
  assert.equal(parseDshUrl('https://example.com'), null)
})

test('parseDshUrl 畸形编码不回退、不越界；URL 超长拒绝', () => {
  const res = parseDshUrl('dsh://ask?q=%E0%A4%A')
  // URL API 对非法 UTF-8 用替换字符兜底：不产生未知 key、动作枚举仍受控，q 仍受长度约束
  assert.equal(res.action, 'ask')
  assert.deepEqual(Object.keys(res.params), ['q'])
  assert.equal(parseDshUrl('dsh://ask?q=' + 'x'.repeat(MAX_DSH_URL_LENGTH)), null)
})

// ── authorizeDshUrl：三态判定 ───────────────────────────────────────────

test('authorizeDshUrl 白名单命中 → allow', () => {
  const res = authorizeDshUrl('argv', [{ source: 'argv' }], true)
  assert.equal(res.decision, 'allow')
  assert.equal(res.authorized, true)
})

test('authorizeDshUrl 未命中 + 外部开启 → degrade', () => {
  const res = authorizeDshUrl('argv', [], true)
  assert.equal(res.decision, 'degrade')
  assert.equal(res.authorized, false)
})

test('authorizeDshUrl 未命中 + 外部关闭 → deny', () => {
  const res = authorizeDshUrl('open-url', [{ source: 'launch' }], false)
  assert.equal(res.decision, 'deny')
  assert.equal(res.authorized, false)
})

// ── routeDshProtocol：授权决策落地 ──────────────────────────────────────

function mockDesktop() {
  const logs = []
  const emits = []
  return {
    logs,
    emits,
    log(action, payload) {
      logs.push({ action, payload })
    },
    emitAction(action) {
      emits.push(action)
    },
    sendDesktopEvent() {},
    readConfig() {},
    writeConfig() {},
    onAction() {
      return () => {}
    },
  }
}

function failingWindowManager() {
  return {
    focusSessionWindow: () => ({ success: false }),
    createSessionWindow: () => {},
  }
}

test('route degrade：未授权来源 open 拒绝新建会话窗口', () => {
  const desktop = mockDesktop()
  const result = routeDshProtocol('dsh://open?session=abc123', {
    getWindow: () => null,
    desktop,
    windowManager: failingWindowManager(),
    source: 'argv',
    allowlist: [],
    externalEnabled: true,
  })
  assert.equal(result.success, false)
  assert.match(result.message, /受限来源/)
  // 审计落 protocol.degrade
  assert.ok(desktop.logs.some((l) => l.action === 'protocol.degrade'))
})

test('route allow：白名单命中 open 创建会话窗口', () => {
  const desktop = mockDesktop()
  let created = false
  const windowManager = {
    focusSessionWindow: () => ({ success: false }),
    createSessionWindow: () => {
      created = true
    },
  }
  const result = routeDshProtocol('dsh://open?session=abc123', {
    getWindow: () => null,
    desktop,
    windowManager,
    source: 'argv',
    allowlist: [{ source: 'argv' }],
    externalEnabled: true,
  })
  assert.equal(result.success, true)
  assert.equal(created, true)
  // create 审计经 emitAction 触发
  assert.ok(desktop.emits.includes('protocol.open.create'))
})

test('route deny：外部唤起关闭时拒绝并落 protocol.deny', () => {
  const desktop = mockDesktop()
  const result = routeDshProtocol('dsh://ask?q=hi', {
    getWindow: () => null,
    desktop,
    windowManager: null,
    source: 'open-url',
    allowlist: [],
    externalEnabled: false,
  })
  assert.equal(result.success, false)
  assert.match(result.message, /被拒绝/)
  assert.ok(desktop.logs.some((l) => l.action === 'protocol.deny'))
})

test('route deny：非法 URL 拒绝', () => {
  const desktop = mockDesktop()
  const result = routeDshProtocol('dsh://open?session=../etc', {
    getWindow: () => null,
    desktop,
    windowManager: null,
    source: 'argv',
    allowlist: [],
    externalEnabled: true,
  })
  assert.equal(result.success, false)
})

// ── extractDshUrlFromArgv：超长防护 ─────────────────────────────────────

test('extractDshUrlFromArgv 提取裸/带引号/超长', () => {
  assert.equal(extractDshUrlFromArgv(['electron', 'dsh://ask?q=hi']), 'dsh://ask?q=hi')
  assert.equal(extractDshUrlFromArgv(['electron', '"dsh://settings"']), 'dsh://settings')
  assert.equal(extractDshUrlFromArgv(['electron', 'dsh://' + 'x'.repeat(MAX_DSH_URL_LENGTH)]), null)
  assert.equal(extractDshUrlFromArgv(['electron', '--flag']), null)
})