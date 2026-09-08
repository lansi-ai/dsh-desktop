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
 * 承重边界（2026-09-08 实机修正）：**选/加工作区的路径不得留空**——它决定能否建立
 * current session，进而决定官方输入框是否 `inert`（disabled）。故 Picker 与「添加工作区」
 * 入口随本件首批落地。仍可后置的是视觉与浏览效率件：会话树派生（W2）、行组件与状态点
 * （W3）、搜索 / 视图选项 / 折叠 / 拖拽（W4）。
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
    const { useState, useEffect, useCallback } = React
    const { Service } = require('@deepseek-ai/cordis')
    const { defineStore } = require('@deepseek-ai/dsh-client-store')
    // 官方 UI 原语：平台种子模块，与官方 ui-workspace 同口径直接 require（不做守卫回退，
    // 取不到即整个应用不可用，回退无意义）。
    const {
      Menu, Modal, Button,
      StateDot, HoverCard,
      relativeTime,
      IconPlusOutline16, IconFolderClose16, IconFolderOpen16, IconTriangleRightFill14,
      IconEditOutline16, IconTrashOutline16, IconEllipsisOutline16, IconBranchOutline16,
      IconArchiveOutline20, IconAlarmClockOutline16, IconPersonalizationOutline16,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

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

    // ── W2 · tree 派生层（纯函数，逐字对齐官方 ui-workspace 的 derive 族）───────
    //
    // 本段是会话浏览区从「会话清单 × 工作区 × 视图偏好」到「可渲染行投影」的全部纯计算，
    // 无 React / DOM 依赖，可被 Node 直接单测（exports.derive 钩子，见 test/workspace-tree.test.cjs）。
    // 语义约束：① 行状态 pendingInteraction(琥珀) > running(蓝) > completed(绿)，
    //         由 sessionNode 的顺序字段承载；② Manual 拖拽经 orderBy 进 Host 持久排序（W4 消费）。

    /** 可进入行投影的 pending 交互种类（其余零投影，保持行态与领域对象解耦）。 */
    function visiblePendingKind(kind) {
      switch (kind) {
        case 'approval':
        case 'plan-review':
        case 'question': return kind
        default: return undefined
      }
    }

    /**
     * 取工作区路径的最后非空段（POSIX / Windows 分隔符均接受），供显示标签使用。
     * ⚠ 逐字对齐官方 `@deepseek-ai/dsh-util-workspace-path`（该官方包为 ESM，__ModuleLoader__ 无
     *   选择器保证→此处内联等价实现，官方 ui-workspace 打包时同样是内联该工具）。
     * @param path 路径；分隔符路径返回空串。
     */
    function workspaceTitleOf(path) {
      const trimmed = path.replace(/[/\\]+$/, '')
      const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
      return trimmed.slice(separator + 1)
    }

    /**
     * 目录显示标签：取路径 basename；无按分组桶兜底空串。
     * @param cwd 目录路径，或 undefined（未分组桶）。
     */
    function workspaceLabel(cwd) {
      if (cwd === undefined || cwd === '') return ''
      const base = workspaceTitleOf(cwd)
      return base !== '' ? base : cwd
    }

    /** 新旧比较器：新在前，id 做确定性平局断（同组内 id 唯一）。 */
    function byRecency(a, b) {
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
      return a.id < b.id ? -1 : 1
    }

    /** 普通会话可见；空白会话仅当前选中者可见（暂定新会话行）；子代理随父标题档，归档处处不可见。 */
    function sessionVisible(session, current, archived) {
      return session.origin !== 'subagent' && !archived.has(session.id) && (!session.blank || session.id === current)
    }

    /** 空白会话的规范标题永不入搜索；其绘本行标签由渲染层本地化。 */
    function sessionTitle(session) {
      return session.blank ? '' : session.displayTitle
    }

    /** 列表投影独享 best-effort 活动定时任务指示。 */
    function hasActiveSchedule(session) {
      return (session.projectionValues?.schedule?.length ?? 0) > 0
    }

    /** 按祖先聚合不受中断的子代理后代，running 计数仅对 running 后代累加。 */
    function indexSubagentDescendants(summaries) {
      const indexed = new Map()
      for (const descendant of Object.values(summaries)) {
        if (descendant.origin !== 'subagent') continue
        const seen = new Set()
        let current = descendant
        while (current?.origin === 'subagent' && current.parentId !== undefined && !seen.has(current.id)) {
          seen.add(current.id)
          const aggregate = indexed.get(current.parentId)
          if (aggregate === undefined) indexed.set(current.parentId, { count: 1, runningCount: descendant.running ? 1 : 0 })
          else {
            aggregate.count += 1
            if (descendant.running) aggregate.runningCount += 1
          }
          current = summaries[current.parentId]
        }
      }
      return indexed
    }

    function sessionNode(s, descendants, pendingInteractions) {
      const pendingInteraction = visiblePendingKind(pendingInteractions.get(s.id)?.kind)
      return {
        id: s.id,
        title: sessionTitle(s),
        blank: s.blank,
        running: s.running,
        runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
        completed: s.completed === true,
        hasActiveSchedule: hasActiveSchedule(s),
        updatedAt: s.updatedAt,
        ...pendingInteraction === undefined ? {} : { pendingInteraction },
      }
    }

    /** 组装一组，不把会话血缘投影进展示层。 */
    function buildGroup(key, workspaceId, cwd, createdAt, label, members, order) {
      const sessions = [...members]
      if (order === 'recency') sessions.sort(byRecency)
      return { key, workspaceId, cwd, createdAt, label, sessions }
    }

    /** 套用持久化的未分组顺序，后接按新旧补齐新脱组的会话。 */
    function orderedUngrouped(members, stored) {
      const byId = new Map(members.map((session) => [session.id, session]))
      const included = new Set()
      const ordered = []
      for (const key of stored) {
        const session = byId.get(key)
        if (session === undefined || included.has(key)) continue
        ordered.push(session)
        included.add(key)
      }
      for (const session of [...members].sort(byRecency)) {
        if (included.has(session.id)) continue
        ordered.push(session)
      }
      return ordered
    }

    /**
     * 按 Host 工作区分组：每组随稳定 Host 顺序，成员自 workspace.sessionIds 按其存储序解析。
     * 所有工作区之外的会话汇入未分组桶，其顺序优先持久序、回退新旧。
     */
    function groupByWorkspace(list, workspaces, archived, ungroupedOrder) {
      const groups = []
      const accounted = new Set()
      for (const workspace of workspaces) {
        const members = []
        for (const id of workspace.sessionIds) {
          const summary = list.byId[id]
          if (summary === undefined) continue
          accounted.add(id)
          if (!sessionVisible(summary, list.current, archived)) continue
          members.push(summary)
        }
        groups.push(buildGroup(workspace.workspaceId, workspace.workspaceId, workspace.path,
          Date.parse(workspace.createdAt), workspace.title, members, 'account'))
      }
      const stray = list.ids.map((id) => list.byId[id])
        .filter((s) => s !== undefined && !accounted.has(s.id) && sessionVisible(s, list.current, archived))
      if (stray.length > 0) {
        groups.push(buildGroup('', undefined, undefined, undefined, '',
          ungroupedOrder === undefined ? stray : orderedUngrouped(stray, ungroupedOrder),
          ungroupedOrder === undefined ? 'recency' : 'account'))
      }
      return groups
    }

    /**
     * 派生分组视图：每组作顶层行，展开组内会话按本地顺序投影为行。
     * 空白会话排除，仅当前选中者的暂定「新会话」行保留；归档处处排除；内容搜索在 view 外。
     * @param view `{ expandedGroups, ungroupedOrder? }` 由上层从 store 状态构造（W3/W4）。
     */
    function deriveGroups(list, workspaces, archivedSessionIds, pendingInteractions, view) {
      const archived = new Set(archivedSessionIds)
      const expandedGroups = new Set(view.expandedGroups)
      const descendants = indexSubagentDescendants(list.byId)
      const currentGroup = list.current === undefined
        ? undefined
        : workspaces.find((w) => w.sessionIds.includes(list.current))?.workspaceId ?? ''
      const groups = []
      for (const g of groupByWorkspace(list, workspaces, archived, view.ungroupedOrder)) {
        const expanded = expandedGroups.has(g.key)
        groups.push({
          key: g.key,
          workspaceId: g.workspaceId,
          cwd: g.cwd,
          createdAt: g.createdAt,
          label: g.label,
          sessionCount: g.sessions.length,
          expanded,
          containsCurrent: g.key === currentGroup,
          sessions: expanded ? g.sessions.map((session) => sessionNode(session, descendants, pendingInteractions)) : [],
        })
      }
      return groups
    }

    /** 派生单列表：所有会话（含分叉子）作顶层行，严格新在前。无分组、无母子邻接。 */
    function deriveFlat(list, archivedSessionIds, pendingInteractions) {
      const archived = new Set(archivedSessionIds)
      const descendants = indexSubagentDescendants(list.byId)
      const rows = []
      for (const id of list.ids) {
        const s = list.byId[id]
        if (s === undefined || !sessionVisible(s, list.current, archived)) continue
        rows.push(s)
      }
      rows.sort(byRecency)
      return rows.map((session) => sessionNode(session, descendants, pendingInteractions))
    }

    /**
     * 合并本地标题/工作区子串命中与 Host 排名内容命中：本地行新在前，内容行保持后端口径，
     * 重复会话就地取后端片段。
     * @returns 有界去重的扁平行 + 需进一步细化查询的提示位。
     */
    function deriveSearchResults(list, workspaces, query, archivedSessionIds, pendingInteractions, content, limit) {
      const q = query.trim().toLowerCase()
      if (q === '') return { items: [], hasMore: false }
      const archived = new Set(archivedSessionIds)
      const descendants = indexSubagentDescendants(list.byId)
      const workspaceBySession = new Map()
      for (const workspace of workspaces) {
        for (const sessionId of workspace.sessionIds) {
          if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title)
        }
      }
      const labelOf = (summary) => workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd)
      const contentBySession = new Map()
      for (const item of content.items) {
        if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item)
      }
      const local = []
      for (const id of list.ids) {
        const summary = list.byId[id]
        if (summary === undefined || summary.blank || !sessionVisible(summary, list.current, archived)) continue
        if (sessionTitle(summary).toLowerCase().includes(q) || labelOf(summary).toLowerCase().includes(q)) local.push(summary)
      }
      local.sort(byRecency)
      const ordered = []
      const included = new Set()
      const include = (summary) => {
        if (included.has(summary.id)) return
        included.add(summary.id)
        ordered.push(summary)
      }
      for (const summary of local) include(summary)
      for (const item of content.items) {
        const summary = list.byId[item.sessionId]
        if (summary !== undefined && !summary.blank && sessionVisible(summary, list.current, archived)) include(summary)
      }
      return {
        items: ordered.slice(0, limit).map((summary) => {
          const match = contentBySession.get(summary.id)
          const pendingInteraction = visiblePendingKind(pendingInteractions.get(summary.id)?.kind)
          return {
            id: summary.id,
            title: sessionTitle(summary),
            workspace: labelOf(summary),
            running: summary.running,
            runningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,
            ...pendingInteraction === undefined ? {} : { pendingInteraction },
            completed: summary.completed === true,
            hasActiveSchedule: hasActiveSchedule(summary),
            ...match === undefined ? {} : { snippet: match.snippet },
          }
        }),
        hasMore: content.hasMore || ordered.length > limit,
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

    // ── 接管面④：槽位组件（选/加工作区 = 应用可用性承重件）───────────
    //
    // ⚠ 教训（2026-09-08 实机）：本段曾按「W1 空壳」实现（Picker 直接 return null），
    // 结果整个应用被锁死——无工作区 ⇒ 无 current session ⇒ 官方 ui-conversation 判
    // `inert` 把输入框 disabled（占位「选择一个工作区开始」），「新会话」也只能空转。
    // 官方语义里 `conversation.hero.workspace` 的 picker 是选/加工作区的**唯一入口**
    // （「添加工作区只有一条路」），它不是可后置的视觉件，必须与服务接管同批落地。
    // ⇒ 修正 M6 施工纪律：**接管某官方件时，其承重交互路径不得留空**。

    /** 菜单内「添加工作区」的合成条目 id（与官方同值）。 */
    const ADD_WORKSPACE = '::add-workspace'

    const CSS_TEXT = `
.dsh-desktop-workspaces-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 2px;
}
.dsh-desktop-workspaces-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 6px 2px 2px;
}
.dsh-desktop-workspaces-section-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .02em;
  color: var(--dsw-alias-label-tertiary)!important;
}
.dsh-desktop-workspaces-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.dsh-desktop-workspaces-add,
.dsh-desktop-workspaces-view-options {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary)!important;
  cursor: pointer;
}
.dsh-desktop-workspaces-add:hover,
.dsh-desktop-workspaces-view-options:hover {
  background: var(--dsw-alias-interactive-bg-hover)!important;
}
.dsh-desktop-workspaces-placeholder {
  padding: 8px 2px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary)!important;
}
.dsh-desktop-workspaces-flow-status {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary)!important;
}
/* ── W3 行组件样式（逐字对齐官方 Rows 模块，类名换 dsh-desktop-workspaces-* 前缀）── */
.dsh-desktop-workspaces-project-row,
.dsh-desktop-workspaces-session-row {
  cursor: pointer;
  user-select: none;
  color: var(--dsw-alias-label-primary)!important;
  border-radius: 8px;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  display: flex;
}
.dsh-desktop-workspaces-project-row:hover,
.dsh-desktop-workspaces-session-row:hover,
.dsh-desktop-workspaces-session-row.dsh-desktop-workspaces-selected {
  background: var(--dsw-alias-interactive-bg-hover)!important;
}
.dsh-desktop-workspaces-project-row {
  box-sizing: border-box;
  height: 34px;
}
.dsh-desktop-workspaces-project-row .dsh-desktop-workspaces-row-actions {
  height: 20px;
}
.dsh-desktop-workspaces-session-row {
  height: 32px;
  animation: dsh-desktop-workspaces-row-in .15s var(--ds-ease-in-out);
  gap: 0;
}
.dsh-desktop-workspaces-session-row .dsh-desktop-workspaces-title {
  margin: 0 6px 0 4px;
}
.dsh-desktop-workspaces-flat-no-status .dsh-desktop-workspaces-title {
  margin-left: 0;
}
@keyframes dsh-desktop-workspaces-row-in {
  0% { opacity: 0; }
}
.dsh-desktop-workspaces-slot {
  width: 16px;
  height: 20px;
  color: var(--dsw-alias-label-tertiary)!important;
  flex: none;
  justify-content: center;
  align-items: center;
  display: inline-flex;
}
.dsh-desktop-workspaces-visually-hidden {
  clip: rect(0 0 0 0);
  white-space: nowrap;
  width: 1px;
  height: 1px;
  position: absolute;
  overflow: hidden;
}
.dsh-desktop-workspaces-folder-active {
  color: var(--dsw-alias-state-business-primary)!important;
}
.dsh-desktop-workspaces-project-row .dsh-desktop-workspaces-chevron {
  display: none;
}
.dsh-desktop-workspaces-project-row:hover .dsh-desktop-workspaces-chevron {
  display: inline-flex;
}
.dsh-desktop-workspaces-project-row:hover .dsh-desktop-workspaces-folder {
  display: none;
}
.dsh-desktop-workspaces-arrow {
  transition: transform .15s var(--ds-ease-in-out);
}
.dsh-desktop-workspaces-arrow-open {
  transform: rotate(90deg);
}
.dsh-desktop-workspaces-project-text {
  flex-direction: column;
  flex: 1;
  gap: 2px;
  min-width: 0;
  display: flex;
}
.dsh-desktop-workspaces-title {
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  font-size: 14px;
  line-height: 20px;
  overflow: hidden;
}
.dsh-desktop-workspaces-session-row .dsh-desktop-workspaces-title {
  flex: 1;
}
.dsh-desktop-workspaces-time {
  color: var(--dsw-alias-label-tertiary)!important;
  flex: none;
  font-size: 12px;
  line-height: 20px;
}
.dsh-desktop-workspaces-schedule-indicator {
  width: 16px;
  height: 20px;
  color: var(--dsw-alias-label-tertiary)!important;
  flex: none;
  justify-content: center;
  align-items: center;
  margin-right: 6px;
  display: inline-flex;
}
.dsh-desktop-workspaces-schedule-search {
  margin-left: 4px;
  margin-right: 0;
}
.dsh-desktop-workspaces-row-actions {
  flex: none;
  align-items: center;
  gap: 12px;
  display: none;
}
.dsh-desktop-workspaces-project-row:hover .dsh-desktop-workspaces-row-actions,
.dsh-desktop-workspaces-session-row:hover .dsh-desktop-workspaces-row-actions,
.dsh-desktop-workspaces-project-row.dsh-desktop-workspaces-menu-open .dsh-desktop-workspaces-row-actions,
.dsh-desktop-workspaces-session-row.dsh-desktop-workspaces-menu-open .dsh-desktop-workspaces-row-actions {
  display: inline-flex;
}
.dsh-desktop-workspaces-session-row:hover .dsh-desktop-workspaces-time,
.dsh-desktop-workspaces-session-row.dsh-desktop-workspaces-menu-open .dsh-desktop-workspaces-time {
  display: none;
}
.dsh-desktop-workspaces-project-row.dsh-desktop-workspaces-menu-open,
.dsh-desktop-workspaces-session-row.dsh-desktop-workspaces-menu-open {
  background: var(--dsw-alias-interactive-bg-hover)!important;
}
.dsh-desktop-workspaces-session-row.dsh-desktop-workspaces-drop-before,
.dsh-desktop-workspaces-session-row.dsh-desktop-workspaces-drop-after {
  position: relative;
}
.dsh-desktop-workspaces-session-row.dsh-desktop-workspaces-drop-before::before,
.dsh-desktop-workspaces-session-row.dsh-desktop-workspaces-drop-after::after {
  content: "";
  z-index: 1;
  background:
    linear-gradient(55deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 0 / 5px 7px no-repeat,
    linear-gradient(125deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 5px / 5px 7px no-repeat,
    linear-gradient(var(--dsw-alias-state-business-primary) 0 0) 4px 5px / calc(100% - 4px) 2px no-repeat;
  pointer-events: none;
  height: 12px;
  position: absolute;
  left: 0;
  right: 4px;
}
.dsh-desktop-workspaces-session-row.dsh-desktop-workspaces-drop-before::before {
  top: -7px;
}
.dsh-desktop-workspaces-session-row.dsh-desktop-workspaces-drop-after::after {
  bottom: -7px;
}
.dsh-desktop-workspaces-hover-content {
  flex-direction: column;
  gap: 8px;
  display: flex;
}
.dsh-desktop-workspaces-hover-title {
  color: #fff;
  overflow-wrap: break-word;
  font-size: 14px;
  line-height: 20px;
}
.dsh-desktop-workspaces-hover-path {
  color: #cfd3d6;
  word-break: break-all;
  font-size: 12px;
  line-height: 16px;
}
.dsh-desktop-workspaces-hover-time {
  color: #cfd3d6;
  font-size: 12px;
  line-height: 16px;
}
.dsh-desktop-workspaces-hover-status {
  color: #adb2b8;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 20px;
  display: flex;
}
.dsh-desktop-workspaces-icon-button {
  cursor: pointer;
  width: 16px;
  height: 16px;
  color: var(--dsw-alias-label-tertiary)!important;
  background: 0 0;
  border: none;
  border-radius: 4px;
  flex: none;
  justify-content: center;
  align-items: center;
  padding: 0;
  display: inline-flex;
}
.dsh-desktop-workspaces-icon-button:hover {
  color: var(--dsw-alias-label-primary)!important;
}
.dsh-desktop-workspaces-chevron {
  color: var(--dsw-alias-label-caption)!important;
}
/* ── W3 树容器 / 组折叠 / 溢出 / 工作区拖拽标记（对齐官方 WorkspaceBrowser 模块）── */
.dsh-desktop-workspaces-list-area {
  min-height: 0;
  margin-left: -4px;
  margin-right: calc(-1 * var(--dsh-session-list-edge-inset));
  flex-direction: column;
  flex: 1;
  padding-left: 4px;
  display: flex;
  overflow: visible;
}
.dsh-desktop-workspaces-tree-body {
  flex-direction: column;
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
}
.dsh-desktop-workspaces-fade {
  left: 0;
  right: var(--dsh-session-list-edge-inset);
  background: linear-gradient(to bottom, transparent, var(--dsw-specific-sidebar-fill));
  pointer-events: none;
  height: 24px;
  position: absolute;
  bottom: 0;
}
.dsh-desktop-workspaces-wide {
  animation: dsh-desktop-workspaces-wide-in .2s var(--ds-ease-in-out);
}
@keyframes dsh-desktop-workspaces-wide-in {
  0% { opacity: 0; }
}
.dsh-desktop-workspaces-list {
  min-height: 0;
  margin-left: -4px;
  margin-right: var(--dsh-session-list-scrollbar-offset);
  padding-left: 4px;
  padding-right: calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset));
  scrollbar-gutter: stable;
  flex: 1;
  padding-bottom: 16px;
  overflow-y: auto;
}
.dsh-desktop-workspaces-group-section > * + * {
  margin-top: 2px;
}
.dsh-desktop-workspaces-group-section {
  position: relative;
}
.dsh-desktop-workspaces-group-section + .dsh-desktop-workspaces-group-section {
  margin-top: 4px;
}
.dsh-desktop-workspaces-list-top-drop,
.dsh-desktop-workspaces-workspace-drop-before::before,
.dsh-desktop-workspaces-workspace-drop-after::after {
  content: "";
  z-index: 1;
  background:
    linear-gradient(55deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 0 / 5px 7px no-repeat,
    linear-gradient(125deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 5px / 5px 7px no-repeat,
    linear-gradient(var(--dsw-alias-state-business-primary) 0 0) 4px 5px / calc(100% - 4px) 2px no-repeat;
  pointer-events: none;
  height: 12px;
  position: absolute;
  left: 0;
  right: 0;
}
.dsh-desktop-workspaces-list-top-drop {
  top: -8px;
  left: 0;
  right: var(--dsh-session-list-edge-inset);
}
.dsh-desktop-workspaces-list-top-active > .dsh-desktop-workspaces-workspace-drop-before:first-child::before {
  display: none;
}
.dsh-desktop-workspaces-workspace-drop-before::before {
  top: -8px;
}
.dsh-desktop-workspaces-workspace-drop-after::after {
  bottom: -8px;
}
.dsh-desktop-workspaces-overflow {
  cursor: pointer;
  text-align: left;
  width: 100%;
  height: 28px;
  color: var(--dsw-alias-label-tertiary)!important;
  background: 0 0;
  border: none;
  border-radius: 8px;
  padding: 0 12px 0 28px;
  font-size: 12px;
}
.dsh-desktop-workspaces-overflow:hover {
  color: var(--dsw-alias-label-secondary)!important;
  background: 0 0;
}
.dsh-desktop-workspaces-empty {
  color: var(--dsw-alias-label-tertiary)!important;
  padding: 16px 12px;
  font-size: 13px;
}
.dsh-desktop-workspaces-rename-input {
  box-sizing: border-box;
  border: .5px solid var(--dsw-alias-border-l4);
  width: 100%;
  height: 44px;
  color: var(--dsw-alias-label-primary)!important;
  background: 0 0;
  border-radius: 22px;
  outline: none;
  padding: 7px 14px;
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
}
.dsh-desktop-workspaces-rename-input:disabled {
  color: var(--dsw-alias-label-dimmed)!important;
}
.dsh-desktop-workspaces-rename-error {
  color: var(--dsw-alias-state-error-primary)!important;
  margin-top: 8px;
  font-size: 12px;
  line-height: 18px;
}
.dsh-desktop-workspaces-delete-action:not(:disabled) {
  color: var(--dsw-alias-state-error-primary)!important;
}
.dsh-desktop-workspaces-delete-status {
  color: var(--dsw-alias-label-secondary)!important;
  font-size: 12px;
  line-height: 18px;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-desktop-workspaces-session-row,
  .dsh-desktop-workspaces-arrow,
  .dsh-desktop-workspaces-wide {
    transition: none;
    animation: none;
  }
}
`

    /**
     * 选取 / 收养工作区的共享内核（官方 `WorkspacePickFlow` 等价实现）。
     * Browser 与 Picker 只是参数分化的两个壳，语义全部收在本函数，避免两处漂移。
     *
     * 关键行为：① 有工作区 → 列工作区菜单 + 底部固定「添加工作区…」；
     * ② 无工作区且目录流可用 → 「添加」是唯一条目，`open` 即**直接抬系统目录选择器**
     * （不多一层菜单）；③ 收养成功交回 owner 定位会话，失败落 folderError 弹层可重试。
     */
    function WorkspacePickFlow({ t, open, anchorRef, useWorkspaces, createWorkspace, useDirectoryFlow, renderDirectoryFlow, onPick, onClose, addOnly = false, side = 'bottom', selectedId }) {
      const workspaceSnapshot = useWorkspaces((state) => state)
      const workspaces = workspaceSnapshot.items
      const getAnchorRect = useCallback(() => anchorRef?.current?.getBoundingClientRect() ?? null, [anchorRef])
      const [errorOpen, setErrorOpen] = useState(false)
      const [modalError, setModalError] = useState(null)
      const [flowOpen, setFlowOpen] = useState(false)
      const [pickingFolder, setPickingFolder] = useState(false)
      const flowBusy = flowOpen || pickingFolder
      /** 目录流是否有占洞者（native picker）——无则整个「添加」路径不可用。 */
      const flowAvailable = useDirectoryFlow((occupied) => occupied)
      // 占洞者中途消失时收回已抬起的流，避免卡在无人应答的空转态
      useEffect(() => {
        if (flowOpen && !flowAvailable) setFlowOpen(false)
      }, [flowOpen, flowAvailable])
      const addEntries = flowAvailable ? [{
        id: ADD_WORKSPACE,
        label: t('menu.addWorkspace'),
        icon: h(IconPlusOutline16, { size: 16 }),
        disabled: flowBusy,
      }] : []
      const pinAdd = !addOnly && workspaces.length > 0
      const items = pinAdd ? workspaces.map((workspace) => ({
        id: workspace.workspaceId,
        label: workspace.title,
        icon: h(IconFolderClose16, { size: 16 }),
        disabled: flowBusy,
      })) : addEntries
      const menuIsEmpty = items.length === 0
      const closeModal = () => {
        setErrorOpen(false)
        setModalError(null)
      }
      /** 收养所选目录：成功即交 owner 定位会话；失败落错误弹层（可「重新选择」）。 */
      const adoptDirectory = (path) => createWorkspace({ path }).then((workspace) => {
        setFlowOpen(false)
        onPick(workspace.workspaceId)
      }).catch((reason) => {
        setModalError(reason instanceof Error ? reason.message : String(reason))
        setFlowOpen(false)
        setErrorOpen(true)
      })
      const openDirectoryFlow = useCallback(() => {
        onClose()
        setErrorOpen(false)
        setModalError(null)
        setFlowOpen(true)
      }, [onClose])
      const listSettled = addOnly || workspaceSnapshot.phase === 'ready'
      const addIsTheOnlyEntry = !pinAdd && listSettled && addEntries.length === 1
      // 「添加」为唯一条目时跳过菜单层，直接抬目录流
      useEffect(() => {
        if (open && addIsTheOnlyEntry && !flowBusy) openDirectoryFlow()
      }, [open, addIsTheOnlyEntry, flowBusy, openDirectoryFlow])
      /** 目录流 owner 侧：收养期间置 busy，occupant 据此禁用其提交控件直到 Host 答复。 */
      const flowOwner = {
        open: flowOpen,
        busy: pickingFolder,
        onPicked: (path) => {
          setPickingFolder(true)
          adoptDirectory(path).finally(() => {
            setPickingFolder(false)
          })
        },
        onCancel: () => {
          setFlowOpen(false)
        },
        onError: (message) => {
          setFlowOpen(false)
          setModalError(message)
          setErrorOpen(true)
        },
      }
      const handleSelect = (id) => {
        if (id === ADD_WORKSPACE) {
          openDirectoryFlow()
          return
        }
        onPick(id)
      }
      const menuVisible = open && !addIsTheOnlyEntry && !menuIsEmpty
      return h(React.Fragment, null,
        h(Menu, {
          open: menuVisible,
          anchor: null,
          items,
          ...(pinAdd ? { footer: addEntries } : {}),
          selectedId,
          onSelect: handleSelect,
          onClose,
          side,
          portal: true,
          getAnchorRect,
        }),
        menuVisible && workspaceSnapshot.phase === 'pending'
          ? h('div', { className: 'dsh-desktop-workspaces-flow-status', role: 'status' }, t('picker.loading'))
          : null,
        renderDirectoryFlow(flowOwner),
        h(Modal, {
          open: errorOpen,
          onClose: closeModal,
          closeLabel: t('close'),
          title: t('folderError.title'),
          footer: h(React.Fragment, null,
            h(Button, { variant: 'outline', onClick: closeModal }, t('cancel')),
            h(Button, { variant: 'primary', disabled: !flowAvailable, onClick: openDirectoryFlow }, t('folderError.retry')),
          ),
        }, h('div', { role: 'alert' }, modalError)),
      )
    }

    /**
     * 侧栏工作区浏览区（W3 起承载完整会话树）。owner `{ wide, expandSidebar }` +
     * store/inject/locale 标准面 + 全局 session/workspace/permissions 钩子。
     *
     * 数据流：`useSessions`（会话清单）/`useWorkspaces`（工作区 + 归档集）/`useStore`（视图态）
     * → 账户效应（blank 提升 + 账户键清理）→ `SessionTree`（组模式）/`FlatList`（单列表）。
     * 视图选项（分组方式 + 排序方式）下拉仅 wide 模式展示；内容搜索富 UI 归 W4。
     */
    function WorkspaceBrowser({ wide, expandSidebar, t, renderSlot, useWorkspaces, useDirectoryFlow, useStore, useHostInfo, useSessions, useSessionPendingInteraction, startSession, createWorkspace, open, renameSession, forkSession, renameWorkspace, deleteWorkspace, insertWorkspaceBefore, insertSessionBefore, archiveSession, actions }) {
      const [addOpen, setAddOpen] = useState(false)
      const home = useHostInfo((info) => info.home)
      const workspaces = useWorkspaces((state) => state.items)
      const workspacePhase = useWorkspaces((state) => state.phase)
      const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds)
      const groupBy = useStore((s) => s.groupBy)
      const orderBy = useStore((s) => s.orderBy)
      const groupExpansion = useStore((s) => s.groupExpansion)
      const sessionOrderByAccount = useStore((s) => s.sessionOrderByAccount)
      const sessionUpdatedAtByAccount = useStore((s) => s.sessionUpdatedAtByAccount)
      // 当前若为暂定「新会话」行，把它顶到归属账户与单列表账户最前（blank 提升）。
      const currentBlankSessionId = useSessions((state) => {
        const current = state.current
        return current !== undefined && state.byId[current]?.blank === true ? current : undefined
      })
      const currentBlankAccount = currentBlankSessionId === undefined ? undefined : (workspaces.find((workspace) => workspace.sessionIds.includes(currentBlankSessionId))?.workspaceId ?? '')
      const promotedBlank = useRef(undefined)
      useEffect(() => {
        if (currentBlankSessionId === undefined || currentBlankAccount === undefined) {
          promotedBlank.current = undefined
          return
        }
        const promoted = promotedBlank.current
        if (promoted !== undefined && promoted.sessionId === currentBlankSessionId && promoted.accountKey === currentBlankAccount) return
        promotedBlank.current = { sessionId: currentBlankSessionId, accountKey: currentBlankAccount }
        for (const accountKey of new Set([currentBlankAccount, FLAT_SESSION_ORDER_KEY])) {
          const previous = sessionOrderByAccount[accountKey] ?? []
          actions.setSessionOrder(accountKey, [currentBlankSessionId, ...previous.filter((id) => id !== currentBlankSessionId)])
        }
      }, [actions.setSessionOrder, currentBlankAccount, currentBlankSessionId, sessionOrderByAccount])
      // 工作区集就绪后清理孤儿账户键（组展开 / 会话排序 / 时间戳账户）。
      useEffect(() => {
        if (workspacePhase !== 'ready') return
        actions.retainAccountKeys(['', FLAT_SESSION_ORDER_KEY, ...workspaces.map((workspace) => workspace.workspaceId)])
      }, [actions.retainAccountKeys, workspacePhase, workspaces])

      // ── 工作区重命名 / 删除、会话重命名：Modal 状态机（对齐官方 WorkspaceBrowser）──
      const [renameTarget, setRenameTarget] = useState(null)
      const [renameDraft, setRenameDraft] = useState('')
      const [renaming, setRenaming] = useState(false)
      const [renameError, setRenameError] = useState(null)
      const renameTrimmed = renameDraft.trim()
      const renameDuplicate = renameTarget !== null && renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle && workspaces.some((w) => w.title === renameTrimmed)
      const renameBlocked = renaming || renameTrimmed === '' || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate
      const closeRename = () => {
        if (renaming) return
        setRenameTarget(null)
        setRenameError(null)
      }
      const confirmRename = () => {
        if (renameBlocked) return
        setRenaming(true)
        setRenameError(null)
        renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
          setRenaming(false)
          setRenameTarget(null)
        }).catch((reason) => {
          setRenaming(false)
          setRenameError(reason instanceof Error ? reason.message : String(reason))
        })
      }
      const [sessionRenameTarget, setSessionRenameTarget] = useState(null)
      const [sessionRenameDraft, setSessionRenameDraft] = useState('')
      const [sessionRenaming, setSessionRenaming] = useState(false)
      const [sessionRenameError, setSessionRenameError] = useState(null)
      const sessionRenameTrimmed = sessionRenameDraft.trim()
      const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === '' || sessionRenameTarget === null
      const closeSessionRename = () => {
        if (sessionRenaming) return
        setSessionRenameTarget(null)
        setSessionRenameError(null)
      }
      const confirmSessionRename = () => {
        if (sessionRenameBlocked) return
        setSessionRenaming(true)
        setSessionRenameError(null)
        renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
          setSessionRenaming(false)
          setSessionRenameTarget(null)
        }).catch((reason) => {
          setSessionRenaming(false)
          setSessionRenameError(reason instanceof Error ? reason.message : String(reason))
        })
      }
      const onSessionRename = (sessionId, currentTitle) => {
        setSessionRenameTarget({ sessionId, currentTitle })
        setSessionRenameDraft(currentTitle)
        setSessionRenameError(null)
      }
      const onSessionArchive = (sessionId) => {
        archiveSession(sessionId).catch((reason) => {
          console.warn('session archive rejected:', reason)
        })
      }
      const [deleteTarget, setDeleteTarget] = useState(null)
      const [deleting, setDeleting] = useState(false)
      const [deleteCommittedId, setDeleteCommittedId] = useState(null)
      const [deleteError, setDeleteError] = useState(null)
      useEffect(() => {
        if (deleteCommittedId === null || workspaces.some((workspace) => workspace.workspaceId === deleteCommittedId)) return
        setDeleting(false)
        setDeleteCommittedId(null)
        setDeleteTarget(null)
      }, [deleteCommittedId, workspaces])
      const closeDelete = () => {
        if (deleting) return
        setDeleteTarget(null)
        setDeleteError(null)
      }
      const confirmDelete = () => {
        if (deleting || deleteTarget === null) return
        setDeleting(true)
        setDeleteCommittedId(null)
        setDeleteError(null)
        deleteWorkspace(deleteTarget.workspaceId).then(() => {
          setDeleteCommittedId(deleteTarget.workspaceId)
        }).catch((reason) => {
          setDeleting(false)
          setDeleteError(reason instanceof Error ? reason.message : String(reason))
        })
      }

      return h('div', {
        className: 'dsh-desktop-workspaces-section',
        'data-dsh-desktop-workspaces': 'browser',
        'data-wide': wide ? '1' : '0',
      },
        h('div', { className: 'dsh-desktop-workspaces-header' },
          h('span', { className: 'dsh-desktop-workspaces-section-title' }, groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')),
          h('div', { className: 'dsh-desktop-workspaces-header-actions' },
            wide && h(ViewOptionsMenu, {
              groupBy,
              orderBy,
              onGroupPick: actions.setGroupBy,
              onOrderPick: actions.setOrderBy,
              t,
            }),
            h('button', {
              type: 'button',
              className: 'dsh-desktop-workspaces-add',
              title: t('workspace.add'),
              'aria-label': t('workspace.add'),
              onClick: () => {
                if (!wide) expandSidebar()
                setAddOpen(true)
              },
            }, h(IconPlusOutline16, { size: 14 })),
          ),
        ),
        h('div', { className: 'dsh-desktop-workspaces-list-area' },
          groupBy === 'flat'
            ? h(FlatList, {
                useSessions,
                useSessionPendingInteraction,
                open,
                forkSession,
                onSessionRename,
                onSessionArchive,
                archivedSessionIds,
                orderBy,
                sessionOrderByAccount,
                sessionUpdatedAtByAccount,
                syncSessionOrderAccount: actions.syncSessionOrderAccount,
                setSessionOrder: actions.setSessionOrder,
                t,
              })
            : h(SessionTree, {
                useSessions,
                useSessionPendingInteraction,
                workspaces,
                archivedSessionIds,
                open,
                startSession,
                forkSession,
                onSessionRename,
                onSessionArchive,
                onWorkspaceRename: (workspaceId, currentTitle) => {
                  setRenameTarget({ workspaceId, currentTitle })
                  setRenameDraft(currentTitle)
                  setRenameError(null)
                },
                onWorkspaceDelete: (workspaceId, title) => {
                  setDeleteTarget({ workspaceId, title })
                  setDeleteError(null)
                },
                insertWorkspaceBefore,
                insertSessionBefore,
                orderBy,
                groupExpansion,
                setGroupExpanded: actions.setGroupExpanded,
                sessionOrderByAccount,
                sessionUpdatedAtByAccount,
                syncSessionOrderAccount: actions.syncSessionOrderAccount,
                setSessionOrder: actions.setSessionOrder,
                home,
                t,
              }),
        ),
        h(WorkspacePickFlow, {
          t,
          open: addOpen,
          useWorkspaces,
          createWorkspace,
          useDirectoryFlow,
          renderDirectoryFlow: (owner) => renderSlot('sidebar.workspaces.directoryFlow', owner),
          addOnly: true,
          side: 'right',
          onPick: (workspaceId) => {
            setAddOpen(false)
            startSession(workspaceId)
          },
          onClose: () => {
            setAddOpen(false)
          },
        }),
        // 工作区重命名
        h(Modal, {
          open: renameTarget !== null,
          onClose: closeRename,
          closeLabel: t('close'),
          title: t('rename.workspace.title'),
          footer: h(React.Fragment, null,
            h(Button, { variant: 'outline', disabled: renaming, onClick: closeRename }, t('cancel')),
            h(Button, { variant: 'primary', disabled: renameBlocked, onClick: confirmRename }, t('rename')),
          ),
          children: h('input', {
            className: 'dsh-desktop-workspaces-rename-input',
            value: renameDraft,
            'aria-label': t('field.workspaceName'),
            autoFocus: true,
            disabled: renaming,
            onInput: (e) => { setRenameDraft(e.currentTarget.value) },
            onKeyDown: (e) => { if (e.key === 'Enter') confirmRename() },
          }),
        }),
        renameError !== null && renameTarget !== null && h('div', { className: 'dsh-desktop-workspaces-rename-error', role: 'alert' }, renameError),
        // 会话重命名
        h(Modal, {
          open: sessionRenameTarget !== null,
          onClose: closeSessionRename,
          closeLabel: t('close'),
          title: t('rename.session.title'),
          footer: h(React.Fragment, null,
            h(Button, { variant: 'outline', disabled: sessionRenaming, onClick: closeSessionRename }, t('cancel')),
            h(Button, { variant: 'primary', disabled: sessionRenameBlocked, onClick: confirmSessionRename }, t('rename')),
          ),
          children: h('input', {
            className: 'dsh-desktop-workspaces-rename-input',
            value: sessionRenameDraft,
            'aria-label': t('field.sessionName'),
            autoFocus: true,
            disabled: sessionRenaming,
            onInput: (e) => { setSessionRenameDraft(e.currentTarget.value) },
            onKeyDown: (e) => { if (e.key === 'Enter') confirmSessionRename() },
          }),
        }),
        sessionRenameError !== null && h('div', { className: 'dsh-desktop-workspaces-rename-error', role: 'alert' }, sessionRenameError),
        // 工作区删除确认
        h(Modal, {
          open: deleteTarget !== null,
          onClose: closeDelete,
          closeLabel: t('close'),
          title: t('delete.workspace'),
          footer: h(React.Fragment, null,
            h(Button, { variant: 'outline', disabled: deleting, onClick: closeDelete }, t('cancel')),
            deleting
              ? h('div', { className: 'dsh-desktop-workspaces-delete-status' }, t('delete.pending'))
              : h(Button, { className: 'dsh-desktop-workspaces-delete-action', variant: 'danger', onClick: confirmDelete }, t('delete')),
          ),
          children: deleteTarget !== null && h('div', { className: 'dsh-desktop-workspaces-delete-status' },
            t('delete.desc', { name: deleteTarget.title }),
            deleteError !== null && h('div', { className: 'dsh-desktop-workspaces-rename-error', role: 'alert' }, deleteError),
          ),
        }),
      )
    }

    /**
     * 对话区空态工作区选择器（**承重件**）。owner props 由官方 ui-conversation 下发：
     * `{ open, anchorRef, selectedId, onPick, onClose }`；选/加工作区只有这一条路。
     */
    function WorkspacePicker({ open, anchorRef, selectedId, onPick, onClose, t, renderSlot, useWorkspaces, useDirectoryFlow, createWorkspace }) {
      return h(WorkspacePickFlow, {
        t,
        open,
        anchorRef,
        useWorkspaces,
        createWorkspace,
        useDirectoryFlow,
        renderDirectoryFlow: (owner) => renderSlot('conversation.hero.workspace.directoryFlow', owner),
        selectedId,
        onPick,
        onClose,
      })
    }

    // ── W3 · 行组件层（逐字对齐官方 ui-workspace 的 rows 渲染族）────────────────
    //
    // 本段把 W2 派生层产出的行投影渲染成可交互的会话浏览树：组行（ProjectRowItem）+
    // 会话行（SessionNodeItem）+ 状态点（pendingInteraction琥珀 > running蓝 > completed绿）+
    // Manual 插序拖拽（会话经 insertSessionBefore、工作区经 insertWorkspaceBefore 写 Host，
    // 跨重启持久）。样式一律带 `dsh-desktop-workspaces-` 前缀 + !important（坑 19/26/27）。
    const useRef = React.useRef
    const useMemo = React.useMemo

    /** 单列表模式的排序账户键（官方同名常量）。 */
    const FLAT_SESSION_ORDER_KEY = '__flat_session_order__'
    /** 折叠组默认保留的普通会话行数（不含暂定「新会话」行）。 */
    const COLLAPSED_SESSION_LIMIT = 5

    /** Windows 盘符路径判定（内联自官方 `dsh-util-workspace-path`，供 home 缩略用）。 */
    function isWindowsStylePath(p) {
      return /^[a-zA-Z]:[\\/]/.test(p)
    }

    /** 把 $HOME 路径缩写成 POSIX `~`；遇 Windows 或跨风格路径原样返回。 */
    function abbreviateHomePath(path, home) {
      if (home === undefined || home === '') return path
      if (isWindowsStylePath(path) || isWindowsStylePath(home)) return path
      const root = home.replace(/\/+$/, '')
      if (root === '' || root === '/') return path
      if (path.replace(/\/+$/, '') === root) return '~'
      if (path.startsWith(`${root}/`)) return `~${path.slice(root.length)}`
      return path
    }

    /** 行标题：空白会话显示本地化的「新会话」标签。 */
    function displayTitle(node, t) {
      return node.blank ? t('session.new') : node.title
    }

    /** 紧凑相对时间（zh「刚刚/5分钟」· en「now/5min」）。 */
    function timeLabel(updatedAt, now, t) {
      const { unit, n } = relativeTime(updatedAt, now)
      return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
    }

    /** Hover 卡变体：距离套 ago 模板；now 桶保持裸（避免「刚才前」）。 */
    function hoverTimeLabel(updatedAt, now, t) {
      const { unit, n } = relativeTime(updatedAt, now)
      return unit === 'now' ? t('time.now') : t('time.ago', { t: t(`time.${unit}`, { n }) })
    }

    /** 绝对创建时间走字典日期模板（跟随应用 locale，而非浏览器语言）。 */
    function createdLabel(createdAt, t) {
      const d = new Date(createdAt)
      const pad2 = (v) => String(v).padStart(2, '0')
      return t('hover.created', { time: `${t('date.ymd', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` })
    }

    /** 指针落在行的上半区 = 插入其上方。 */
    function rowHalf(e) {
      const rect = e.currentTarget.getBoundingClientRect()
      return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    }

    /** 工作区组整行的插入侧判定。 */
    function workspaceGroupHalf(e) {
      const rect = e.currentTarget.getBoundingClientRect()
      return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    }

    /** 不可变成员切换（用于本地“展开全部”数组）。 */
    function toggled(list, key) {
      return list.includes(key) ? list.filter((k) => k !== key) : [...list, key]
    }

    /** 折叠一个工作区：普通会话留前 N 行，暂定的「新会话」行不计入限额。 */
    function collapsedSessionRows(sessions) {
      let ordinaryCount = 0
      const rows = sessions.filter((session) => {
        if (session.blank) return true
        if (ordinaryCount >= COLLAPSED_SESSION_LIMIT) return false
        ordinaryCount += 1
        return true
      })
      return { rows, hiddenCount: sessions.length - rows.length }
    }

    /** 行拖拽进行时在 document 级接受原生拖拽：行 hover 仍握插入标记。 */
    function useNativeDragAcceptance(active) {
      useEffect(() => {
        if (!active) return
        const acceptDrag = (event) => {
          event.preventDefault()
          if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
        }
        const acceptDrop = (event) => {
          event.preventDefault()
        }
        document.addEventListener('dragover', acceptDrag)
        document.addEventListener('drop', acceptDrop)
        return () => {
          document.removeEventListener('dragover', acceptDrag)
          document.removeEventListener('drop', acceptDrop)
        }
      }, [active])
    }

    /** 把已存储的视图顺序与工作区当前会话账对齐（消去已删除/归档的 id）。 */
    function reconciledSessionOrder(sessionIds, stored) {
      if (stored === undefined) return [...sessionIds]
      const byId = new Map(sessionIds.map((id) => [id, id]))
      const ordered = []
      const included = new Set()
      for (const key of stored) {
        const id = byId.get(key)
        if (id === undefined || included.has(key)) continue
        ordered.push(id)
        included.add(key)
      }
      for (const id of sessionIds) {
        if (included.has(id)) continue
        ordered.push(id)
      }
      return ordered
    }

    /** 新在前 + 稳定 id 平局断。 */
    function compareSessionRecency(a, b, byId) {
      const aUpdatedAt = byId[a]?.updatedAt ?? Number.NEGATIVE_INFINITY
      const bUpdatedAt = byId[b]?.updatedAt ?? Number.NEGATIVE_INFINITY
      if (aUpdatedAt !== bUpdatedAt) return bUpdatedAt - aUpdatedAt
      return a < b ? -1 : 1
    }

    /** 对齐一个可编辑排序账户，并执行 its 活动提升策略。 */
    function nextSessionOrderAccount({ sessionIds, previousOrder, previousUpdatedAt, list, orderBy, sortByRecency }) {
      let order = reconciledSessionOrder(sessionIds, previousOrder)
      if (sortByRecency) order.sort((a, b) => compareSessionRecency(a, b, list.byId))
      else if (orderBy === 'updated') {
        const promoted = sessionIds.filter((id) => {
          const session = list.byId[id]
          return session !== undefined && (previousUpdatedAt[id] === undefined || session.updatedAt > previousUpdatedAt[id])
        }).sort((a, b) => compareSessionRecency(a, b, list.byId))
        if (promoted.length > 0) {
          const promotedIds = new Set(promoted)
          order = [...promoted, ...order.filter((id) => !promotedIds.has(id))]
        }
      }
      const updatedAt = {}
      for (const id of sessionIds) {
        const session = list.byId[id]
        if (session !== undefined) updatedAt[id] = session.updatedAt
      }
      const orderChanged = previousOrder === undefined || order.length !== previousOrder.length || order.some((id, index) => id !== previousOrder[index])
      const timestampsChanged = Object.keys(updatedAt).length !== Object.keys(previousUpdatedAt).length || Object.entries(updatedAt).some(([id, timestamp]) => previousUpdatedAt[id] !== timestamp)
      return { order, updatedAt, changed: orderChanged || timestampsChanged }
    }

    // ── W3 行组件：状态点 / 提示 / 组行 / 会话行 ──────────────────────────

    /** 未知 pending 交互兜底（仅自定义状态被伪造时触发）。 */
    function assertPendingNever(value) {
      throw new Error(`unknown pending interaction: ${String(value)}`)
    }

    /**
     * 会话状态展示集合：pending 交互为最高优先级，其次运行中，其次运行子代理，
     * 其次完成提醒，最后空闲。
     */
    function sessionStatuses(node, t) {
      const subagents = node.runningSubagentCount === 0 ? undefined : {
        state: 'ongoing',
        label: t(node.runningSubagentCount === 1 ? 'status.subagentsRunning.one' : 'status.subagentsRunning.other', { n: node.runningSubagentCount }),
      }
      let pending
      switch (node.pendingInteraction) {
        case 'approval': pending = { state: 'warning', label: t('status.waitingApproval') }; break
        case 'plan-review': pending = { state: 'warning', label: t('status.planReview') }; break
        case 'question': pending = { state: 'warning', label: t('status.waitingAnswer') }; break
        case undefined: break
        default: return assertPendingNever(node.pendingInteraction)
      }
      if (pending !== undefined) return subagents === undefined ? [pending] : [pending, subagents]
      if (node.running) {
        const primary = { state: 'ongoing', label: t('status.running') }
        return subagents === undefined ? [primary] : [primary, subagents]
      }
      if (subagents !== undefined) return [subagents]
      if (node.completed) return [{ state: 'done', label: t('status.completed') }]
      return [{ state: 'done', label: t('status.idle') }]
    }

    /** 主状态点 + 每个状态的无障碍文本，行与搜索结果共用。 */
    function SessionStatusDots({ statuses }) {
      return h(React.Fragment, null,
        h(StateDot, { state: statuses[0].state }),
        statuses.map((status) => h('span', { className: 'dsh-desktop-workspaces-visually-hidden', key: status.label }, status.label)),
      )
    }

    /** 非交互的活动定时任务标记；外层行仍是唯一动作点。 */
    function ActiveScheduleIndicator({ t, search = false }) {
      const label = t('schedule.active')
      return h('span', {
        className: search
          ? 'dsh-desktop-workspaces-schedule-indicator dsh-desktop-workspaces-schedule-search'
          : 'dsh-desktop-workspaces-schedule-indicator',
        role: 'img', 'aria-label': label, title: label,
      }, h(IconAlarmClockOutline16, {}))
    }

    /** 工作区 Hover 卡：标题 + 缩略路径 + 绝对创建时间。 */
    function WorkspaceHoverContent({ label, cwd, createdAt, t }) {
      return h('div', { className: 'dsh-desktop-workspaces-hover-content' },
        h('div', { className: 'dsh-desktop-workspaces-hover-title' }, label),
        h('div', { className: 'dsh-desktop-workspaces-hover-path' }, cwd),
        h('div', { className: 'dsh-desktop-workspaces-hover-time' }, createdLabel(createdAt, t)),
      )
    }

    /** 会话 Hover 卡：全标题 + 相对时间 + 全部相关状态。 */
    function SessionHoverContent({ node, now, t }) {
      const statuses = sessionStatuses(node, t)
      return h('div', { className: 'dsh-desktop-workspaces-hover-content' },
        h('div', { className: 'dsh-desktop-workspaces-hover-title' }, displayTitle(node, t)),
        !node.blank && h('div', { className: 'dsh-desktop-workspaces-hover-time' }, hoverTimeLabel(node.updatedAt, now, t)),
        statuses.map((status) => h('div', { className: 'dsh-desktop-workspaces-hover-status', key: status.label },
          h(StateDot, { state: status.state }), h('span', null, status.label))),
      )
    }

    /**
     * 工作区组行：文件夹图标 + chevron + 标题；悬停浮现折叠三角与「新建会话」，
     * 真实工作区另附操作菜单（重命名/删除）与整行拖拽。
     */
    function ProjectRowItem({ group, onToggle, onCreate, actions, drag, home, t }) {
      const row = group
      const label = row.workspaceId === undefined ? t('group.ungrouped') : row.label
      const active = group.expanded && group.containsCurrent
      const [menuOpen, setMenuOpen] = useState(false)
      const workspaceMenuItems = [
        { id: 'rename', label: t('rename'), icon: h(IconEditOutline16, {}) },
        { id: 'delete', label: t('delete.workspace'), icon: h(IconTrashOutline16, {}), danger: true },
      ]
      const ownRow = h('div', {
        className: `dsh-desktop-workspaces-project-row${menuOpen ? ' dsh-desktop-workspaces-menu-open' : ''}`,
        role: 'treeitem', 'aria-expanded': row.expanded,
        onClick: onToggle,
        draggable: drag !== undefined,
        onDragStart: drag === undefined ? undefined : (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', row.key)
          drag.start()
        },
        onDragEnd: drag?.end,
      },
        h('span', { className: `dsh-desktop-workspaces-slot dsh-desktop-workspaces-folder${active ? ' dsh-desktop-workspaces-folder-active' : ''}` },
          row.expanded ? h(IconFolderOpen16, {}) : h(IconFolderClose16, {})),
        h('span', { className: 'dsh-desktop-workspaces-slot dsh-desktop-workspaces-chevron' },
          h(IconTriangleRightFill14, { className: `dsh-desktop-workspaces-arrow${row.expanded ? ' dsh-desktop-workspaces-arrow-open' : ''}` })),
        h('span', { className: 'dsh-desktop-workspaces-project-text' },
          h('span', { className: 'dsh-desktop-workspaces-title' }, label)),
        h('span', { className: 'dsh-desktop-workspaces-row-actions' },
          actions !== undefined && h(Menu, {
            open: menuOpen,
            onClose: () => { setMenuOpen(false) },
            items: workspaceMenuItems,
            onSelect: (id) => {
              setMenuOpen(false)
              if (id !== 'rename' && id !== 'delete') return
              if (id === 'rename') actions.rename()
              else actions.delete()
            },
            portal: true,
            closeOnPointerLeave: true,
            anchor: h('button', {
              type: 'button',
              className: 'dsh-desktop-workspaces-icon-button',
              'aria-label': t('actions.workspace.aria', { name: label }),
              onClick: (e) => { e.stopPropagation(); setMenuOpen((v) => !v) },
            }, h(IconEllipsisOutline16, {})),
          }),
          h('button', {
            type: 'button',
            className: 'dsh-desktop-workspaces-icon-button',
            'aria-label': t('actions.newSession.aria', { name: label }),
            onClick: (e) => { e.stopPropagation(); onCreate() },
          }, h(IconPlusOutline16, {})),
        ),
      )
      if (row.createdAt === undefined) return ownRow
      return h(HoverCard, {
        anchor: ownRow,
        content: h(WorkspaceHoverContent, {
          label: row.label,
          cwd: row.cwd === undefined ? undefined : abbreviateHomePath(row.cwd, home),
          createdAt: row.createdAt,
          t,
        }),
        disabled: menuOpen,
        copyText: row.cwd,
        copyLabel: t('copy'),
        copiedLabel: t('hover.copied'),
      })
    }

    /**
     * 会话行：状态点（pending 优选）+ 标题 + 相对时间 + 行操作菜单（重命名/分叉/归档）。
     * `flat` 模式省略无状态行的空状态点槽位。
     */
    function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, drag, flat = false, t }) {
      const row = node
      const title = displayTitle(node, t)
      const selected = node.id === currentId
      const statuses = sessionStatuses(node, t)
      const showStatus = statuses[0].state !== 'done' || row.completed
      const [menuOpen, setMenuOpen] = useState(false)
      const sessionMenuItems = [
        { id: 'rename', label: t('rename'), icon: h(IconEditOutline16, {}) },
        { id: 'fork', label: t('menu.fork'), icon: h(IconBranchOutline16, {}) },
        { id: 'archive', label: t('menu.archiveSession'), icon: h(IconArchiveOutline20, { size: 16 }) },
      ]
      return h(HoverCard, {
        anchor: h('div', {
          className: `dsh-desktop-workspaces-session-row${selected ? ' dsh-desktop-workspaces-selected' : ''}${menuOpen ? ' dsh-desktop-workspaces-menu-open' : ''}${flat && !showStatus ? ' dsh-desktop-workspaces-flat-no-status' : ''}${drag?.marker === 'before' ? ' dsh-desktop-workspaces-drop-before' : ''}${drag?.marker === 'after' ? ' dsh-desktop-workspaces-drop-after' : ''}`,
          role: 'treeitem', 'aria-selected': selected,
          onClick: () => { onOpen(node.id) },
          draggable: drag !== undefined,
          onDragStart: drag === undefined ? undefined : (e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', node.id)
            drag.start()
          },
          onDragEnd: drag?.end,
          onDragOver: drag === undefined ? undefined : (e) => {
            if (!drag.active) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            drag.hover(rowHalf(e))
          },
          onDrop: drag === undefined ? undefined : (e) => {
            if (!drag.active) return
            e.preventDefault()
            drag.drop(rowHalf(e))
          },
        },
          (!flat || showStatus) && h('span', { className: 'dsh-desktop-workspaces-slot' },
            showStatus && h(SessionStatusDots, { statuses })),
          h('span', { className: 'dsh-desktop-workspaces-title' }, title),
          row.hasActiveSchedule && h(ActiveScheduleIndicator, { t }),
          !row.blank && h('span', { className: 'dsh-desktop-workspaces-time' }, timeLabel(row.updatedAt, now, t)),
          !row.blank && h('span', { className: 'dsh-desktop-workspaces-row-actions' },
            h(Menu, {
              open: menuOpen,
              onClose: () => { setMenuOpen(false) },
              items: sessionMenuItems,
              onSelect: (id) => {
                setMenuOpen(false)
                if (id === 'rename') onRename(node.id, row.title)
                if (id === 'fork') onFork(node.id)
                if (id === 'archive') onArchive(node.id)
              },
              portal: true,
              closeOnPointerLeave: true,
              anchor: h('button', {
                type: 'button',
                className: 'dsh-desktop-workspaces-icon-button',
                'aria-label': t('actions.session.aria', { name: title }),
                onClick: (e) => { e.stopPropagation(); setMenuOpen((v) => !v) },
              }, h(IconEllipsisOutline16, {})),
            }),
          ),
        ),
        content: h(SessionHoverContent, { node, now, t }),
        disabled: menuOpen || drag?.active === true,
        copyText: row.blank ? undefined : row.title,
        copyLabel: t('copy'),
        copiedLabel: t('hover.copied'),
      })
    }

    /**
     * 视图选项下拉：分组方式（按工作区 / 单列表）与排序方式（手动 / 最近更新）。
     * 仅 wide 模式展示；own open 态随宽窄切换复位（对齐官方 ViewOptionsMenu）。
     */
    function ViewOptionsMenu({ groupBy, orderBy, onGroupPick, onOrderPick, t }) {
      const [open, setOpen] = useState(false)
      return h(Menu, {
        open,
        onClose: () => { setOpen(false) },
        items: [
          { type: 'label', id: 'group-by', text: t('groupBy.label') },
          { id: 'workspace', label: t('groupBy.workspace') },
          { id: 'flat', label: t('groupBy.flat') },
          { type: 'separator', id: 'order-by-separator' },
          { type: 'label', id: 'order-by', text: t('orderBy.label') },
          { id: 'manual', label: t('orderBy.manual') },
          { id: 'updated', label: t('orderBy.updated') },
        ],
        selectedIds: [groupBy, orderBy],
        onSelect: (id) => {
          if (id === 'workspace' || id === 'flat') onGroupPick(id)
          else if (id === 'manual' || id === 'updated') onOrderPick(id)
          setOpen(false)
        },
        align: 'end',
        dense: true,
        portal: true,
        anchor: h('button', {
          type: 'button',
          className: 'dsh-desktop-workspaces-view-options',
          'aria-label': t('viewOptions.label'),
          title: t('viewOptions.label'),
          onClick: () => { setOpen((v) => !v) },
        }, h(IconPersonalizationOutline16, {})),
      })
    }

    /** 单列表平铺会话树（groupBy=flat）：复用同一行组件，跨工作区按账户排序对齐。 */
    function FlatList({ useSessions, useSessionPendingInteraction, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t }) {
      const list = useSessions((s) => s)
      const pendingInteractions = useSessionPendingInteraction((s) => s)
      const baseRows = useMemo(() => deriveFlat(list, archivedSessionIds, pendingInteractions), [list, archivedSessionIds, pendingInteractions])
      const sessionIds = useMemo(() => baseRows.map((row) => row.id), [baseRows])
      const previousOrderBy = useRef(orderBy)
      useEffect(() => {
        if (list.phase !== 'ready') return
        const previousOrder = sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]
        const previousUpdatedAt = sessionUpdatedAtByAccount[FLAT_SESSION_ORDER_KEY] ?? {}
        const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
        previousOrderBy.current = orderBy
        const next = nextSessionOrderAccount({
          sessionIds,
          previousOrder,
          previousUpdatedAt,
          list,
          orderBy,
          sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
        })
        if (next.changed) syncSessionOrderAccount(FLAT_SESSION_ORDER_KEY, next.order.map((id) => id), next.updatedAt)
      }, [list, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, sessionIds, syncSessionOrderAccount])
      const rows = useMemo(() => {
        const byId = new Map(baseRows.map((row) => [row.id, row]))
        return reconciledSessionOrder(sessionIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]).flatMap((id) => {
          const row = byId.get(id)
          return row === undefined ? [] : [row]
        })
      }, [baseRows, sessionOrderByAccount, sessionIds])
      const [drag, setDrag] = useState(null)
      const dropCommitted = useRef(false)
      useNativeDragAcceptance(drag !== null)
      const commitDrag = (activeDrag, over) => {
        if (dropCommitted.current) return
        dropCommitted.current = true
        setDrag(null)
        const targetIndex = rows.findIndex((row) => row.id === over.id)
        if (targetIndex === -1) return
        const anchor = over.half === 'before' ? over.id : rows[targetIndex + 1]?.id
        if (anchor === activeDrag.sessionId) return
        const sourceIndex = rows.findIndex((row) => row.id === activeDrag.sessionId)
        const anchorIndex = anchor === undefined ? rows.length : rows.findIndex((row) => row.id === anchor)
        if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
        const nextOrder = rows.map((row) => row.id).filter((id) => id !== activeDrag.sessionId)
        const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
        nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
        setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder.map((id) => id))
      }
      const now = Date.now()
      return h('div', {
        className: 'dsh-desktop-workspaces-tree-body dsh-desktop-workspaces-wide',
      },
        h('div', {
          className: 'dsh-desktop-workspaces-list dsh-desktop-workspaces-flat-list',
          role: 'tree',
          'aria-label': t('section.sessions'),
        },
          rows.length === 0 && h('div', { className: 'dsh-desktop-workspaces-empty' }, t('empty.none')),
          rows.map((node) => {
            const active = drag !== null
            return h(SessionNodeItem, {
              key: node.id,
              node,
              currentId: list.current,
              now,
              onOpen: open,
              onRename: onSessionRename,
              onFork: forkSession,
              onArchive: onSessionArchive,
              flat: true,
              drag: {
                start: () => {
                  dropCommitted.current = false
                  setDrag({ accountKey: FLAT_SESSION_ORDER_KEY, sessionId: node.id, over: null })
                },
                active,
                marker: active && drag.over?.id === node.id ? drag.over.half : null,
                hover: (half) => {
                  setDrag((d) => d === null ? d : { ...d, over: { id: node.id, half } })
                },
                drop: (half) => {
                  if (drag !== null) commitDrag(drag, { id: node.id, half })
                },
                end: () => {
                  if (drag?.over !== null && drag?.over !== undefined) commitDrag(drag, drag.over)
                  else setDrag(null)
                  dropCommitted.current = false
                },
              },
              t,
            })
          }),
        ),
        h('span', { className: 'dsh-desktop-workspaces-fade' }),
      )
    }

    /**
     * 工作区分组会话树（W3 树渲染核心）。由派生层投影 + 行组件渲染，含：
     * 组展开/折叠、组内会话溢出折叠（前 5 行 + 「展开其余 N」）、排序账户对齐
     * （manual 保序 / updated 活动提升 / sortByRecency 全序）、会话行拖拽插序与
     * 工作区整行拖拽（均经 Host 持久写盘，跨重启保留）。逐字对齐官方 SessionTree。
     *
     * 数据经 props 注入（useSessions/useSessionPendingInteraction 钩子 + store 派生态
     * + browserInjected 动作），不持自建 store。
     */
    function SessionTree({ useSessions, useSessionPendingInteraction, startSession, open, forkSession, workspaces, archivedSessionIds, onWorkspaceRename, onWorkspaceDelete, onSessionRename, onSessionArchive, insertWorkspaceBefore, insertSessionBefore, orderBy, groupExpansion, setGroupExpanded, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, home, t }) {
      const list = useSessions((s) => s)
      const pendingInteractions = useSessionPendingInteraction((s) => s)
      const current = list.current
      const [expandedSessionGroups, setExpandedSessionGroups] = useState([])
      const [drag, setDrag] = useState(null)
      const sessionDropCommitted = useRef(false)
      const [workspaceDrag, setWorkspaceDrag] = useState(null)
      const workspaceDropCommitted = useRef(false)
      const previousOrderBy = useRef(orderBy)
      useNativeDragAcceptance(drag !== null || workspaceDrag !== null)
      const currentGroup = current === undefined ? undefined : (workspaces.find((w) => w.sessionIds.includes(current))?.workspaceId ?? '')
      // 当前会话所在组若未显式记录展开态，自动展开（保持当前项可见）。
      useEffect(() => {
        if (current === undefined || currentGroup === undefined || Object.hasOwn(groupExpansion, currentGroup)) return
        setGroupExpanded(currentGroup, true)
      }, [current, currentGroup, setGroupExpanded, groupExpansion])
      const expandedGroups = useMemo(() => Object.entries(groupExpansion).filter(([, expanded]) => expanded).map(([key]) => key), [groupExpansion])
      const ungroupedSessionIds = useMemo(() => {
        const accounted = new Set(workspaces.flatMap((workspace) => workspace.sessionIds))
        return list.ids.filter((id) => list.byId[id] !== undefined && !accounted.has(id))
      }, [list, workspaces])
      // 排序账户对齐：manual 保序，updated 活动提升，切到最近更新时全序重排。
      useEffect(() => {
        if (list.phase !== 'ready') return
        const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
        previousOrderBy.current = orderBy
        const accounts = [...workspaces.map((workspace) => ({
          key: workspace.workspaceId,
          sessionIds: workspace.sessionIds.filter((id) => list.byId[id] !== undefined),
        })), {
          key: '',
          sessionIds: ungroupedSessionIds,
        }]
        for (const { key, sessionIds } of accounts) {
          const previousOrder = sessionOrderByAccount[key]
          const next = nextSessionOrderAccount({
            sessionIds,
            previousOrder,
            previousUpdatedAt: sessionUpdatedAtByAccount[key] ?? {},
            list,
            orderBy,
            sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
          })
          if (next.changed) syncSessionOrderAccount(key, next.order.map((id) => id), next.updatedAt)
        }
      }, [
        list, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount,
        syncSessionOrderAccount, ungroupedSessionIds, workspaces,
      ])
      const orderedWorkspaces = useMemo(() => workspaces.map((workspace) => {
        const stored = sessionOrderByAccount[workspace.workspaceId]
        const sessionIds = reconciledSessionOrder(workspace.sessionIds, stored)
        return { ...workspace, sessionIds }
      }), [sessionOrderByAccount, workspaces])
      const orderedUngroupedSessionIds = useMemo(() => reconciledSessionOrder(ungroupedSessionIds, sessionOrderByAccount['']), [sessionOrderByAccount, ungroupedSessionIds])
      const groups = useMemo(() => deriveGroups(list, orderedWorkspaces, archivedSessionIds, pendingInteractions, {
        expandedGroups,
        ...sessionOrderByAccount[''] === undefined ? {} : { ungroupedOrder: sessionOrderByAccount[''] },
      }), [list, orderedWorkspaces, archivedSessionIds, pendingInteractions, expandedGroups, sessionOrderByAccount])
      const now = Date.now()
      const commitSessionDrag = (activeDrag, over) => {
        if (sessionDropCommitted.current) return
        sessionDropCommitted.current = true
        setDrag(null)
        const group = groups.find((candidate) => candidate.key === activeDrag.accountKey)
        if (group === undefined) return
        const sessionsExpanded = expandedSessionGroups.includes(group.key)
        const renderedSessions = sessionsExpanded ? group.sessions : collapsedSessionRows(group.sessions).rows
        const targetIndex = renderedSessions.findIndex((session) => session.id === over.id)
        if (targetIndex === -1) return
        const sourceIndex = renderedSessions.findIndex((session) => session.id === activeDrag.sessionId)
        if (over.id === activeDrag.sessionId) return
        const withoutSource = renderedSessions.filter((session) => session.id !== activeDrag.sessionId)
        const targetWithoutSourceIndex = withoutSource.findIndex((session) => session.id === over.id)
        if (targetWithoutSourceIndex === -1) return
        const visibleInsertAt = over.half === 'before' ? targetWithoutSourceIndex : targetWithoutSourceIndex + 1
        if (sourceIndex !== -1 && visibleInsertAt === sourceIndex) return
        const accountSessionIds = activeDrag.accountKey === '' ? orderedUngroupedSessionIds : orderedWorkspaces.find((workspace) => workspace.workspaceId === activeDrag.accountKey)?.sessionIds
        if (accountSessionIds === undefined) return
        const nextOrder = accountSessionIds.filter((id) => id !== activeDrag.sessionId)
        let anchor
        if (sessionsExpanded) anchor = over.half === 'before' ? over.id : renderedSessions[targetIndex + 1]?.id
        else {
          const previousVisible = withoutSource[visibleInsertAt - 1]?.id
          if (previousVisible === undefined) anchor = nextOrder[0]
          else {
            const previousIndex = nextOrder.indexOf(previousVisible)
            if (previousIndex === -1) return
            anchor = nextOrder[previousIndex + 1]
          }
        }
        const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
        nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
        if (!sessionsExpanded && sourceIndex !== -1) {
          const nodes = new Map(group.sessions.map((node) => [node.id, node]))
          if (!collapsedSessionRows(nextOrder.flatMap((id) => {
            const node = nodes.get(id)
            return node === undefined ? [] : [node]
          })).rows.some((node) => node.id === activeDrag.sessionId)) return
        }
        setSessionOrder(activeDrag.accountKey, nextOrder.map((id) => id))
        if (orderBy === 'updated' || activeDrag.accountKey === '') return
        insertSessionBefore(activeDrag.accountKey, activeDrag.sessionId, anchor).catch((reason) => {
          console.warn('session reorder rejected:', reason)
        })
      }
      const commitWorkspaceDrag = (activeDrag, over) => {
        if (workspaceDropCommitted.current) return
        workspaceDropCommitted.current = true
        setWorkspaceDrag(null)
        const rowIndex = workspaces.findIndex((workspace) => workspace.workspaceId === over.id)
        if (rowIndex === -1) return
        const anchor = over.half === 'before' ? over.id : workspaces[rowIndex + 1]?.workspaceId
        if (anchor === activeDrag.workspaceId) return
        const sourceIndex = workspaces.findIndex((workspace) => workspace.workspaceId === activeDrag.workspaceId)
        const anchorIndex = anchor === undefined ? workspaces.length : workspaces.findIndex((workspace) => workspace.workspaceId === anchor)
        if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
        insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason) => {
          console.warn('workspace reorder rejected:', reason)
        })
      }
      const workspaceDropAtListStart = groups[0]?.workspaceId !== undefined && workspaceDrag?.over?.id === groups[0].workspaceId && workspaceDrag.over.half === 'before'
      return h('div', {
        className: 'dsh-desktop-workspaces-tree-body dsh-desktop-workspaces-wide',
      },
        workspaceDropAtListStart && h('span', { className: 'dsh-desktop-workspaces-list-top-drop', 'aria-hidden': 'true' }),
        h('div', {
          className: `dsh-desktop-workspaces-list${workspaceDropAtListStart ? ' dsh-desktop-workspaces-list-top-active' : ''}`,
          role: 'tree',
          'aria-label': t('section.sessions'),
        },
          groups.length === 0 && h('div', { className: 'dsh-desktop-workspaces-empty' }, t('empty.none')),
          groups.map((group) => {
            const workspaceId = group.workspaceId
            const collapsed = collapsedSessionRows(group.sessions)
            const sessionsExpanded = expandedSessionGroups.includes(group.key)
            const workspaceMarker = workspaceId !== undefined && workspaceDrag?.over?.id === workspaceId ? workspaceDrag.over.half : null
            const workspaceDragProps = workspaceId === undefined ? undefined : {
              start: () => {
                workspaceDropCommitted.current = false
                setWorkspaceDrag({ workspaceId, over: null })
              },
              end: () => {
                if (workspaceDrag?.over !== null && workspaceDrag?.over !== undefined) commitWorkspaceDrag(workspaceDrag, workspaceDrag.over)
                else setWorkspaceDrag(null)
                workspaceDropCommitted.current = false
              },
            }
            const hoverWorkspace = workspaceId === undefined ? undefined : (half) => {
              setWorkspaceDrag((active) => active === null ? active : { ...active, over: { id: workspaceId, half } })
            }
            const dropWorkspace = workspaceId === undefined ? undefined : (half) => {
              if (workspaceDrag === null) return
              commitWorkspaceDrag(workspaceDrag, { id: workspaceId, half })
            }
            return h('div', {
              key: group.key,
              className: `dsh-desktop-workspaces-group-section${workspaceMarker === 'before' ? ' dsh-desktop-workspaces-workspace-drop-before' : ''}${workspaceMarker === 'after' ? ' dsh-desktop-workspaces-workspace-drop-after' : ''}`,
              onDragOver: workspaceDrag === null || hoverWorkspace === undefined ? undefined : (e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                hoverWorkspace(workspaceGroupHalf(e))
              },
              onDrop: workspaceDrag === null || dropWorkspace === undefined ? undefined : (e) => {
                e.preventDefault()
                dropWorkspace(workspaceGroupHalf(e))
              },
            },
              h(ProjectRowItem, {
                group,
                home,
                t,
                onToggle: () => {
                  if (group.expanded) setExpandedSessionGroups((keys) => keys.filter((key) => key !== group.key))
                  setGroupExpanded(group.key, !group.expanded)
                },
                onCreate: () => {
                  if (group.workspaceId !== undefined) {
                    setGroupExpanded(group.key, true)
                    startSession(group.workspaceId)
                  }
                },
                drag: workspaceDragProps,
                actions: group.workspaceId === undefined ? undefined : {
                  rename: () => {
                    if (group.workspaceId !== undefined) onWorkspaceRename(group.workspaceId, group.label)
                  },
                  delete: () => {
                    if (group.workspaceId !== undefined) onWorkspaceDelete(group.workspaceId, group.label)
                  },
                },
              }),
              (sessionsExpanded ? group.sessions : collapsed.rows).map((node) => {
                const sameGroupDrag = drag !== null && drag.accountKey === group.key
                return h(SessionNodeItem, {
                  key: node.id,
                  node,
                  currentId: current,
                  now,
                  onOpen: open,
                  onRename: onSessionRename,
                  onFork: forkSession,
                  onArchive: onSessionArchive,
                  drag: {
                    start: () => {
                      sessionDropCommitted.current = false
                      setDrag({ accountKey: group.key, sessionId: node.id, over: null })
                    },
                    active: sameGroupDrag,
                    marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
                    hover: (half) => {
                      setDrag((d) => d === null ? d : { ...d, over: { id: node.id, half } })
                    },
                    drop: (half) => {
                      if (drag === null) return
                      commitSessionDrag(drag, { id: node.id, half })
                    },
                    end: () => {
                      if (drag?.over !== null && drag?.over !== undefined) commitSessionDrag(drag, drag.over)
                      else setDrag(null)
                      sessionDropCommitted.current = false
                    },
                  },
                  t,
                })
              }),
              collapsed.hiddenCount > 0 && h('button', {
                type: 'button',
                className: 'dsh-desktop-workspaces-overflow',
                'aria-expanded': sessionsExpanded,
                onClick: () => {
                  setExpandedSessionGroups((keys) => toggled(keys, group.key))
                },
              }, sessionsExpanded ? t('sessions.collapse') : t('sessions.expand', { n: collapsed.hiddenCount })),
            )
          }),
        ),
        h('span', { className: 'dsh-desktop-workspaces-fade' }),
      )
    }

    exports.inject = ['slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker']

    // W2 导出钩子：派生纯函数供「node:test 单测」与之共享同一份真源（不复制避免漂移），
    // 亦供 W3 Rows / W4 Browser 复用；生产运行时 cordis 只消费 inject/apply，此面纯只读。
    exports.derive = {
      indexSubagentDescendants,
      deriveGroups,
      deriveFlat,
      deriveSearchResults,
      groupByWorkspace,
      sessionNode,
      sessionVisible,
      sessionTitle,
      hasActiveSchedule,
      visiblePendingKind,
      workspaceLabel,
      workspaceTitleOf,
      byRecency,
      // W3：行组件层纯函数（排序账户对齐 / 折叠切片 / home 缩略 / 状态点集），
      // 供 W3 行单测与 W4 Browser 渲染复用。
      isWindowsStylePath,
      abbreviateHomePath,
      toggled,
      collapsedSessionRows,
      reconciledSessionOrder,
      compareSessionRecency,
      nextSessionOrderAccount,
      sessionStatuses,
    }

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
