/**
 * @lansi-ai/dsh-forge-plugin-inventory —— 插件列表（设置「插件」section 的「插件列表」Tab）。
 *
 * 接管面：官方 ui-settings-plugin-inventory 的 `settings.plugins.tab`（id='all'，见
 * boot-graph.ts CLIENT_EXCLUDE_IDS）。「插件」section 外壳仍由官方 ui-settings-plugins
 * 提供（含「插件配置」Tab），本件只换列表页。
 *
 * 数据面：host 侧 `pluginInventory/list` 的三源合并快照（Cordis 真实 Loader 条目 ∪
 * 客户端资源图谱 ∪ Agent 预设组成）。
 *
 * 信息架构（v3）：
 *   - 顶部：搜索框 + 承载面筛选 chips（全部 / 主进程 / 界面 / 双半 / 预设组成）
 *   - 两级分组：
 *       ① 全局插件 —— Loader 条目 ∪ 客户端 bundle，按模块名去重，标承载面
 *       ② 预设组成 —— **预设切换器**选中一个预设，列该预设的**全部组成行**（含已停用 /
 *          条件启用），保持组成顺序（对齐官方「会话插件 · N 个」口径）
 *   - 每行精简两行：短名 + 状态；第二行（全局）包名 · 承载面、（预设）包名 · 条目 id；
 *     点行展开详情（条目 / 承载 / 来源 / 运行相位 / 条件 / 预设）
 *
 * 去噪决策（对照 v1/v2）：
 *   - 取消逐行卡片边框，改用分隔线 + 间距承载层次；
 *   - 删掉与短名重复的「模块 xxx」，包名只说一次；
 *   - 徽标全部撤掉，只留「状态文案」（上色不描边）；
 *   - 预设不用「按预设名分小组」铺开（四个 shipped 预设合计 92 行、彼此大量重复），
 *     改为**预设切换器**一次看一个；停用行照列并在详情给出条件表达式（官方同口径）。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-forge-plugin-inventory',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement

    /** 字典命名空间（本插件自有）。 */
    const NS = 'forge-plugin-inventory'

    // ── 字典 ──────────────────────────────────────────────────────

    const zh = {
      tab: '插件列表',
      placeholder: '搜索插件名或包名',
      loading: '正在读取插件清单…',
      error: '插件清单读取失败（宿主数据面不可用）',
      retry: '重试',
      filterAll: '全部',
      filterHost: '主进程',
      filterClient: '界面',
      filterBoth: '双半',
      filterPreset: '预设组成',
      matchLine: '匹配 {count} 项',
      emptyAll: '当前部署没有可显示的插件。',
      empty: '没有匹配的插件。',
      groupGlobal: '全局插件',
      groupPreset: '预设组成',
      countSuffix: '{count} 个',
      presetPickerLabel: '预设',
      presetDefault: '{name}（默认）',
      presetBroken: '{name}（加载失败）',
      enabledTag: '已启用',
      disabledTag: '已停用',
      failedTag: '失败',
      conditionalTag: '条件启用',
      presetEnabledTag: '预设中启用',
      halfHost: '主进程',
      halfClient: '界面',
      halfBoth: '双半',
      halfPreset: '预设组成',
      presetInline: '预设：{names}',
      factEntry: '条目',
      factHalf: '承载',
      factSource: '来源',
      factPhase: '运行相位',
      factCondition: '条件',
      factPreset: '预设',
      phasePending: '等待依赖',
      phaseLoading: '装载中',
      phaseActive: '运行中',
      phaseUnloading: '卸载中',
      rowExpand: '展开详情',
      rowCollapse: '收起详情',
      groupToggle: '折叠或展开分组',
    }

    const en = {
      tab: 'Plugin list',
      placeholder: 'Search plugin or package name',
      loading: 'Reading plugin inventory…',
      error: 'Failed to read the plugin inventory (host data plane unavailable)',
      retry: 'Retry',
      filterAll: 'All',
      filterHost: 'Host',
      filterClient: 'UI',
      filterBoth: 'Host + UI',
      filterPreset: 'Preset',
      matchLine: '{count} matched',
      emptyAll: 'This deployment has no plugins to show.',
      empty: 'No matching plugins.',
      groupGlobal: 'Global plugins',
      groupPreset: 'Preset composition',
      countSuffix: '{count}',
      presetPickerLabel: 'Preset',
      presetDefault: '{name} (default)',
      presetBroken: '{name} (failed to load)',
      enabledTag: 'Enabled',
      disabledTag: 'Disabled',
      failedTag: 'Failed',
      conditionalTag: 'Conditional',
      presetEnabledTag: 'Enabled via presets',
      halfHost: 'Host',
      halfClient: 'UI',
      halfBoth: 'Host + UI',
      halfPreset: 'Preset',
      presetInline: 'Preset: {names}',
      factEntry: 'Entry',
      factHalf: 'Plane',
      factSource: 'Source',
      factPhase: 'Phase',
      factCondition: 'Condition',
      factPreset: 'Presets',
      phasePending: 'Pending',
      phaseLoading: 'Loading',
      phaseActive: 'Active',
      phaseUnloading: 'Unloading',
      rowExpand: 'Expand details',
      rowCollapse: 'Collapse details',
      groupToggle: 'Collapse or expand group',
    }

    // ── 视觉：状态文案色调 + 尺寸令牌 ──────────────────────────────

    /**
     * 状态文案色调。浅深双值（项目纪律：自绘配色禁止内联硬编码单值，否则浅色主题
     * 必不可读、深色主题对比不足），中性走官方 token。取值已按 4.5:1 正文对比校核。
     */
    const TONE = {
      neutral: 'var(--dsw-alias-label-secondary)',
      ok: 'light-dark(#15803d, #4ade80)',
      info: 'light-dark(#1d4ed8, #93c5fd)',
      warn: 'light-dark(#b45309, #fbbf24)',
      bad: 'light-dark(#b91c1c, #fca5a5)',
    }

    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 0' },
      search: {
        display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px',
      },
      searchInput: {
        flex: 1, border: 'none', background: 'transparent',
        fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-primary)',
      },
      chips: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
      chip: {
        padding: '3px 10px', borderRadius: '999px', fontSize: '12px', lineHeight: '18px',
        border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer',
      },
      chipActive: {
        border: '1px solid var(--dsw-alias-button-info-fill)',
        background: 'var(--dsw-alias-button-info-fill)',
        color: 'var(--dsw-alias-label-primary)', fontWeight: 500,
      },
      matchLine: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
      group: { display: 'flex', flexDirection: 'column' },
      groupHeader: {
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
        padding: '10px 2px 6px', border: 'none', background: 'transparent',
        cursor: 'pointer', textAlign: 'left',
      },
      caret: { fontSize: '10px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)' },
      groupTitle: { fontSize: '13px', fontWeight: 600, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' },
      groupCount: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
      picker: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', padding: '0 2px 4px' },
      pickerLabel: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
      row: {
        display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
        padding: '7px 2px', border: 'none', borderTop: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent', cursor: 'pointer', textAlign: 'left',
      },
      rowMain: { flex: 1, minWidth: 0 },
      rowTitle: { fontSize: '13px', lineHeight: '19px', color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' },
      rowSub: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' },
      rowSide: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px', flexShrink: 0, maxWidth: '46%' },
      statusText: { fontSize: '12px', lineHeight: '18px', whiteSpace: 'nowrap' },
      presetText: { fontSize: '11px', lineHeight: '16px', color: TONE.info, textAlign: 'right', wordBreak: 'break-all' },
      detail: {
        display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px',
        padding: '4px 2px 10px', fontSize: '11px', lineHeight: '17px',
      },
      detailKey: { color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
      detailVal: { color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' },
      status: { fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)', padding: '12px 0' },
      failure: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px', padding: '12px 0' },
      errorText: { fontSize: '13px', lineHeight: '20px', color: TONE.bad, margin: 0 },
      retry: {
        padding: '6px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
        fontSize: '13px', fontWeight: 500,
        background: 'var(--dsw-alias-button-info-fill)', color: 'var(--dsw-alias-label-primary)',
      },
    }

    // ── 工具 ──────────────────────────────────────────────────────

    /** 压缩模块标识：去 scope 前缀与 cordis/dsh 命名前缀（对齐官方口径）。 */
    function moduleShortName(moduleName) {
      return (moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName)
        .replace(/^cordis:/, '')
        .replace(/^cordis-plugin-/, '')
        .replace(/^dsh-(?:host-|client-)?/, '')
    }

    /** 条目 id 展示：去掉 composition 专用的 `include:` 前缀（对齐官方口径）。 */
    function entrySubtitle(entryId) {
      return entryId.replace(/^include:/, '')
    }

    /** 一行是否命中搜索词：只匹配模块名与条目 id（对齐官方口径）。 */
    function matches(moduleName, entryId, normalizedQuery) {
      if (normalizedQuery.length === 0) return true
      return [moduleName, entryId].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
    }

    /** 承载面文案键。 */
    const HALF_KEY = { host: 'halfHost', client: 'halfClient', both: 'halfBoth', preset: 'halfPreset' }

    /** fiber 相位文案键。 */
    const PHASE_KEY = {
      pending: 'phasePending',
      loading: 'phaseLoading',
      active: 'phaseActive',
      failed: 'failedTag',
      unloading: 'phaseUnloading',
    }

    /** 承载面筛选 chips（顺序即展示顺序）。 */
    const FILTERS = ['all', 'host', 'client', 'both', 'preset']
    const FILTER_KEY = {
      all: 'filterAll',
      host: 'filterHost',
      client: 'filterClient',
      both: 'filterBoth',
      preset: 'filterPreset',
    }

    /** 一行是否通过当前筛选（host/client 含双半，因双半同时归属两侧）。 */
    function passFilter(row, filter) {
      if (filter === 'all') return true
      if (filter === 'preset') return row.half === 'preset'
      if (filter === 'both') return row.half === 'both'
      if (filter === 'host') return row.half === 'host' || row.half === 'both'
      if (filter === 'client') return row.half === 'client' || row.half === 'both'
      return true
    }

    /**
     * 状态文案（对齐官方口径）：
     * 失败 → 条件启用 → 已启用 → 全局停用但被预设启用 → 已停用。
     */
    function statusOf(row) {
      if (row.fiberPhase === 'failed') return { key: 'failedTag', tone: 'bad' }
      if (row.enabled === 'conditional') return { key: 'conditionalTag', tone: 'warn' }
      if (row.enabled === true) return { key: 'enabledTag', tone: 'ok' }
      if (row.half !== 'preset' && row.presetProviders.length > 0) return { key: 'presetEnabledTag', tone: 'info' }
      return { key: 'disabledTag', tone: 'neutral' }
    }

    /** 行上可见的预设文案：仅「全局停用、靠预设启用」的行有增量（预设组成行由切换器点名）。 */
    function presetText(row, t) {
      if (row.half === 'preset' || row.enabled === true) return null
      if (row.presetProviders.length === 0) return null
      return t('presetInline', { names: row.presetProviders.join(' · ') })
    }

    /** 切换器上的预设显示名（默认 / 加载失败标注，对齐官方 presetOptionDefault 口径）。 */
    function presetChipLabel(preset, t) {
      if (preset.broken !== undefined) return t('presetBroken', { name: preset.name })
      return preset.isDefault ? t('presetDefault', { name: preset.name }) : preset.name
    }

    // ── 组件 ──────────────────────────────────────────────────────

    /** 分组标题行（可折叠）。 */
    function GroupHeader({ label, count, open, t, onToggle }) {
      return h('button', {
        type: 'button',
        style: S.groupHeader,
        'aria-expanded': open,
        'aria-label': `${label} ${t('groupToggle')}`,
        onClick: onToggle,
      },
        h('span', { style: S.caret }, open ? '▾' : '▸'),
        h('span', { style: S.groupTitle }, label),
        h('span', { style: S.groupCount }, t('countSuffix', { count })),
      )
    }

    /** 单行（精简两行 + 可选展开详情）。 */
    function PluginRow({ row, t, expanded, onToggle }) {
      const status = statusOf(row)
      const preset = presetText(row, t)
      const half = t(HALF_KEY[row.half])
      const entry = entrySubtitle(row.entryId)
      const sub = row.half === 'preset'
        ? `${row.moduleName} · ${entry}`
        : `${row.moduleName} · ${half}`
      const detail = [
        [t('factEntry'), entry],
        [t('factHalf'), half],
        [t('factSource'), row.source],
      ]
      if (row.fiberPhase !== null) detail.push([t('factPhase'), t(PHASE_KEY[row.fiberPhase])])
      if (row.condition !== undefined) detail.push([t('factCondition'), row.condition])
      if (row.half !== 'preset' && row.presetProviders.length > 0) {
        detail.push([t('factPreset'), row.presetProviders.join(' · ')])
      }

      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          style: S.row,
          'aria-expanded': expanded,
          'aria-label': `${moduleShortName(row.moduleName)}, ${half}, ${t(status.key)}${expanded ? `, ${t('rowCollapse')}` : `, ${t('rowExpand')}`}`,
          onClick: onToggle,
        },
          h('div', { style: S.rowMain },
            h('div', { style: S.rowTitle }, moduleShortName(row.moduleName)),
            h('div', { style: S.rowSub }, sub),
          ),
          h('div', { style: S.rowSide },
            h('span', { style: { ...S.statusText, color: TONE[status.tone] } }, t(status.key)),
            preset === null ? null : h('span', { style: S.presetText }, preset),
          ),
        ),
        expanded
          ? h('div', { style: S.detail }, detail.flatMap(([key, value]) => [
              h('span', { key: `${key}-k`, style: S.detailKey }, key),
              h('span', { key: `${key}-v`, style: S.detailVal }, value),
            ]))
          : null,
      )
    }

    /** 「插件列表」Tab 主体。 */
    function PluginInventoryTab({ list, t }) {
      const [request, setRequest] = React.useState(0)
      const [query, setQuery] = React.useState('')
      const [filter, setFilter] = React.useState('all')
      const [openGroups, setOpenGroups] = React.useState({ global: true, preset: true })
      const [expandedRow, setExpandedRow] = React.useState(null)
      const [chosenPreset, setChosenPreset] = React.useState(null)
      const [state, setState] = React.useState({ status: 'loading' })

      React.useEffect(() => {
        let alive = true
        Promise.resolve()
          .then(() => list())
          .then(
            (snapshot) => { if (alive) setState({ status: 'ready', snapshot }) },
            () => { if (alive) setState({ status: 'error' }) },
          )
        return () => { alive = false }
      }, [list, request])

      const retry = () => {
        setState({ status: 'loading' })
        setRequest((value) => value + 1)
      }

      if (state.status === 'loading') return h('p', { style: S.status }, t('loading'))
      if (state.status === 'error') {
        return h('div', { style: S.failure },
          h('p', { style: S.errorText, role: 'alert' }, t('error')),
          h('button', { type: 'button', style: S.retry, onClick: retry }, t('retry')),
        )
      }

      const entries = state.snapshot?.entries ?? []
      const presets = state.snapshot?.agentPresets ?? []
      const normalizedQuery = query.trim().toLocaleLowerCase()
      const filtering = normalizedQuery.length > 0 || filter !== 'all'
      const visible = entries.filter((row) => passFilter(row, filter) && matches(row.moduleName, row.entryId, normalizedQuery))
      const globalRows = visible.filter((row) => row.half !== 'preset')
      const presetRows = visible.filter((row) => row.half === 'preset')
      // 预设切换器候选：快照内全部预设（按 roster 顺序），默认 = 默认预设
      const selected = presets.find((preset) => preset.id === chosenPreset)
        ?? presets.find((preset) => preset.isDefault)
        ?? presets[0]
      const selectedRows = selected === undefined
        ? []
        : presetRows.filter((row) => row.presetId === selected.id)
      const searching = normalizedQuery.length > 0

      const toggleGroup = (key) => setOpenGroups((current) => ({ ...current, [key]: !current[key] }))
      const renderRow = (row) => h(PluginRow, {
        key: `${row.half}:${row.entryId}:${row.moduleName}`,
        row,
        t,
        expanded: expandedRow === `${row.half}:${row.entryId}:${row.moduleName}`,
        onToggle: () => setExpandedRow((current) => (current === `${row.half}:${row.entryId}:${row.moduleName}` ? null : `${row.half}:${row.entryId}:${row.moduleName}`)),
      })

      const globalOpen = searching || openGroups.global
      const presetOpen = searching || openGroups.preset

      return h('div', { style: S.wrap },
        h('div', { style: S.search },
          h('input', {
            type: 'text',
            value: query,
            placeholder: t('placeholder'),
            'aria-label': t('placeholder'),
            onChange: (event) => setQuery(event.target.value),
            style: S.searchInput,
          }),
        ),
        h('div', { style: S.chips }, FILTERS.map((id) => h('button', {
          key: id,
          type: 'button',
          'aria-pressed': filter === id,
          onClick: () => setFilter(id),
          style: { ...S.chip, ...(filter === id ? S.chipActive : null) },
        }, t(FILTER_KEY[id])))),
        filtering ? h('div', { style: S.matchLine }, t('matchLine', { count: visible.length })) : null,
        entries.length === 0
          ? h('p', { style: S.status }, t('emptyAll'))
          : visible.length === 0
            ? h('p', { style: S.status }, t('empty'))
            : h(React.Fragment, null,
                globalRows.length === 0 ? null : h('div', { style: S.group },
                  h(GroupHeader, {
                    label: t('groupGlobal'),
                    count: globalRows.length,
                    open: globalOpen,
                    t,
                    onToggle: () => toggleGroup('global'),
                  }),
                  globalOpen ? h('div', null, globalRows.map(renderRow)) : null,
                ),
                (presetRows.length === 0 || selected === undefined) ? null : h('div', { style: S.group },
                  h(GroupHeader, {
                    label: t('groupPreset'),
                    count: selectedRows.length,
                    open: presetOpen,
                    t,
                    onToggle: () => toggleGroup('preset'),
                  }),
                  presetOpen ? h(React.Fragment, null,
                    h('div', { style: S.picker },
                      h('span', { style: S.pickerLabel }, t('presetPickerLabel')),
                      presets.map((preset) => h('button', {
                        key: preset.id,
                        type: 'button',
                        'aria-pressed': preset.id === selected.id,
                        onClick: () => setChosenPreset(preset.id),
                        style: { ...S.chip, ...(preset.id === selected.id ? S.chipActive : null) },
                      }, presetChipLabel(preset, t))),
                    ),
                    selectedRows.length === 0
                      ? h('p', { style: S.status }, t('empty'))
                      : h('div', null, selectedRows.map(renderRow)),
                  ) : null,
                ),
              ),
      )
    }

    // ── 注册 ──────────────────────────────────────────────────────

    exports.inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']
    exports.apply = (ctx) => {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-forge-plugin-inventory: dictionaries')
      const t = ctx.locale.bind(NS)

      /** host 侧三源合并快照（api-remotes 信封：{ok, value}）。 */
      const list = async () => {
        const result = await ctx.remote.pluginInventory.list()
        if (!result.ok) {
          throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
        }
        return result.value
      }

      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'all',
        order: 10,
        label: () => t('tab'),
        locale: NS,
        inject: () => ({ list, t }),
      }, PluginInventoryTab))
    }

    return module.exports
  },
})
