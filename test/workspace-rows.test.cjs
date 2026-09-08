/**
 * W3 · 行组件层纯函数行为断言。
 *
 * 与 W2 同构：vm 沙箱加载浏览器 bundle 并抓 `exports.derive` —— 与生产共用同一份真源。
 * W3 守护的是行渲染侧的纯逻辑：home 缩略、折叠切片、排序账户对齐、行状态点优先级。
 *
 * Rows 交互件（HoverCard / Menu / Drag 事件绑定）属 React 渲染域，本测试不渲染；
 * 其派生数据语义（sessionStatuses / nextSessionOrderAccount 等）在此锁定。
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

/** t 餐卡：把第 1 参当插槽，返回键名本身，便于只断言结构不断言文案。 */
const T = (key) => key

test('abbreviateHomePath：POSIX 归约 ~，Windows/跨风格/越界原样', () => {
  assert.equal(derive.abbreviateHomePath('/home/x/ws1', '/home/x'), '~/ws1')
  assert.equal(derive.abbreviateHomePath('/home/x', '/home/x'), '~')
  assert.equal(derive.abbreviateHomePath('/home/x/ws1', '/home/y'), '/home/x/ws1')
  assert.equal(derive.abbreviateHomePath('/etc', '/home/x'), '/etc')
  assert.equal(derive.isWindowsStylePath('C:\\Users\\x\\proj'), true)
  assert.equal(derive.isWindowsStylePath('/home/x'), false)
  // Windows 路径禁止缩略（避免把盘符路径炒成 ~）——即使 home 是 POSIX
  assert.equal(derive.abbreviateHomePath('D:\\proj', '/home/x'), 'D:\\proj')
})

test('toggled：不可变成员切换（新增 / 移除互不污染原数组）', () => {
  const base = ['w1']
  const added = derive.toggled(base, 'w2')
  // vm 跨 realm 数组与宿主数组引用不等（坑：勿用 deepEqual），以 join 基本值断言
  assert.equal(added.join(','), 'w1,w2')
  assert.equal(base.join(','), 'w1', '原数组不被改写')
  assert.equal(derive.toggled(base, 'w1').length, 0)
})

test('collapsedSessionRows：普通会话留前 5 行，blank 不计入限额且总保留', () => {
  const ordinary = Array.from({ length: 7 }, (_, i) => ({ blank: false, id: `s${i}` }))
  const { rows, hiddenCount } = derive.collapsedSessionRows(ordinary)
  assert.equal(rows.length, 5)
  assert.equal(hiddenCount, 2)

  // 混入 blank：blank 恒保留、不占限额
  const mixed = [
    ...Array.from({ length: 6 }, (_, i) => ({ blank: false, id: `s${i}` })),
    { blank: true, id: 'draft' },
  ]
  const m = derive.collapsedSessionRows(mixed)
  assert.equal(m.rows.length, 6, '5 普通 + 1 blank')
  assert.equal(m.rows[m.rows.length - 1].id, 'draft', 'blank 行位于尾部')
  assert.equal(m.hiddenCount, 1)
})

test('reconciledSessionOrder：消去已删除/归档 id，保留剩余相对序，新 id 追加尾部', () => {
  assert.equal(derive.reconciledSessionOrder(['s1', 's2', 's3'], undefined).join(','), 's1,s2,s3')
  // stored 含一已失踪 id，应跳过；新会话 s4 未在 stored，应追加
  assert.equal(derive.reconciledSessionOrder(['s1', 's3', 's4'], ['s3', 'gone', 's1']).join(','), 's3,s1,s4')
  // 重复 stored 键去重
  assert.equal(derive.reconciledSessionOrder(['s1', 's2'], ['s1', 's1', 's2']).join(','), 's1,s2')
})

test('compareSessionRecency：新在前，同 updatedAt 稳定平局（字典序）', () => {
  const byId = {
    a: { updatedAt: 100 },
    b: { updatedAt: 200 },
    c: { updatedAt: 200 },
  }
  assert.ok(derive.compareSessionRecency('b', 'a', byId) < 0, 'b 更新应排前')
  assert.ok(derive.compareSessionRecency('a', 'b', byId) > 0)
  assert.ok(derive.compareSessionRecency('b', 'c', byId) < 0, '同值按 id 字典序：b 在 c 前')
  assert.ok(derive.compareSessionRecency('c', 'b', byId) > 0)
  // 缺 updatedAt 的按负无穷兜底
  assert.ok(derive.compareSessionRecency('a', 'missing', byId) < 0)
})

