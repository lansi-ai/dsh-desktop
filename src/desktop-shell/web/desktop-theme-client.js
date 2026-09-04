/**
 * @lansi-ai/dsh-desktop-theme —— 桌面外观设置注入（图标包选择 + 图标槽位补齐）。
 *
 * 通过官方 Cordis Slots 机制向设置面板注册「外观」section。图标按 host 注册表里的
 * `scope` 分成互不牵连的两类，页面**由上至下四项一级设置项**（用户定的层级与顺序）：
 *   1. **应用图标**（global）：窗口/任务栏/Dock 明暗两版；
 *   2. **托盘图标**（global）：系统托盘明暗两版；
 *   3. **品牌 logo**（global）：标题栏左上角标识；
 *      —— 以上三项存包外 `userData/icons/` **全局单份，切换图标包不影响**；
 *      一级块**只留标题 + 横向槽位卡**（缩略图 / 用途 / 上传·替换），一屏并排放多个
 *      槽位（竖向行式在 1-2 个槽位的块里太浪费空间）；状态不写文字——有缩略图=已提供、
 *      虚线空格=未提供，按钮文案「替换/上传」同步表达；插件标识、说明文案、落盘路径、
 *      规范文件名一律不进一级块（格式与建议尺寸写在上传对话框标题里），
 *      一级块之间用 1px 分隔线（`.dsa-section + .dsa-section`）；
 *   4. **图标包**（iconThemeId）：卡片网格切换激活包 + 「新建图标包」，包只管
 *      **界面图标**（设置入口与导航、窗控、折叠钮）；其下二级 = 界面图标需求清单
 *      （默认折叠，标题带缺失计数，按消费方插件分组卡：用途/规范名/落盘位置/
 *      格式·建议尺寸/缺失回退/已提供状态 + 行内上传·替换）。
 * 行内「上传/替换」按槽位取文件，主进程按 scope 分流落盘（global → userData/icons；
 * pack → 当前激活包，内置包只读则先克隆到本地同名包），用户无需对齐文件名与目录。
 *
 * 槽位真源在主进程 `ICON_SLOTS`（desktop-theme.ts），本文件只渲染 host 下发的
 * `slots`/`uploadDir`，不复制清单——新增图标消费点时改 host 即可，设置页自动跟上。
 *
 * 样式：注入 `<style data-plugin>` + 官方 `--dsw-*` token（明暗自适应）；网格
 * 三层防 min-content 撑破（卡片 min-width:0 / 内层 minmax(0,1fr) / 缩略图无文本
 * 标签）。数据面经 desktopBridge.iconTheme.list/set/upload（坑 27）。
 *
 * 注：本文件为浏览器侧 bundle（含 window 全局），不参与 Node 编译。
 */
