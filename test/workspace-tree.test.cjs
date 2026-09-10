/**
 * W2 · tree 派生层行为断言。
 *
 * 通过 vm 沙箱加载浏览器 bundle（mock window/__ModuleLoader__/document 与 require），
 * 抓取 `exports.derive` 钩子 —— 与生产运行共用**同一份真源**（不复制实现，避免漂移），
 * 守护：血缘索引、分组/折叠/未分组、blank/archived/subagent 可见性、扁平排序、内容搜索合并、
 * 行状态优先级（pendingInteraction > running > completed）。
 *
 * 依赖：Node >= 20（node:test 内置），运行 `npm test`。
 */
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const BUNDLE = path.join(__dirname, '..', 'src', 'desktop-shell', 'web', 'desktop-workspaces-client.js')

/** 抓取 bundle 导出的派生纯函数注册表。 */
function loadDerive() {
  const source = fs.readFileSync(BUNDLE, 'utf8')
  let spec = null
  const context = {
    console,
    window: {
      __ModuleLoader__: { load: (s) => { spec = s } },
    },
    // factory 内 require：非浏览器态原语的模块仅需满足「类定义/工厂定义」期的符号存在，
    // 派生纯函数本身不触碰它们。react 解构出 undefined 均只在渲染期用，此处不渲染。
    require: (id) => {
      switch (id) {
        case '@deepseek-ai/cordis': return { Service: class {} }
        case '@deepseek-ai/dsh-client-store': return { defineStore: () => ({}) }
        default: return {}
      }
    },
  }
  vm.createContext(context)
  vm.runInContext(source, context, { filename: BUNDLE })
  if (spec === null) throw new Error('__ModuleLoader__.load 未执行，bundle 加载失败')
  const exports = spec.factory(context.require)
  if (!exports.derive) throw new Error('exports.derive 钩子缺失')
  return exports.derive
}

const derive = loadDerive()

// ── 夹具：一小组会话 + 两工作区，覆盖普通/空白/子代理/归档四种会话 ──
const ws1 = { workspaceId: 'w1', title: 'WS One', path: '/home/x/ws1', createdAt: '2026-01-01T00:00:00Z', sessionIds: ['s1', 's2', 'b1', 'sub1', 'sub2'] }
const ws2 = { workspaceId: 'w2', title: 'WS Two', path: '/home/x/ws2', createdAt: '2026-01-02T00:00:00Z', sessionIds: [] }
const workspaces = [ws1, ws2]

const s1 = { id: 's1', origin: 'user', displayTitle: 'Alpha Preview', updatedAt: 100, running: false, completed: false, projectionValues: {} }
const s2 = { id: 's2', origin: 'user', displayTitle: 'Beta', updatedAt: 200, running: true, completed: false, cwd: '/home/x/ws1', projectionValues: {} }
const s3 = { id: 's3', origin: 'user', displayTitle: 'Gamma', updatedAt: 300, running: false, completed: true, cwd: '/home/x/other', projectionValues: {} }
const b1 = { id: 'b1', origin: 'user', blank: true, displayTitle: '', updatedAt: 50, cwd: '/home/x/ws1', projectionValues: {} }
const sub1 = { id: 'sub1', origin: 'subagent', parentId: 's2', running: true, displayTitle: 'sub', updatedAt: 150, projectionValues: {} }
const sub2 = { id: 'sub2', origin: 'subagent', parentId: 'sub1', running: false, displayTitle: 'sub2', updatedAt: 140, projectionValues: {} }
const a1 = { id: 'a1', origin: 'user', displayTitle: 'Archived', updatedAt: 400, projectionValues: {} }

const list = { byId: { s1, s2, s3, b1, sub1, sub2, a1 }, ids: ['s1', 's2', 's3', 'b1', 'sub1', 'sub2', 'a1'], current: 's2' }