test('nextSessionOrderAccount：手动序保留存储序；updated 活动提升 + sortByRecency 全序重排', () => {
  const sessions = {
    s1: { updatedAt: 100, id: 's1' },
    s2: { updatedAt: 300, id: 's2' },
    s3: { updatedAt: 200, id: 's3' },
  }
  const list = { byId: sessions }

  // 手动序（orderBy=manual）：不上提不重排，仅 reconciled
  const manual = derive.nextSessionOrderAccount({
    sessionIds: ['s1', 's2', 's3'],
    previousOrder: ['s3', 's1'],
    previousUpdatedAt: {},
    list,
    orderBy: 'manual',
    sortByRecency: false,
  })
  assert.equal(manual.order.join(','), 's3,s1,s2')

  // 最近更新总排序：s2(300) > s3(200) > s1(100)
  const recency = derive.nextSessionOrderAccount({
    sessionIds: ['s1', 's2', 's3'],
    previousOrder: undefined,
    previousUpdatedAt: {},
    list,
    orderBy: 'manual',
    sortByRecency: true,
  })
  assert.equal(recency.order.join(','), 's2,s3,s1')

  // updated：只有「更新过」的顶置，未更新的维持存储序
  const updated = derive.nextSessionOrderAccount({
    sessionIds: ['s1', 's2', 's3'],
    previousOrder: ['s3', 's2', 's1'],
    // s2 从 100 升到 300 → 判定「更新过」被顶置；s1/s3 未变维持原序
    previousUpdatedAt: { s1: 100, s2: 100, s3: 200 },
    list,
    orderBy: 'updated',
    sortByRecency: false,
  })
  // s2 更新到 300 > 记录值 100 → 顶置；其余保持 s3, s1
  assert.equal(updated.order.join(','), 's2,s3,s1')
  assert.equal(updated.changed, true)
})

test('sessionStatuses：pending 琥珀优先于 running 蓝，completed 绿最低，未完成者恒显示', () => {
  // 空闲
  let st = derive.sessionStatuses({ runningSubagentCount: 0, pendingInteraction: undefined, running: false, completed: false }, T)
  assert.equal(st.length, 1)
  assert.equal(st[0].state, 'done')
  assert.equal(st[0].label, 'status.idle')

  // completed 绿
  st = derive.sessionStatuses({ runningSubagentCount: 0, pendingInteraction: undefined, running: false, completed: true }, T)
  assert.equal(st[0].state, 'done')
  assert.equal(st[0].label, 'status.completed')

  // running 蓝
  st = derive.sessionStatuses({ runningSubagentCount: 0, pendingInteraction: undefined, running: true, completed: false }, T)
  assert.equal(st[0].state, 'ongoing')
  assert.equal(st[0].label, 'status.running')

  // pending approval 琥珀：enumeration 覆盖 running/completed
  st = derive.sessionStatuses({ runningSubagentCount: 0, pendingInteraction: 'approval', running: true, completed: true }, T)
  assert.equal(st[0].state, 'warning')
  assert.equal(st[0].label, 'status.waitingApproval')

  // 运行子代理附随（单复数键按 n 选字典）
  st = derive.sessionStatuses({ runningSubagentCount: 1, pendingInteraction: undefined, running: true, completed: false }, T)
  assert.equal(st.length, 2)
  assert.equal(st[1].state, 'ongoing')
  assert.equal(st[1].label, 'status.subagentsRunning.one')

  // 非法 pending 值应抛出（防止伪状态进入渲染）
  assert.throws(() => derive.sessionStatuses({ runningSubagentCount: 0, pendingInteraction: 'fraud', running: false, completed: false }, T))
})

test('sanitizeSearchQuery：去 NUL + 截断至码元上限，代理对切不断', () => {
  // 去 NUL
  assert.equal(derive.sanitizeSearchQuery('ab\0c\0d'), 'abcd')
  // 短输入原样返回
  assert.equal(derive.sanitizeSearchQuery('搜索 query'), '搜索 query')
  // 超长（>500 码元）截断至 500
  const long = 'x'.repeat(600)
  assert.equal(derive.sanitizeSearchQuery(long).length, 500)

  // 代理对（如 emoji）不从中腰切断：填入 498 个 BMP + 1 个两码元 emoji = 500 码元整
  const at = derive.sanitizeSearchQuery('a'.repeat(498) + '😀')
  assert.equal(at.length, 500)
  assert.equal(at.endsWith('\uFFFD'), false, '不应以替换符结尾')
})