window.__ModuleLoader__.load({
  id: '@lansi-ai/dsh-desktop-theme',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    // Cordis 模块系统中 React 不是全局变量，必须 require 获取（hooks 依赖）。
    const React = require('react')
    const h = React.createElement

    /** 主题图标内联渲染服务（apply 时注入；预览用，未就绪时回退 <img>）。 */
    let themeIconSvc = null

    // ── 样式表（官方 token 取色，明暗随 presenter 设定的 color-scheme 自动切换）──

    const css = `
.dsa-root{flex-direction:column;gap:14px;width:100%;min-width:0;display:flex}
.dsa-block{flex-direction:column;gap:10px;min-width:0;display:flex}
/* 一级设置项之间的分隔线（首块上方不画线） */
.dsa-section + .dsa-section{border-top:1px solid var(--dsw-alias-border-l1);padding-top:14px}
.dsa-heading{flex-direction:column;gap:2px;min-width:0;display:flex}
.dsa-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.dsa-desc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsa-head{justify-content:space-between;align-items:flex-start;gap:12px;display:flex}
.dsa-slotBtn{box-sizing:border-box;cursor:pointer;flex:none;height:26px;color:var(--dsw-alias-label-primary);background:0 0;border:.5px solid var(--dsw-alias-border-l4);border-radius:13px;align-items:center;padding:0 10px;font-family:inherit;font-size:12px;line-height:24px;display:inline-flex}
.dsa-slotBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsa-slotBtn:disabled{color:var(--dsw-alias-label-dimmed);cursor:wait}
.dsa-slotBtn.dsa-btnPrimary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsa-form{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:8px;padding:12px;display:flex}
.dsa-formRow{align-items:center;gap:8px;display:flex}
.dsa-formNote{color:var(--dsw-alias-label-tertiary);flex:1;min-width:0;font-size:11px;line-height:16px}
.dsa-input{box-sizing:border-box;flex:1;min-width:0;height:30px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l3);border-radius:8px;padding:0 8px;font-family:inherit;font-size:13px}
.dsa-input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.dsa-summary{cursor:pointer;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:22px}
.dsa-summary:hover{color:var(--dsw-alias-brand-primary)}
.dsa-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;display:grid}
.dsa-card{box-sizing:border-box;cursor:pointer;text-align:left;color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;align-items:stretch;gap:8px;min-width:0;margin:0;padding:12px;font-family:inherit;display:flex}
.dsa-card:hover{border-color:var(--dsw-alias-border-l3)}
.dsa-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsa-cardActive{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-multi-select)}
.dsa-icons{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;display:grid}
.dsa-iconCell{background:var(--dsw-alias-fill-tsp-secondary);border-radius:6px;justify-content:center;align-items:center;height:32px;display:flex;overflow:hidden}
.dsa-iconCell img{width:24px;height:24px;object-fit:contain}
.dsa-iconSvg{color:var(--dsw-alias-label-primary);justify-content:center;align-items:center;width:24px;height:24px;display:inline-flex;overflow:hidden}
.dsa-meta{justify-content:space-between;align-items:center;gap:6px;display:flex}
.dsa-name{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);flex:1;min-width:0;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}
.dsa-count{color:var(--dsw-alias-label-secondary);flex:none;font-size:11px;line-height:16px}
.dsa-check{color:var(--dsw-alias-brand-primary);flex:none;font-size:13px;font-weight:600;line-height:16px}
.dsa-state{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;padding:2px 0}
.dsa-hint{font-size:12px;line-height:18px}
.dsa-hintOk{color:var(--dsw-alias-state-success-primary)}
.dsa-hintErr{color:var(--dsw-alias-state-error-primary)}
.dsa-slotWrap{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding-top:10px;display:flex}
.dsa-slotDir{word-break:break-all;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsa-slotGrid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;display:grid}
.dsa-slotCard{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;align-items:center;gap:8px;min-width:0;padding:8px;display:flex}
.dsa-slotCard:hover{border-color:var(--dsw-alias-border-l3)}
.dsa-slotCard .dsa-iconCell{flex:none}
.dsa-slotCardName{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);flex:1;min-width:0;font-size:12px;line-height:18px}
.dsa-slotGroup{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;display:flex;overflow:hidden}
.dsa-slotGroup + .dsa-slotGroup{margin-top:8px}
.dsa-slotGroupHead{background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:8px 12px;display:flex}
.dsa-slotGroupName{white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}
.dsa-slotGroupPlugin{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-tsp-secondary);border-radius:6px;max-width:280px;padding:1px 6px;font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:18px;overflow:hidden}
.dsa-slotGroupCount{color:var(--dsw-alias-label-secondary);margin-left:auto;flex:none;font-size:11px;line-height:16px}
.dsa-slotGroupCount.dsa-slotMiss{color:var(--dsw-alias-state-warn-primary)}
.dsa-slotRows{flex-direction:column;display:flex}
.dsa-slotRow{border-top:1px solid var(--dsw-alias-border-l1);align-items:center;gap:10px;padding:10px 12px;display:flex}
.dsa-slotRow:first-child{border-top:none}
.dsa-iconCellEmpty{background:0 0;border:1px dashed var(--dsw-alias-border-l3)}
.dsa-slotMain{flex-direction:column;flex:1;gap:1px;min-width:0;display:flex}
.dsa-slotLabel{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dsa-slotFile{word-break:break-all;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:16px}
.dsa-slotNote{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsa-slotSide{flex-direction:column;flex:none;align-items:flex-end;gap:6px;display:flex}
.dsa-slotState{font-size:11px;line-height:16px}
.dsa-slotOk{color:var(--dsw-alias-state-success-primary)}
.dsa-slotMiss{color:var(--dsw-alias-state-warn-primary)}
`
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin="@lansi-ai/dsh-desktop-theme"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@lansi-ai/dsh-desktop-theme'
      tag.textContent = css
      document.head.appendChild(tag)
    }

    // ── 插件声明：注册 settings.section slot ──────────────────────

    exports.inject = ['slots', 'themeIcon']
    exports.apply = (ctx) => {
      themeIconSvc = ctx.get('themeIcon') ?? null
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'appearance',
        order: 11,
        label: () => '\u5916\u89c2',
        locale: '@lansi-ai/dsh-desktop-theme',
      }, DesktopAppearanceSection))
    }

    /** 外观分区（外壳 `.dss-options` 已提供内边距，此处不再叠加）。 */
    function DesktopAppearanceSection() {
      return h(IconPackBlock, null)
    }

    // ── 图标包（iconThemeId）─────────────────────────────────────

    /** 提示条状态（kind 决定取色：成功绿 / 失败红 / 中性次要色）。 */
    function Hint({ hint }) {
      if (hint === null) return null
      const cls = hint.kind === 'ok' ? 'dsa-hint dsa-hintOk' : hint.kind === 'err' ? 'dsa-hint dsa-hintErr' : 'dsa-state'
      return h('div', { className: cls, role: hint.kind === 'err' ? 'alert' : undefined }, hint.text)
    }

    /**
     * 图标包区块：清单加载 → 卡片网格选择（+ 新建包）→ 图标需求清单（槽位 + 行内上传）。
     * 上传目标恒为**当前激活包**（内置包由主进程先克隆到本地再写入）；新建包即激活，
     * 因此「建一个自己的包 → 往里传图标」是一条连续路径。
     */
    function IconPackBlock() {
      const [themes, setThemes] = React.useState([])
      const [slots, setSlots] = React.useState([])
      const [uploadDir, setUploadDir] = React.useState('')
      const [current, setCurrent] = React.useState('')
      const [hint, setHint] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      /** 正在上传的槽位 ID（行内按钮禁用态）。 */
      const [uploadingSlot, setUploadingSlot] = React.useState(null)
      /** 新建包表单（null=收起）。 */
      const [creating, setCreating] = React.useState(false)
      const [newId, setNewId] = React.useState('')
      const [newName, setNewName] = React.useState('')
      /** 破缓存 token（切换/上传后刷新预览）。 */
      const [bust, setBust] = React.useState(Date.now())

      const refresh = React.useCallback(() => {
        const bridge = window.desktopBridge
        if (!bridge?.iconTheme) {
          setLoading(false)
          setHint({ kind: 'err', text: '\u6865\u63a5\u672a\u5c31\u7eea\uff0c\u65e0\u6cd5\u52a0\u8f7d\u56fe\u6807\u5305' })
          return
        }
        bridge.iconTheme.list().then((result) => {
          setThemes(result.themes)
          setSlots(result.slots ?? [])
          setUploadDir(result.uploadDir ?? '')
          setCurrent(result.current)
          setLoading(false)
        }).catch(() => {
          setLoading(false)
          setHint({ kind: 'err', text: '\u56fe\u6807\u5305\u6e05\u5355\u52a0\u8f7d\u5931\u8d25' })
        })
      }, [])

      React.useEffect(() => { refresh() }, [refresh])

      const handleSelect = (id) => {
        if (id === current) return
        const bridge = window.desktopBridge
        if (!bridge?.iconTheme) return
        setHint(null)
        bridge.iconTheme.set(id).then((result) => {
          if (result.ok && result.current) {
            setCurrent(result.current)
            setBust(Date.now())
            // 槽位提供情况与写入目录随激活包变化 → 重取
            refresh()
            setHint({ kind: 'ok', text: '\u5df2\u5207\u6362\u56fe\u6807\u5305\uff0c\u7a97\u53e3/\u6258\u76d8/UI \u56fe\u6807\u5df2\u5e94\u7528' })
          } else {
            setHint({ kind: 'err', text: result.message ?? '\u5207\u6362\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5' })
          }
        }).catch(() => {
          setHint({ kind: 'err', text: '\u5207\u6362\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5' })
        })
      }

      /** 槽位行内上传：目标=当前激活包，主进程按槽位规范名与目录落盘。 */
      const handleUpload = (slot) => {
        const bridge = window.desktopBridge
        if (!bridge?.iconTheme?.upload) return
        setUploadingSlot(slot.id)
        bridge.iconTheme.upload(slot.id).then((result) => {
          if (result.ok) {
            setBust(Date.now())
            refresh()
            const where = result.scope === 'global'
              ? '\u5168\u5c40'
              : `${result.themeId} \u5305`
            const tail = result.cloned
              ? '\uff08\u5185\u7f6e\u5305\u53ea\u8bfb\uff0c\u5df2\u514b\u9686\u5230\u672c\u5730\u540e\u5199\u5165\uff09'
              : ''
            setHint({ kind: 'ok', text: `\u5df2\u4e0a\u4f20\u300c${slot.label}\u300d\u2192 ${where}/${slot.file}${tail}` })
          } else if (result.message !== '\u5df2\u53d6\u6d88\u9009\u62e9') {
            setHint({ kind: 'err', text: result.message ?? '\u4e0a\u4f20\u5931\u8d25' })
          }
        }).catch(() => {
          setHint({ kind: 'err', text: '\u4e0a\u4f20\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5' })
        }).finally(() => {
          setUploadingSlot(null)
        })
      }

      /** 新建图标包（ID 白名单同协议路由字符集）；主进程建完即激活。 */
      const handleCreate = () => {
        const bridge = window.desktopBridge
        if (!bridge?.iconTheme?.create) return
        const id = newId.trim()
        const name = newName.trim()
        if (!/^[a-z0-9_-]{1,32}$/.test(id)) {
          setHint({ kind: 'err', text: '\u56fe\u6807\u5305 ID \u53ea\u80fd\u7528\u5c0f\u5199\u5b57\u6bcd\u3001\u6570\u5b57\u3001-\u3001_\uff081-32 \u4f4d\uff09' })
          return
        }
        if (name === '') {
          setHint({ kind: 'err', text: '\u8bf7\u586b\u5199\u56fe\u6807\u5305\u663e\u793a\u540d' })
          return
        }
        bridge.iconTheme.create(id, name).then((result) => {
          if (result.ok) {
            setCreating(false)
            setNewId('')
            setNewName('')
            setCurrent(id)
            setBust(Date.now())
            refresh()
            setHint({ kind: 'ok', text: `\u5df2\u521b\u5efa\u5e76\u6fc0\u6d3b\u56fe\u6807\u5305\u300c${name}\u300d\uff0c\u4e0b\u65b9\u6e05\u5355\u53ef\u9010\u9879\u4e0a\u4f20` })
          } else {
            setHint({ kind: 'err', text: result.message ?? '\u521b\u5efa\u5931\u8d25' })
          }
        }).catch(() => {
          setHint({ kind: 'err', text: '\u521b\u5efa\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5' })
        })
      }

      const globalGroups = groupSlots(slots.filter((slot) => slot.scope === 'global'))
      const packSlots = slots.filter((slot) => slot.scope !== 'global')
      const shared = { activeId: current, bust, uploadingSlot, onUpload: handleUpload }

      return h('div', { className: 'dsa-root' },
        // 一级项 ①②：应用图标 / 托盘图标 / 品牌 logo（全局单份，与图标包解耦；
        // 顺序与块标题取自 host 注册表 global 槽位的 group，横向卡片排布省竖向空间）
        !loading && globalGroups.map((group) => h('div', { key: group.name, className: 'dsa-block dsa-section' },
          h('div', { className: 'dsa-title' }, group.name),
          h(SlotCards, { slots: group.items, ...shared }),
        )),
        // 一级项 ④：图标包（界面图标随包切换；需求清单是其二级明细）
        h('div', { className: 'dsa-block dsa-section' },
          h('div', { className: 'dsa-head' },
            h('div', { className: 'dsa-heading' },
              h('div', { className: 'dsa-title' }, '\u56fe\u6807\u5305'),
              h('div', { className: 'dsa-desc' }, '\u5305\u7ba1\u754c\u9762\u56fe\u6807\uff08\u8bbe\u7f6e\u5165\u53e3\u4e0e\u5bfc\u822a\u3001\u7a97\u63a7\u3001\u6298\u53e0\u94ae\uff09\uff0c\u5207\u6362\u5305\u5373\u6574\u5957\u66f4\u6362\uff1b\u4e0e\u914d\u8272\u4e3b\u9898\u4e92\u4e0d\u7ea6\u675f\u3002\u5e94\u7528/\u6258\u76d8\u56fe\u6807\u4e0e\u54c1\u724c logo \u5728\u4e0a\u65b9\uff0c\u5168\u5c40\u5355\u4efd\u3001\u4e0d\u968f\u5305\u5207\u6362'),
            ),
            h('button', {
              type: 'button',
              className: 'dsa-slotBtn',
              onClick: () => { setHint(null); setCreating(!creating) },
            }, creating ? '\u6536\u8d77' : '\u65b0\u5efa\u56fe\u6807\u5305'),
          ),
          creating && h('div', { className: 'dsa-form' },
            h('div', { className: 'dsa-formRow' },
              h('input', {
                className: 'dsa-input',
                value: newId,
                maxLength: 32,
                placeholder: '\u5305 ID\uff08\u5c0f\u5199\u5b57\u6bcd / \u6570\u5b57 / - / _\uff09',
                onChange: (e) => setNewId(e.target.value),
              }),
              h('input', {
                className: 'dsa-input',
                value: newName,
                maxLength: 24,
                placeholder: '\u663e\u793a\u540d',
                onChange: (e) => setNewName(e.target.value),
                onKeyDown: (e) => { if (e.key === 'Enter') handleCreate() },
              }),
            ),
            h('div', { className: 'dsa-formRow' },
              h('div', { className: 'dsa-formNote' }, '\u65b0\u5305\u5efa\u5728\u7528\u6237\u4e3b\u9898\u76ee\u5f55\u4e0b\u5e76\u81ea\u52a8\u6fc0\u6d3b\uff0c\u4e4b\u540e\u7684\u4e0a\u4f20\u76f4\u63a5\u843d\u8fdb\u8fd9\u4e2a\u5305'),
              h('button', { type: 'button', className: 'dsa-slotBtn dsa-btnPrimary', onClick: handleCreate }, '\u521b\u5efa\u5e76\u6fc0\u6d3b'),
            ),
          ),
          loading
            ? h('div', { className: 'dsa-state' }, '\u6b63\u5728\u52a0\u8f7d\u2026')
            : themes.length === 0
              ? h('div', { className: 'dsa-state' }, '\u672a\u53d1\u73b0\u53ef\u7528\u56fe\u6807\u5305')
              : h('div', { className: 'dsa-grid' },
                  themes.map((theme) => h(IconPackCard, {
                    key: theme.id,
                    theme,
                    bust,
                    active: theme.id === current,
                    onSelect: () => handleSelect(theme.id),
                  }))),
          !loading && packSlots.length > 0
            ? h(IconSlotList, {
              slots: packSlots,
              uploadDir,
              activeName: themes.find((theme) => theme.id === current)?.name ?? current,
              ...shared,
            })
            : null,
        ),
        h(Hint, { hint }),
      )
    }

    /** 按注册表顺序聚成消费方分组（组名即一级块标题 / 组卡标题）。 */
    function groupSlots(slots) {
      const groups = []
      for (const slot of slots) {
        let group = groups.find((entry) => entry.name === slot.group)
        if (group === undefined) {
          group = { name: slot.group, plugin: slot.plugin, items: [] }
          groups.push(group)
        }
        group.items.push(slot)
      }
      return groups
    }

    /** 卡片代表图标：包内 `icons/` 的前 4 个图标（数据文件 ui-overrides.json 不预览）。 */
    function pickPreviewIcons(icons) {
      return icons.filter((file) => !isJsonFile(file)).slice(0, 4)
    }

    /** 单个图标包卡片：代表图标 + 包名 + 图标数 + 选中态。 */
    function IconPackCard({ theme, bust, active, onSelect }) {
      const previews = pickPreviewIcons(theme.icons)
      const count = theme.icons.filter((file) => !isJsonFile(file)).length
      return h('button', {
        type: 'button',
        className: `dsa-card${active ? ' dsa-cardActive' : ''}`,
        onClick: onSelect,
        'aria-pressed': active,
        title: `${theme.name}\uff08${theme.id}\uff09`,
      },
        h('span', { className: 'dsa-icons' },
          previews.length === 0
            ? h('span', { className: 'dsa-count' }, '\u65e0\u9884\u89c8\u56fe\u6807')
            : previews.map((file) => h(IconPreview, {
              key: file,
              file,
              src: `dsh-ui://app/theme/${theme.id}/${file}?t=${bust}`,
            }))),
        h('span', { className: 'dsa-meta' },
          h('span', { className: 'dsa-name' }, theme.name),
          h('span', { className: 'dsa-count' }, `${count} \u4e2a\u56fe\u6807`),
          active ? h('span', { className: 'dsa-check', 'aria-hidden': 'true' }, '\u2713') : null),
      )
    }

    /** 单个图标预览（src 由调用方按归属拼好）：svg 走内联上色随明暗，png 原色。 */
    function IconPreview({ src, file }) {
      const isSvg = file.endsWith('.svg')
      const [html, setHtml] = React.useState(null)
      const [failed, setFailed] = React.useState(false)
      React.useEffect(() => {
        if (!isSvg || themeIconSvc === null) return
        let disposed = false
        setFailed(false)
        setHtml(null)
        themeIconSvc.renderSvg(src, 24)
          .then((value) => { if (!disposed) setHtml(value) })
          .catch(() => { if (!disposed) setFailed(true) })
        return () => { disposed = true }
      }, [src])
      // svg 且内联服务可用：走内联上色（失败/加载中留空位，不出裂图）；
      // png 或内联服务未就绪：回退 <img>（svg 保留文件原色，不随明暗）
      if (isSvg && themeIconSvc !== null) {
        if (failed || html === null) return null
        return h('span', { className: 'dsa-iconCell', title: file },
          h('span', { 'aria-hidden': 'true', className: 'dsa-iconSvg', dangerouslySetInnerHTML: { __html: html } }))
      }
      return h('span', { className: 'dsa-iconCell', title: file },
        h('img', { src, alt: '', onError: () => setFailed(true) }))
    }

    // ── 图标需求清单（槽位 · 注册表真源在 host ICON_SLOTS）──────────

    /** 槽位图标的取用 URL：global 走 `/icons/`（全局目录），pack 走激活包主题路由。 */
    function slotIconSrc(slot, activeId, bust) {
      return slot.scope === 'global'
        ? `dsh-ui://app/icons/${slot.file}?t=${bust}`
        : `dsh-ui://app/theme/${activeId}/${slot.file}?t=${bust}`
    }

    /**
     * 全局一级块的横向槽位卡：缩略图 + 用途 + 上传·替换，一屏放得下多个槽位
     * （竖向行式在只有 1-2 个槽位的一级块里太浪费空间）。
     * 状态不写文字：**有缩略图=已提供，虚线空格=未提供**，按钮文案「替换/上传」
     * 同步表达；规范文件名与格式·尺寸不在卡上重复（文件名是包内槽位的契约，
     * 全局槽位名固定由主进程决定；格式与建议尺寸写在上传对话框标题里）。
     */
    function SlotCards({ slots, activeId, bust, uploadingSlot, onUpload }) {
      return h('div', { className: 'dsa-slotGrid' },
        slots.map((slot) => h('div', { key: slot.id, className: 'dsa-slotCard' },
          slot.provided
            ? h(IconPreview, { file: slot.file, src: slotIconSrc(slot, activeId, bust) })
            : h('span', { className: 'dsa-iconCell dsa-iconCellEmpty', 'aria-hidden': 'true' }),
          h('span', { className: 'dsa-slotCardName', title: slot.label }, slot.label),
          h('button', {
            type: 'button',
            className: 'dsa-slotBtn',
            onClick: () => onUpload(slot),
            disabled: uploadingSlot !== null,
          }, uploadingSlot === slot.id ? '\u4e0a\u4f20\u4e2d\u2026' : slot.provided ? '\u66ff\u6362' : '\u4e0a\u4f20'),
        )),
      )
    }

    /**
     * 需求清单的分组卡：组头 = 用途域 + 取用该图标的插件标识 + 本组「缺 N / 共 M」
     * 计数；组体每行 = 缩略图 + 用途 + 规范文件名 + 格式·建议尺寸·缺失回退 + 行内上传。
     * 规范命名与落盘目录由主进程按 scope 决定，用户不需要手工对齐。
     */
    function SlotGroups({ slots, activeId, bust, uploadingSlot, onUpload }) {
      return groupSlots(slots).map((group) => {
        const groupMissing = group.items.filter((slot) => !slot.provided).length
        return h('div', { key: group.name, className: 'dsa-slotGroup' },
          h('div', { className: 'dsa-slotGroupHead' },
            h('span', { className: 'dsa-slotGroupName' }, group.name),
            h('span', { className: 'dsa-slotGroupPlugin', title: group.plugin }, group.plugin),
            h('span', { className: `dsa-slotGroupCount${groupMissing > 0 ? ' dsa-slotMiss' : ''}` },
              groupMissing === 0
                ? `${group.items.length} \u9879\u5df2\u63d0\u4f9b`
                : `\u7f3a ${groupMissing} / ${group.items.length} \u9879`),
          ),
          h('div', { className: 'dsa-slotRows' },
            group.items.map((slot) => h(IconSlotRow, {
              key: slot.id,
              slot,
              activeId,
              bust,
              busy: uploadingSlot === slot.id,
              disabled: uploadingSlot !== null,
              onUpload: () => onUpload(slot),
            }))),
        )
      })
    }

    /**
     * 界面图标需求清单（**默认折叠**，标题带缺失计数作为展开信号；内容见 SlotGroups）。
     */
    function IconSlotList({ slots, uploadDir, activeId, activeName, bust, uploadingSlot, onUpload }) {
      const missing = slots.filter((slot) => !slot.provided).length
      return h('details', { className: 'dsa-slotWrap' },
        h('summary', { className: 'dsa-summary' },
          `\u56fe\u6807\u9700\u6c42\u6e05\u5355\uff08${activeName} \u00b7 ${missing === 0 ? '\u5168\u90e8\u5df2\u63d0\u4f9b' : `\u7f3a ${missing} \u9879`}\uff09`),
        h('div', { className: 'dsa-slotDir' }, `\u4e0a\u4f20\u5199\u5165\u5f53\u524d\u6fc0\u6d3b\u5305\uff1a${uploadDir}\uff08\u5185\u7f6e\u5305\u6253\u5305\u540e\u53ea\u8bfb\uff0c\u4f1a\u514b\u9686\u5230\u672c\u5730\u540c\u540d\u5305\u518d\u5199\u5165\uff09`),
        h(SlotGroups, { slots, activeId, bust, uploadingSlot, onUpload }),
      )
    }

    /** 单个槽位行（需求清单用）：缩略图 + 用途 + 规范名 + 格式/尺寸/回退 + 状态 + 上传。 */
    function IconSlotRow({ slot, activeId, bust, busy, disabled, onUpload }) {
      return h('div', { className: 'dsa-slotRow' },
        slot.provided
          ? h(IconPreview, { file: slot.file, src: slotIconSrc(slot, activeId, bust) })
          : h('span', { className: 'dsa-iconCell dsa-iconCellEmpty', 'aria-hidden': 'true' }),
        h('div', { className: 'dsa-slotMain' },
          h('div', { className: 'dsa-slotLabel' }, slot.label),
          h('div', { className: 'dsa-slotFile' }, slot.file),
          h('div', { className: 'dsa-slotNote' }, `${slot.format.toUpperCase()} \u00b7 \u5efa\u8bae ${slot.size}px \u00b7 ${slot.fallback}`),
        ),
        h('div', { className: 'dsa-slotSide' },
          h('div', { className: `dsa-slotState ${slot.provided ? 'dsa-slotOk' : 'dsa-slotMiss'}` },
            slot.provided ? '\u2713 \u5df2\u63d0\u4f9b' : '\u25cb \u672a\u63d0\u4f9b'),
          h('button', {
            type: 'button',
            className: 'dsa-slotBtn',
            onClick: onUpload,
            disabled,
          }, busy ? '\u4e0a\u4f20\u4e2d\u2026' : slot.provided ? '\u66ff\u6362' : '\u4e0a\u4f20'),
        ),
      )
    }

    /** 是否为数据文件（只进索引、不做预览）。 */
    function isJsonFile(file) {
      return file.endsWith('.json')
    }

    return module.exports
  },
})
