/**
 * @lansi-ai/dsh-desktop-workspaces —— 工作区浏览区自有化（M6-P3 · W1 骨架）。
 *
 * 替换官方 `@deepseek-ai/dsh-client-ui-workspace`（见 boot-graph CLIENT_EXCLUDE_IDS）。
 * 本件承担该包被排除后的**全部**职责，共五项接管面，缺一项即静默劣化：
 *
 *   ① `uiWorkspace` 服务（接管面中最易漏的一项）
 *      官方 `UiWorkspaceService` 构造走 `super(ctx, "uiWorkspace")`，而 cordis `Service`
 *      基类构造内即 `ctx.reflect.provide(name, self)`，且「owning fiber 卸载时自动注销」
 *      （node_modules/@deepseek-ai/cordis/src/service.ts:57）。⇒ 排除该包 = 服务消失。
 *      硬 inject 它的四个包会因依赖不可满足而**永久 PENDING 且不报错**（坑 15）：
 *      dsh-desktop-sidebar（自绘侧栏壳）、ui-conversation（P4 前保留）、
 *      ui-directory-picker-native（directoryFlow 占洞者）、ui-agent-preset。
 *      故 W1 必须先立服务，六方法契约逐字对齐官方 types/client/navigation.d.ts。
 *      ⚠ 此条推翻看板原判断「UiWorkspaceService 未注册 ctx 服务，排除不连坐」。
 *   ② `slots.provideRoot({ hooks: { workspaces } })` —— 全局标准 prop `useWorkspaces` 唯一来源。
 *   ③ `locale.register('workspace', { zh, en })` —— 59 键，zh 为键集真源；两个 register 均带 locale。
 *   ④ 双注册全覆盖：WorkspaceBrowser → `sidebar.workspaces`（自有侧栏壳声明的洞）、
 *      WorkspacePicker → `conversation.hero.workspace`（官方 ui-conversation 声明，P4 前不消失）。
 *      两洞各自继续声明 `*.directoryFlow` 子洞（single/root），否则 native picker 无处占洞。
 *   ⑤ 动作注入面 `browserInjected` 十三项，全部薄转发官方 domain 服务（数据面零新增、零重实现）。
 *
 * W1 边界（有意为之）：两个槽位组件是**空壳**——只证明接管成功（本件组件渲染、locale 生效、
 * owner props 流通），行组件/树派生/搜索/拖拽归 W2-W4。故实机上侧栏工作区区域显示空态文案、
 * 对话区 workspace 选择器无内容，**这是预期中间态，不是回归**。
 * directoryFlow 洞在 W1 只声明不渲染（无「添加工作区」入口 → 流无从触发），W4 接通。
 *
 * 回滚：从 CLIENT_EXCLUDE_IDS 移除 ui-workspace 一行即回官方原状（本件与官方互斥，
 * 双激活会在 sidebar.workspaces 抛 "already has a registration"）。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译；
 * 样式一律 !important（坑 19），配色只用官方 --dsw-alias-* token（坑 26/27）。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-desktop-workspaces',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement
    const { Service } = require('@deepseek-ai/cordis')
    const { defineStore } = require('@deepseek-ai/dsh-client-store')

    /** 本件顶替官方件，复用官方字典命名空间（官方包已互斥排除，无冲突）。 */
    const NS = 'workspace'

    // ── 接管面①：uiWorkspace 服务 ────────────────────────────────────

    /** 目录浏览的结构化失败，暴露给目录 UI 消费方（对齐官方同名类型）。 */
    class DirectoryBrowseError extends Error {
      rpcError
      name = 'DirectoryBrowseError'
      /** @param rpcError Host 目录业务失败。 */
      constructor(rpcError) {
        super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
        this.rpcError = rpcError
      }
    }

    /**
     * 选出「最近活跃」的工作区：取会话最大 updatedAt 者，无会话则退回创建时间。
     * 平局由 Host 返回的工作区顺序决定（先遍历者胜），保证稳定。
     */
    function recentWorkspace(workspaces, sessions) {
      let selected
      let selectedTime = Number.NEGATIVE_INFINITY
      for (const workspace of workspaces) {
        let latest = Number.NEGATIVE_INFINITY
        for (const sessionId of workspace.sessionIds) {
          const session = sessions[sessionId]
          if (session !== undefined) latest = Math.max(latest, session.updatedAt)
        }
        if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
        if (selected === undefined || latest > selectedTime) {
          selected = workspace.workspaceId
          selectedTime = latest
        }
      }
      return selected
    }

    /**
     * 工作区导航与目录 UI 能力服务（契约 = 官方 UiWorkspace 六方法）。
     * 语义要点：connectWorkspace 是「复用-or-新建」——优先复用该工作区内已存在的
     * 空白会话（且未被归档、仍挂在 workspace.sessionIds 上），否则新建。
     */
    class DesktopWorkspaceNavService extends Service {
      directoryPicker
      workspaces
      sessions
      /** 同一工作区的并发 connect 去重表。 */
      connecting = new Map()

      /**
       * @param ctx 客户端根 Context。
       * @param directoryPicker 目录选择 Remote 命名空间。
       * @param workspaces 纯 Workspace Controller。
       * @param sessions 纯 Session Controller。
       */
      constructor(ctx, directoryPicker, workspaces, sessions) {
        super(ctx, 'uiWorkspace')
        this.directoryPicker = directoryPicker
        this.workspaces = workspaces
        this.sessions = sessions
        ctx.effect(() => this.watchNavigation(), 'dsh-desktop-workspaces: 工作区导航策略')
      }

      async connectWorkspace(workspaceId) {
        const workspace = this.workspaces.list.getSnapshot().items.find((item) => item.workspaceId === workspaceId)
        if (workspace === undefined) throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
        const inflight = this.connecting.get(workspaceId)
        if (inflight !== undefined) return inflight
        const archived = this.workspaces.list.getSnapshot().archivedSessionIds
        const sessions = this.sessions.list.getSnapshot()
        for (const id of sessions.ids) {
          const summary = sessions.byId[id]
          if (summary !== undefined && summary.blank && summary.cwd === workspace.path
            && workspace.sessionIds.includes(summary.id) && !archived.includes(summary.id)) return summary.id
        }
        const attempt = this.sessions.create({ workspaceId }).finally(() => {
          this.connecting.delete(workspaceId)
        })
        this.connecting.set(workspaceId, attempt)
        return attempt
      }

      startSession(workspaceId) {
        const workspace = this.workspaces.list.getSnapshot()
        const sessions = this.sessions.list.getSnapshot()
        const current = sessions.current
        const currentWorkspaceId = current === undefined
          ? undefined
          : workspace.items.find((item) => item.sessionIds.includes(current))?.workspaceId
        const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
          ? recentWorkspace(workspace.items, sessions.byId)
          : undefined
        const target = workspaceId ?? currentWorkspaceId ?? recent
        if (target === undefined) {
          this.sessions.clear()
          return
        }
        this.connectWorkspace(target).then((sessionId) => {
          this.sessions.open(sessionId)
        }, (reason) => {
          console.warn('new session failed:', reason)
        })
      }

      async archiveSession(sessionId) {
        await this.workspaces.archiveSession(sessionId)
      }

      async pickDirectory() {
        const result = await this.directoryPicker.pick()
        if (!result.ok) throw new Error(`directory picker failed: ${result.error.message}`)
        return result.value
      }

      async listDirectory(path, signal) {
        const result = await this.directoryPicker.list(path, signal)
        if (!result.ok) throw new DirectoryBrowseError(result.error)
        return result.value
      }

      async createDirectory(path, name) {
        const result = await this.directoryPicker.createDirectory(path, name)
        if (!result.ok) throw new DirectoryBrowseError(result.error)
        return result.value
      }

      /** 首启导航策略：无当前会话时自动连到最近活跃工作区；并持续清理被归档的当前选中。 */
      watchNavigation() {
        let initial = 'waiting'
        let disposed = false
        const reconcile = () => {
          if (disposed) return
          if (this.clearArchivedCurrent()) return
          if (initial !== 'waiting') return
          const workspace = this.workspaces.list.getSnapshot()
          const sessions = this.sessions.list.getSnapshot()
          if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return
          if (sessions.current !== undefined) {
            initial = 'done'
            return
          }
          const target = recentWorkspace(workspace.items, sessions.byId)
          if (target === undefined) {
            initial = 'done'
            return
          }
          initial = 'connecting'
          this.connectWorkspace(target).then((sessionId) => {
            if (disposed) return
            if (this.sessions.list.getSnapshot().current === undefined) this.sessions.open(sessionId)
            initial = 'done'
          }, (reason) => {
            if (disposed) return
            initial = 'waiting'
            console.warn('initial workspace selection failed:', reason)
          })
        }
        const disposeWorkspaces = this.workspaces.list.subscribe(reconcile)
        const disposeSessions = this.sessions.list.subscribe(reconcile)
        reconcile()
        return () => {
          disposed = true
          disposeSessions()
          disposeWorkspaces()
        }
      }

      /** @returns 当前选中会话已被归档并完成清理时为 true。 */
      clearArchivedCurrent() {
        const current = this.sessions.list.getSnapshot().current
        if (current === undefined || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
        this.sessions.clear()
        return true
      }
    }

    // ── 接管面③前置：viewing store（persist key 沿用官方，用户偏好天然继承）──

    /**
     * 工作区浏览视图 store（分组/排序模式 + 各组折叠态 + 分账户会话顺序）。
     * @returns store 句柄（spec + type + identity + factory 四合一，register 收句柄）。
     */
    function createWorkspaceViewStore() {
      return defineStore({
        init: () => ({
          groupBy: 'workspace',
          orderBy: 'updated',
          groupExpansion: {},
          sessionOrderByAccount: {},
          sessionUpdatedAtByAccount: {},
        }),
        persist: 'dsh.workspace.view.v5',
        actions: {
          setGroupBy: (d, mode) => { d.groupBy = mode },
          setOrderBy: (d, mode) => { d.orderBy = mode },
          setGroupExpanded: (d, key, expanded) => { d.groupExpansion[key] = expanded },
          retainAccountKeys: (d, workspaceKeys) => {
            const retained = new Set(workspaceKeys)
            d.groupExpansion = Object.fromEntries(Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)))
            d.sessionOrderByAccount = Object.fromEntries(Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)))
            d.sessionUpdatedAtByAccount = Object.fromEntries(Object.entries(d.sessionUpdatedAtByAccount).filter(([key]) => retained.has(key)))
          },
          syncSessionOrderAccount: (d, accountKey, order, updatedAt) => {
            d.sessionOrderByAccount[accountKey] = order
            d.sessionUpdatedAtByAccount[accountKey] = updatedAt
          },
          setSessionOrder: (d, accountKey, order) => { d.sessionOrderByAccount[accountKey] = order },
        },
      })
    }

    // ── 接管面③：workspace 字典（59 键，zh 为键集真源、en 全量对齐）──

    const zh = {
      'group.ungrouped': '未分组', 'session.new': '新会话',
      'section.workspaces': '工作区', 'section.sessions': '会话',
      'viewOptions.label': '视图选项',
      'groupBy.label': '分组方式', 'groupBy.workspace': '按工作区', 'groupBy.flat': '单列表',
      'orderBy.label': '排序方式', 'orderBy.manual': '手动排序', 'orderBy.updated': '最近更新',
      'sessions.expand': '展开其余 {n} 个会话', 'sessions.collapse': '收起',
      'empty.none': '暂无会话', 'empty.noMatches': '无匹配结果',
      'workspace.add': '添加工作区',
      'search.sessions.aria': '搜索会话', 'search.placeholder': '搜索会话…', 'search.clear': '清除搜索',
      'search.results.aria': '搜索结果', 'search.pending': '正在搜索会话历史…',
      'search.unavailable': '内容搜索暂不可用，仅显示名称匹配。', 'search.noMatches': '无匹配会话',
      'search.hasMore': '仅显示前 {n} 条结果，请缩小搜索范围。',
      'menu.addWorkspace': '添加工作区…', 'picker.loading': '正在加载工作区…',
      'conflict.named': '已存在名为“{name}”的工作区。',
      'folderError.title': '无法打开文件夹', 'folderError.retry': '重新选择',
      'rename': '重命名', 'rename.workspace.title': '重命名工作区', 'rename.session.title': '重命名会话',
      'field.workspaceName': '工作区名称', 'field.sessionName': '会话名称',
      'delete.workspace': '删除工作区',
      'delete.desc': '将把“{name}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。',
      'delete.pending': '正在删除工作区…',
      'menu.fork': '分叉会话', 'menu.archiveSession': '归档会话',
      'sessions.count.one': '{n} 个会话', 'sessions.count.other': '{n} 个会话',
      'actions.workspace.aria': '工作区“{name}”的操作', 'actions.session.aria': '会话“{name}”的操作',
      'actions.newSession.aria': '在“{name}”中新建会话',
      'status.running': '进行中', 'status.subagentsRunning.one': '{n} 个子代理运行中',
      'status.subagentsRunning.other': '{n} 个子代理运行中', 'status.idle': '空闲',
      'status.waitingApproval': '等待审批', 'status.planReview': '计划待审',
      'status.waitingAnswer': '等待回答', 'status.completed': '已完成',
      'schedule.active': '有活动定时任务',
      'hover.created': '创建于 {time}', 'hover.copied': '已复制',
      'date.ymd': '{y}年{m}月{d}日',
      'time.now': '刚刚', 'time.minutes': '{n}分钟', 'time.hours': '{n}小时',
      'time.days': '{n}天', 'time.months': '{n}个月', 'time.years': '{n}年', 'time.ago': '{t}前',
    }

    const en = {
      'group.ungrouped': 'Ungrouped', 'session.new': 'New Session',
      'section.workspaces': 'Workspaces', 'section.sessions': 'Sessions',
      'viewOptions.label': 'View options',
      'groupBy.label': 'Group by', 'groupBy.workspace': 'WorkSpace', 'groupBy.flat': 'In one list',
      'orderBy.label': 'Order by', 'orderBy.manual': 'Manual', 'orderBy.updated': 'Last updated',
      'sessions.expand': 'Show {n} more sessions', 'sessions.collapse': 'Show less',
      'empty.none': 'No sessions yet', 'empty.noMatches': 'No matches',
      'workspace.add': 'Add workspace',
      'search.sessions.aria': 'Search sessions', 'search.placeholder': 'Search sessions...',
      'search.clear': 'Clear search', 'search.results.aria': 'Search results',
      'search.pending': 'Searching session history…',
      'search.unavailable': 'Content search is temporarily unavailable. Showing name matches.',
      'search.noMatches': 'No matching sessions',
      'search.hasMore': 'Showing the first {n} results. Narrow your search.',
      'menu.addWorkspace': 'Add workspace…', 'picker.loading': 'Loading workspaces…',
      'conflict.named': 'A workspace named “{name}” already exists.',
      'folderError.title': 'Couldn’t open folder', 'folderError.retry': 'Choose again',
      'rename': 'Rename', 'rename.workspace.title': 'Rename workspace', 'rename.session.title': 'Rename session',
      'field.workspaceName': 'Workspace name', 'field.sessionName': 'Session name',
      'delete.workspace': 'Delete workspace',
      'delete.desc': 'This removes “{name}” from the workspace list. The folder and session logs will be kept. Its sessions will appear under Ungrouped.',
      'delete.pending': 'Deleting workspace…',
      'menu.fork': 'Fork session', 'menu.archiveSession': 'Archive session',
      'sessions.count.one': '{n} session', 'sessions.count.other': '{n} sessions',
      'actions.workspace.aria': 'Workspace actions for {name}', 'actions.session.aria': 'Session actions for {name}',
      'actions.newSession.aria': 'New session in {name}',
      'status.running': 'Running', 'status.subagentsRunning.one': '{n} subagent running',
      'status.subagentsRunning.other': '{n} subagents running', 'status.idle': 'Idle',
      'status.waitingApproval': 'Waiting for approval', 'status.planReview': 'Plan awaiting review',
      'status.waitingAnswer': 'Waiting for answer', 'status.completed': 'Completed',
      'schedule.active': 'Has active scheduled task',
      'hover.created': 'Created {time}', 'hover.copied': 'Copied',
      'date.ymd': '{y}-{m}-{d}',
      'time.now': 'now', 'time.minutes': '{n}min', 'time.hours': '{n}h',
      'time.days': '{n}d', 'time.months': '{n}mo', 'time.years': '{n}y', 'time.ago': '{t} ago',
    }

    // ── 接管面④：两个槽位组件（W1 空壳）─────────────────────────────

    const CSS_TEXT = `
.dsh-desktop-workspaces-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 2px;
}
.dsh-desktop-workspaces-title {
  padding: 6px 2px 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .02em;
  color: var(--dsw-alias-label-tertiary, light-dark(rgba(0,0,0,.45), rgba(255,255,255,.50)))!important;
}
.dsh-desktop-workspaces-placeholder {
  padding: 8px 2px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, light-dark(rgba(0,0,0,.62), rgba(255,255,255,.68)))!important;
}
`

    /**
     * 侧栏工作区浏览区（W1 空壳）。
     * props 契约对齐官方 WorkspaceBrowser：owner `{ wide, expandSidebar }` +
     * register 的 store/inject/locale 标准面。W2-W4 在此填树、行组件与目录流。
     */
    function WorkspaceBrowser({ wide, t }) {
      return h('div', {
        className: 'dsh-desktop-workspaces-section',
        'data-dsh-desktop-workspaces': 'browser',
        'data-wide': wide ? '1' : '0',
      },
        h('div', { className: 'dsh-desktop-workspaces-title' }, t('section.workspaces')),
        h('div', { className: 'dsh-desktop-workspaces-placeholder' }, t('empty.none')),
      )
    }

    /**
     * 对话区空态工作区选择器（W1 空壳，渲染 null）。
     * 槽位仍必须注册：一是顶掉官方件，二是继续声明 directoryFlow 子洞供 native picker 占位。
     */
    function WorkspacePicker() {
      return null
    }

    exports.inject = ['slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker']

    exports.apply = (ctx) => {
      // 样式注入（幂等：带本件标识，重复装载先移除）
      document.getElementById('dsh-desktop-workspaces-css')?.remove()
      const style = document.createElement('style')
      style.id = 'dsh-desktop-workspaces-css'
      style.textContent = CSS_TEXT
      document.head.appendChild(style)

      const sessions = ctx.get('sessions')
      const workspaces = ctx.get('workspaces')
      // ① 服务面：排除官方包后，四个硬 inject uiWorkspace 的消费方全靠这里补位
      const uiWorkspace = new DesktopWorkspaceNavService(ctx, ctx.remote.directoryPicker, workspaces, sessions)
      // ② 全局标准 prop useWorkspaces 的唯一提供者
      ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } })
      // ③ 字典命名空间
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-desktop-workspaces: dictionaries')

      const searchSessions = async (query, signal) => {
        const result = await sessions.search(query, signal)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      }
      /** 目录流占洞态：洞有人占用才显示「添加工作区」入口（uSES 契约，反应式驱动）。 */
      const flowSource = (hole) => ({
        getSnapshot: () => ctx.slots.entries(hole).length > 0,
        subscribe: (listener) => ctx.slots.subscribe(hole, listener),
      })
      /** Host 信息快照（仅用于把 home 路径缩写成 POSIX `~`）。 */
      const hostInfo = {
        getSnapshot: () => ctx.remote.$host,
        subscribe: (listener) => ctx.on('connection/reset', listener),
      }
      // ⑤ 动作注入面：全部薄转发官方 domain 服务，数据面零新增
      const browserInjected = () => ({
        startSession: (workspaceId) => { uiWorkspace.startSession(workspaceId) },
        open: (sessionId) => { sessions.open(sessionId) },
        searchSessions,
        searchResultLimit: sessions.searchResultLimit,
        renameSession: async (sessionId, title) => {
          const session = sessions.binding(sessionId)?.session
          if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
          const result = await session.rename(title)
          if (!result.ok) throw new Error(result.error.message)
        },
        forkSession: (sessionId) => {
          sessions.fork({ sessionId, increaseTitle: true }).then((childId) => {
            sessions.open(childId)
          }).catch(() => {})
        },
        renameWorkspace: async (workspaceId, title) => { await workspaces.rename(workspaceId, title) },
        deleteWorkspace: async (workspaceId) => { await workspaces.delete(workspaceId) },
        // Host 持久排序（跨重启保留）
        insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
          await workspaces.insertBefore(workspaceId, beforeWorkspaceId)
        },
        archiveSession: async (sessionId) => { await uiWorkspace.archiveSession(sessionId) },
        insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
          await workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
        },
        createWorkspace: (input) => workspaces.create(input),
        hooks: {
          directoryFlow: flowSource('sidebar.workspaces.directoryFlow'),
          hostInfo,
        },
      })
      const pickerInjected = () => ({
        createWorkspace: (input) => workspaces.create(input),
        hooks: { directoryFlow: flowSource('conversation.hero.workspace.directoryFlow') },
      })

      const disposers = []
      const collect = (returned) => { if (typeof returned === 'function') disposers.push(returned) }
      // ④-1 侧栏浏览区：洞由自有侧栏壳（dsh-desktop-sidebar）声明，经 slots.inject 等落地，
      //     不假设装载顺序；children 继续声明 directoryFlow 子洞。
      collect(ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
        name: 'sidebar.workspaces',
        children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
        store: createWorkspaceViewStore(),
        inject: browserInjected,
        locale: NS,
      }, WorkspaceBrowser)))
      // ④-2 对话区选择器：洞由官方 ui-conversation 声明（P4 前不消失），故必须双注册。
      collect(ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register({
        name: 'conversation.hero.workspace',
        children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
        inject: pickerInjected,
        locale: NS,
      }, WorkspacePicker)))

      return () => {
        for (const dispose of disposers) dispose()
        document.getElementById('dsh-desktop-workspaces-css')?.remove()
      }
    }

    return module.exports
  },
})