test('indexSubagentDescendants：血缘沿父链归并，running 计数只累加运行后代', () => {
  const indexed = derive.indexSubagentDescendants(list.byId)
  // sub1(parent=s2, running) + sub2(parent=sub1) → s2 累计 2；running 仅 sub1 ⇒ 1
  assert.equal(indexed.get('s2').count, 2)
  assert.equal(indexed.get('s2').runningCount, 1)
  // sub1 只有 sub2 一个后代
  assert.equal(indexed.get('sub1').count, 1)
  assert.equal(indexed.get('sub1').runningCount, 0)
  // 无子代者不入索引
  assert.equal(indexed.get('s1'), undefined)
})

test('owningGroupKey：会话归属首中即真源；无归属返回空串（未分组桶）', () => {
  // s1/s2/b1/sub1/sub2 ∈ w1；s3 游离
  assert.equal(derive.owningGroupKey(workspaces, 's1'), 'w1')
  assert.equal(derive.owningGroupKey(workspaces, 'sub2'), 'w1')
  assert.equal(derive.owningGroupKey(workspaces, 's3'), '')
  // 空工作区集恒为未分组
  assert.equal(derive.owningGroupKey([], 's1'), '')
})

test('deriveGroups：按工作区分组 + 展开/折叠 + blank 仅当前可见 + containsCurrent + 未分组桶', () => {
  const groups = derive.deriveGroups(list, workspaces, ['a1'], new Map(), { expandedGroups: ['w1'] })
  assert.equal(groups.length, 3, 'w1 + w2 + 未分组桶')

  const g1 = groups[0]
  assert.equal(g1.key, 'w1')
  assert.equal(g1.label, 'WS One')
  assert.equal(g1.expanded, true)
  assert.equal(g1.containsCurrent, true, '当前会话 s2 所属 w1 应命中')
  // 成员 = s1, s2（b1 blank 非当前排除；sub1/sub2 子代理随父；a1 归档归格清除）
  assert.equal(g1.sessionCount, 2)
  assert.equal(g1.sessions.length, 2)
  assert.equal(g1.sessions[0].id, 's1')
  assert.equal(g1.sessions[1].id, 's2')

  const g2 = groups[1]
  assert.equal(g2.key, 'w2')
  assert.equal(g2.sessionCount, 0)
  assert.equal(g2.containsCurrent, false)

  const stray = groups[2]
  assert.equal(stray.key, '')
  assert.equal(stray.label, '')
  assert.equal(stray.expanded, false, '未展开组的会话不投影')
  assert.equal(stray.sessionCount, 1, 's3 游离于所有工作区之外')
})

test('deriveGroups：折叠组不投影会话；展开其余后含状态点（pending > running > completed）', () => {
  const expandedAll = derive.deriveGroups(list, workspaces, ['a1'], new Map([['s3', { kind: 'approval' }]]), { expandedGroups: ['w1', ''] })
  const stray = expandedAll[2]
  assert.equal(stray.expanded, true)
  assert.equal(stray.sessions.length, 1)
  // 行状态优先级：pendingInteraction(琥珀) 存在 → 覆盖 running/completed 语义位
  assert.equal(stray.sessions[0].pendingInteraction, 'approval')
  assert.equal(stray.sessions[0].completed, true)

  // 折叠组（w2）sessions 为空数组，sessionCount 已计入
  const collapsed = derive.deriveGroups(list, workspaces, ['a1'], new Map(), { expandedGroups: [] })
  assert.equal(collapsed[0].sessions.length, 0)
  assert.equal(collapsed[0].sessionCount, 2)
})

test('deriveFlat：全部可见会话作顶层行，新在前，子代理/空白/归档排除', () => {
  const rows = derive.deriveFlat(list, ['a1'], new Map([['s3', { kind: 'approval' }]]))
  // 可见：s1(100) s2(200) s3(300)；递减 → s3, s2, s1
  assert.equal(rows.length, 3)
  assert.equal(rows[0].id, 's3')
  assert.equal(rows[1].id, 's2')
  assert.equal(rows[2].id, 's1')
  assert.equal(rows[0].pendingInteraction, 'approval')
  assert.equal(rows[0].completed, true)
  assert.equal(rows[1].running, true)
  assert.equal(rows[1].runningSubagentCount, 1, 's2 下 2 个子代理、其中 1 个运行')
})

test('deriveSearchResults：空白查询返回空；本地标题/工作区命中 + 内容命中合并去重 + limit 截断', () => {
  const content = { items: [{ sessionId: 's3', snippet: 'Gamma 匹配上下文' }], hasMore: false }
  const empty = derive.deriveSearchResults(list, workspaces, '   ', ['a1'], new Map(), content, 10)
  assert.equal(empty.items.length, 0)
  assert.equal(empty.hasMore, false)

  const r = derive.deriveSearchResults(list, workspaces, 'beta', ['a1'], new Map(), content, 10)
  // 本地命中：s2 标题 'Beta'；再补内容命中 s3
  assert.equal(r.items.length, 2)
  assert.equal(r.items[0].id, 's2')
  assert.equal(r.items[0].workspace, 'WS One')
  assert.equal(r.items[1].id, 's3')
  assert.equal(r.items[1].snippet, 'Gamma 匹配上下文')
  assert.equal(r.hasMore, false)

  // 内容命中重复会话（s2 已被本地命中也出现在 content）应就地取片段、不重复入列
  const dup = derive.deriveSearchResults(list, workspaces, 'beta', ['a1'], new Map(), { items: [{ sessionId: 's2', snippet: 'dup' }, { sessionId: 's3', snippet: 'x' }], hasMore: true }, 10)
  assert.equal(dup.items.length, 2)
  assert.equal(dup.items[0].id, 's2')
  assert.equal(dup.items[0].snippet, 'dup')
  assert.equal(dup.items[1].id, 's3')
})

test('deriveSearchResults：limit 截断并置位 hasMore；归档与空白永不命中', () => {
  const content = { items: [{ sessionId: 's3', snippet: 'x' }], hasMore: false }
  const limited = derive.deriveSearchResults(list, workspaces, 'beta', ['a1'], new Map(), content, 1)
  assert.equal(limited.items.length, 1)
  assert.equal(limited.items[0].id, 's2')
  assert.equal(limited.hasMore, true, 'ordered(2) > limit(1) 应提示细化')

  // 'archived' 是 a1 标题子串，但 a1 已归档 ⇒ 不出现在结果
  const names = derive.deriveSearchResults(list, workspaces, 'archived', ['a1'], new Map(), { items: [], hasMore: false }, 10)
  assert.equal(names.items.length, 0)

  // blank 会话 b1 标题为空且是空白会话；即使查 cwd 名，空白会话也不入搜索
  const blank = derive.deriveSearchResults(list, workspaces, 'ws1', ['a1'], new Map(), { items: [], hasMore: false }, 10)
  assert.equal(blank.items.find((i) => i.id === 'b1'), undefined)
})

test('workspaceTitleOf / workspaceLabel：路径标签归约，POSIX 与 Windows 分隔符均接受', () => {
  assert.equal(derive.workspaceTitleOf('/home/x/ws1'), 'ws1')
  assert.equal(derive.workspaceTitleOf('C:\\Users\\x\\proj'), 'proj')
  assert.equal(derive.workspaceTitleOf('/a/b/'), 'b')
  assert.equal(derive.workspaceLabel('/home/x/ws1'), 'ws1')
  assert.equal(derive.workspaceLabel(undefined), '')
  assert.equal(derive.workspaceLabel(''), '')
})

test('sessionNode：blank 标题置空；hasActiveSchedule 由 projectionValues 推导', () => {
  const withSchedule = { ...s1, projectionValues: { schedule: [{ id: 't' }] } }
  const node = derive.sessionNode(withSchedule, new Map(), new Map())
  assert.equal(node.hasActiveSchedule, true)
  assert.equal(node.runningSubagentCount, 0)

  const blankNode = derive.sessionNode(b1, new Map(), new Map())
  assert.equal(blankNode.title, '')
  assert.equal(blankNode.blank, true)
})