# 上游拴合面速查（dsh-v0.1.5-rc.2 · 2026-09-11 复核）

> **用途**：对接/排查 `@deepseek-ai` 上游包时先查此表，免钻 node_modules。
> **事实来源**：M1-M3 攻坚实证（坑号 = docs/pitfalls.md）+ 2026-09-01 M4-d3 迁移实证（0.1.2-alpha.3）。
> **⚠️ 0.1.2 破坏性变更**：`dsh-host-apiproxy`/`AbstractApiClient`/`dsh-client-runtime` 已删，RPC 通道与载波形态整体重构（见 §1/§2）；§7 契约矩阵已按 M4-d3 迁移后的实际代码刷新，后续再升级须逐条复核。
> **2026-09-02 alpha.4 复核（C-2）**：`0.1.2-alpha.3 → 0.1.2-alpha.4` **无破坏性变更**，本表全部契约条目在 alpha.4 仍然成立（session 域为 host 内部重构；ui-slots/ui-renderer 新增 `keyedHooks` 为增量可选）。详见 upstream-migrations「C-2」。
> **2026-09-03 alpha.5 复核（C-3 · 自动工具）**：`0.1.2-alpha.4 → 0.1.2-alpha.5` **无破坏性变更**（`scripts/upstream.cjs` 自动 diff 判定：S1/S2/S3/S3b + ui-* 契约零差异、roster 92 包全存在、官方 roster 包集无增删），本表契约条目在 alpha.5 全部成立。详见 upstream-migrations「C-3」。
> **2026-09-04 rc.1 复核（C-4 · 自动工具 · 首次跨线至 `next` 稳定线）**：`0.1.2-alpha.5 → 0.1.2-rc.1` **无破坏性变更**（`scripts/upstream.cjs` 自动 diff 判定：S1/S2/S3/S3b + ui-* 契约零差异、roster 92 包全存在、官方 web-app roster 包集无增删），本表全部契约条目在 `0.1.2-rc.1` 仍然成立，无需任何桌面侧适配。详见 upstream-migrations「C-4」。
> **2026-09-09 0.1.5-alpha.1 复核（C-5 · 人工适配）**：`0.1.2-rc.1 → 0.1.5-alpha.1` **含破坏性变更，四件人工适配后本表契约条目仍然成立**——layout 契约 `details` 槽位演进为 `rightbar`（报告式 `openRightbar(track, fullscreen)`/`closeRightbar()`，桌面 layout 件已同步）；workspace 快照新增 `state` 流状态与 `owningGroupKey` 独立导出（forge-workspaces 件已同步）；S2 载波 4 文件 diff 经官方同版本 dist 对齐（帧协议四象限不变）；官方 roster 新增 9 包全装（boot.ts 补 3 条 host 行：`workspace-files`/`file-upload`/`open-in-app`）。新增 RPC 端点：`workspaceFiles`（bounded read/目录/变更 feed）、`fileUploads`（流式上传，connection.fetch 路由）。详见 upstream-migrations「C-5」。
> **2026-09-10 0.1.5-alpha.2 复核（C-6 · 人工适配 · 用户决策）**：`0.1.5-alpha.1 → 0.1.5-alpha.2` **ui-* 契约六包有差异（assess REVIEW 判定）经人工摸底确认无破坏后升级**——拴合面 S1/S2/S3/S3b 零差异、roster 95 包全存在；ui-primitives 图标体系重构（−DocumentFileIcon，+CodeFileIcon/FileTypeIcon/code-file-types）但桌面消费导出（13 图标/Modal/Button/FishLogo/BrandWordmark）全部保留，**官方将 primitives 内联进 dist staticModules（npm 依赖图移除该包），桌面 4 处 require 走官方 dist 模块表无感**；官方 roster **以 documentpreview 换代 textpreview**（textpreview 未发行 0.1.5-alpha.2，E404），桌面依赖随迁。本表契约条目在 0.1.5-alpha.2 全部成立。详见 upstream-migrations「C-6」。
> **2026-09-11 0.1.5-rc.2 复核（C-7 · 人工适配 · 用户决策）**：`0.1.5-alpha.2 → 0.1.5-rc.2` **ui-* 两包（ui-primitives / ui-chat）有差异（assess REVIEW 判定）经人工内容级 diff 摸底确认无破坏后升级**——拴合面 S1/S2/S3/S3b **零差异**、roster 96 包全存在、官方 web-app roster 包集**无增删**；两包 `src/index.ts` **零变化（导出面不变）**，改动均为组件内部呈现层：`CodeFileIcon` 由字母标号改为内嵌全彩 artwork 表（新增 `code-file-icon-artwork.ts/.manifest.json`，逐实例 id 防渐变/clip 冲突）、`CodeBlock` **新增可选 `contentRef` 与 `.content` 类（纯增量）**、`StatsPills` 在 cacheWrite 为 0 时隐藏该行、`TurnTailNodeView` 间距微调；桌面消费面（`Modal`/`Button`/`FishLogo`/`BrandWordmark` + workspaces 13 图标）不受影响。本表契约条目在 0.1.5-rc.2 全部成立。详见 upstream-migrations「C-7」。

## 1. RPC 通道归属（renderer → host，0.1.2 新形态）

| 通道 | 承载方法形态 | 代表方法 | 桌面端入口 |
|---|---|---|---|
| **connection unary**（`createSharedFetchHandler('/api')`） | **斜杠**（`domain/method`） | `settings.describe`、`credentials.describe`、`session.list/modelCatalog`、`subagents.list`、`agentPresets.list`、`skills.list`、`commands.list`、`$events/result` | `__DSH_TRANSPORT__.fetch` → bridge `defaultApiProxyHandler` → `connectionFetch.fetch`（main.ts 第 4 步；M4-d3 迁移后） |
| **typertGateway 逻辑流**（`wireStream.open`） | **斜杠**（`domain/method`） | `$events`（会话/审批/waterfall 下行）、`session.control`、`workspace.follow` | `__DSH_TRANSPORT__.openStream` → bridge `dsh:stream-open` → `typertGateway.wireStream.open`（M4-d3 迁移后） |
| ~~apiProxy domain 方法~~ | ~~点分（`domain.method`）~~ | ~~`session.list/create/prompt`~~ | **已删除**（`dsh-host-apiproxy` 不存在，0.1.2 由上述两通道取代） |
| ~~Typert remote 404 兜底~~ | — | ~~`commands/list`~~ | **已删除**（0.1.2 全端点经 connection 认领，无 404 兜底；`typertGateway.invokeRpc` 不再需要） |

**排障判据**：主进程日志 `RPC 失败 (X): HTTP 404` = X 无 host 侧 controller 认领（查 §2 服务名是否缺失装配，尤其三 controller：session/settings/workspace——见 `m4-d3-012-alpha3-migration-plan.md`）。

## 2. 服务注册名 vs cordis 条目 id（`ctx.get()` 用左列 · 0.1.2）

| 服务名（camelCase） | 条目 id（kebab-case） | 包 / 来源 |
|---|---|---|
| `agentPresets` | `agent-presets` | @deepseek-ai/dsh-agent-presets（坑 16） |
| `typertGateway` | `typert-gateway` | @deepseek-ai/dsh-api-gateway（坑 12） |
| `connection`（HostConnectionHandle） | `host-connection` | @deepseek-ai/dsh-client-connection（**host 半**，0.1.2 必备；提供 `createSharedFetchHandler`） |
| `api-remotes`（$events 源） | `api-remotes` | @deepseek-ai/dsh-api-remotes（0.1.2 必备，注册 `$events` forwarded 事件源） |
| `sessionController`/`settingsController`/`workspaceController` | `session-controller`/`settings-controller`/`workspace-controller` | @deepseek-ai/dsh-api-{session,settings,workspace}-controller（**0.1.2 三 controller 必备**——缺则 unary 404/流 "no active Remote method"） |
| ~~`apiProxy`~~ | ~~`api-gateway`~~ | ~~@deepseek-ai/dsh-host-apiproxy~~ **已删除**（0.1.2） |
| `directoryPicker` | （无条目，prepare 钩子注入） | 本项目 ElectronDirectoryPicker（坑 6） |
| `desktop` / `webServer` / `desktopStartup` | （无条目，prepare 钩子注入） | 本项目 forge-api / compat-webserver（坑 9） |
| `uiWorkspace` | `@deepseek-ai/dsh-client-ui-workspace`（client 半 apply 内 `new …Service(ctx,"uiWorkspace")`）→ **2026-09-07 起由本项目 `@lansi-ai/dsh-forge-workspaces` 提供** | ⚠ **修正既往结论**：该服务**确实注册在 ctx 上**——cordis `Service` 基类构造即 `ctx.reflect.provide(name, self)`，且「owning fiber 卸载时自动注销」（`@deepseek-ai/cordis/src/service.ts:57`）。故**排除 ui-workspace = 服务消失**，硬 inject 它的 `dsh-forge-sidebar`/`ui-conversation`/`ui-directory-picker-native`/`ui-agent-preset` 四者永久 PENDING 且**不报错**（坑 15）。六方法契约见 §7.1 该行 |

## 3. cordis-plugin-include 补丁语义（坑 16 核心）

- **非 insert 补丁**（`{id, name, config}`）：只「按 id 覆盖已存在条目」；条目不存在 → warn + **静默跳过**，绝不插入。
- **insert 补丁**：`{insert: [...]}` 无 id → 追加到根列表（桌面空根 `[]` 的唯一装载路径）；带 id → 追加到目标 group 的 config。
- 桌面根配置为空 `[]` ⇒ **任何新插件条目必须走 insert**，id 打点式的覆盖补丁 100% no-op。

## 4. 官方 UI 的静默空态清单（装配断点掩体）

| 面 | 静默行为 |
|---|---|
| Agent 预设（dsh-client-ui-agent-preset） | 空 roster 与服务未装载均 `return null`，无报错文案 |
| dsh-agent-presets `scanRoot` | root 目录 ENOENT → 返回 `[]`（合法部署态） |
| ~~apiProxy `static inject`~~ | ~~不含 agentPresets——插件装载失败时 apiProxy 照常就绪~~ **0.1.2 已删**（`dsh-host-apiproxy` 不存在；agentPresets 端点在 session-controller 认领，缺失装配时 404） |
| 坑 11 冷会话 | 清单可见但无 live agent，无人主动重挂载 |

对冲手段：宿主侧「启动期扫描结果必显」探针（main.ts 3.5 步 agentPresets 为范例）。

## 5. 双面插件（dsh.client 声明）的 node 面职责

| 包 | node 面（lib/index.js） | client 面（lib/client.js） |
|---|---|---|
| dsh-client-ui-settings-general | 注册 `ui-onboarding` settings namespace（**host 补丁必须装**，坑 7） | 渲染 General 设置页 |
| dsh-client-ui-agent-preset | 空 `apply()`（无需 host 条目） | 注册 settings.section / settings.general.item / 会话 chip |
| dsh-host-plugin-inventory | 提供官方插件清单 | 设置页「插件列表」读 `pluginInventory/list`（坑 10） |

## 6. 关键目录事实

| 资源 | dev 路径 | 打包路径（asar 内） |
|---|---|---|
| agent-presets roots | shipped 根（`node_modules/@deepseek-ai/dsh-agent-presets/presets`，包内只读 system）+ 桌面扩展根 `dist/resources/agent-presets`（默认空目录，ENOENT → `[]`） | asar 内 `@deepseek-ai/dsh-agent-presets/presets` |
| 官方 web-frontend dist | `node_modules/@deepseek-ai/dsh-web-frontend/dist`（dsh-ui:// 直读） | asar 内同路径 |
| RUNTIME_ROOT | `<repo>/.runtime` | `<系统 userData>/.runtime`（app.isPackaged 分流） |
| 用户可写预设根 | `dshHomePath('.agent-presets')`（includeUserRoot 默认追加） | 同左 |

## 7. 自有插件 × 官方契约 依赖矩阵（升级基线必备核查表）

> **用途**：上游升级（M4-d）时逐条核对下方「依赖契约」是否变更。**2026-09-01 已按 0.1.2-alpha.3 迁移后的实际代码刷新**（0.1.2 破坏性变更后的契约现状见 §1/§2 与本表各行）；后续再升级须重新逐条核对。
> **原则**：自有插件只在「拴合面」咬官方——要么消费官方槽位/服务，要么塞进官方 DOM。升级时**先对契约、再改代码**。
> **新增于 2026-08-27（D-18 拴合面债收口）**，来源 = plugin-inventory.md + boot-graph desktopDecls。
> **2026-09-01 已核对两轮**：① 下表各「核查要点」在 0.1.1-rc.2 均无变更（官方 ui-* 包清单与槽位契约零差异，详见 upstream-migrations C 区；旧版所标目标版本「rc.12」系臆测项）；② **0.1.2-alpha.3 破坏性迁移（M4-d3）后的契约现状已按实际代码刷新**（见本表各行 + §1/§2）。

### 7.1 Client 半（renderer bundle，消费官方 UI 槽位/运行时）

| 自有插件 | 依赖官方契约 | 风险 | 升级核查要点 |
|---|---|---|---|
| `@lansi-ai/dsh-ipc-connection`（ipc-connection.js） | ~~继承官方 `AbstractApiClient`~~ **0.1.2 已改为图谱占位 + HTML boot 脚本注入 `__DSH_TRANSPORT__ = {fetch, openStream, ownsHost:true}`**（官方 `dsh-client-connection` 客户端读之自行 `provide('connection')`） | 🔴 高（已迁移） | 基类已删；`__DSH_TRANSPORT__` 契约（RpcFetch/RpcStreamOpen/ownsHost）是否变；官方 connection apply 是否仍读该全局 |
| `@lansi-ai/dsh-forge-layout`（forge-layout-client.js） | **root 槽位**：sidebar/conversation/details/shell.overlay（single/session-maybe/list + scope）；`defineStore`（**0.1.2 源已由 `dsh-client-runtime/client` 迁至 `@deepseek-ai/dsh-client-store`**）；`ctx.layout` 服务名；AppFrame 渲染 details（strict session scope）须包 `SessionProvider` | 🔴 高（已迁移） | 槽位名/kind/scope 是否变；`defineStore` API；`layout` 服务注入是否仍被官方消费方期望；SessionProvider 是否仍由渲染器注入 |
| `@lansi-ai/dsh-forge-sidebar`（forge-sidebar-client.js） | **sidebar 子槽位**：brand.mark/name/workspaces/settings/footer.action（single/list + root）；官方 `ui-workspace`/`ui-settings` 注册者的 owner props 契约 | 🔴 高 | 子槽位名是否变；workspaces 注册者期望的 props（wide/expandSidebar）是否变 |
| `@lansi-ai/dsh-forge-titlebar`（forge-titlebar-client.js） | 官方 `#root` 结构（顶部 32px 让位）、官方 UI 布局高度 | 🟡 中 | `#root` 容器结构是否变；官方 UI 顶栏高度是否变（顶栏下边线探针同步） |
| `@lansi-ai/dsh-forge-settings`（forge-settings-client.js） | `settings.section` 槽位、`ui-onboarding` namespace（dsh-client-ui-settings-general） | 🟡 中 | settings.section 槽位名是否变；桌面 section 是否仍可注入 |
| `@lansi-ai/dsh-forge-panel`（forge-panel-client.js） | `sidebar.footer.action` 槽位 | 🟡 中 | 槽位名是否变 |
| `@lansi-ai/dsh-forge-cmdpalette`（禁用壳） | 官方运行时导航、`ctx.sessions`/`workspaces` | 🟢 低 | 禁用壳下无功能风险；仅作入口隐藏，恢复时才核查 |
| `@lansi-ai/dsh-forge-audit-viewer`（forge-audit-viewer-client.js） | 审计 Tab 槽位、`ctx.desktop` | 🟡 中 | 审计槽位是否变；ctx.desktop 聚合服务是否仍供桌面能力 |
| `@lansi-ai/dsh-forge-session-export`（forge-session-export-client.js，2026-09-02 M6 外壳小件） | 官方槽位 `conversation.session.header.utilities`（ui-conversation 声明）；官方 host 半 `session-log-download` 行（boot.ts §1，/export 命令 + `/api/session.export` ZIP 路由）；`@deepseek-ai/dsh-client-ui-primitives`（Modal/Button，守卫 require）；`command/executed` 事件 | 🟡 中 | 槽位名是否变；host 半路由/命令契约是否变；primitives Modal/Button 签名是否变 |
| `@lansi-ai/dsh-forge-workspaces`（forge-workspaces-client.js，2026-09-07 M6-P3 W1 骨架） | **顶替官方 `dsh-client-ui-workspace`（整体互斥排除，非仅占洞）**，故须承接其**全部**对外契约，共五项接管面：① **provide `uiWorkspace` 服务**——六方法契约 `connectWorkspace/startSession/archiveSession/pickDirectory/listDirectory/createDirectory`（官方 `types/client/navigation.d.ts`）+ `DirectoryBrowseError` + `watchNavigation` 首启导航策略；② `slots.provideRoot({hooks:{workspaces: workspaces.list}})` = 全局标准 prop `useWorkspaces` **唯一来源**；③ `locale.register('workspace', {zh,en})` **63 键**（zh 为键集真源、en 全量对齐，已与官方逐字 diff 通过）；④ 双注册 `sidebar.workspaces`（自有侧栏壳声明的洞）+ `conversation.hero.workspace`（官方 ui-conversation 声明，P4 前不消失），各带 `*.directoryFlow` 子洞（single/root，native picker 占洞处）；⑤ `browserInjected` 十三项动作面（薄转发 `sessions.*`/`workspaces.*` domain，数据面零新增）。另 `defineStore` persist key 沿用官方 **`dsh.workspace.view.v5`**（用户既有视图偏好天然继承）；**W2 tree 派生层**（2026-09-08）：展示投影纯函数族 `deriveGroups / deriveFlat / deriveSearchResults / indexSubagentDescendants / sessionNode / groupByWorkspace / visiblePendingKind / workspaceLabel(workspaceTitleOf) / sessionVisible / sessionTitle / hasActiveSchedule / byRecency` **逐字对齐官方 `lib/types/client` 同名实现**（`workspaceTitleOf` 内联自官方 `dsh-util-workspace-path`，因该包为 ESM、loader 无选择器保证），行状态优先级 pendingInteraction>running>completed 由 `sessionNode` 顺序字段承载，经 `exports.derive` 钩子（即读共享）供 W3/W4 复用并由 `node:test` 单测（`test/workspace-tree.test.cjs`，8 项）守护 | 🔴 高 | ① 官方 `UiWorkspace` 六方法签名/语义是否变（`connectWorkspace` 的「复用空白会话-or-新建」判据：blank + cwd 相等 + 在 sessionIds 内 + 未归档）；② `provideRoot` hooks 面与 `useWorkspaces` 快照形状 `{items, archivedSessionIds, phase, error}`；③ `workspace` 字典键集增减（升级后重跑 diff）；④ 两洞名与 directoryFlow 子洞 kind/scope；owner props `EmptyWorkspaceOwnerProps{open,anchorRef,selectedId,onPick,onClose}` 与 `{wide,expandSidebar}`；⑤ `sessions.searchResultLimit`（现 20）与 `search` 的 `{ok,value}` 信封；`workspaces.insertBefore`/`insertSessionBefore` 持久语义；**⑥ 派生函数族语义是否随官方 dist 变（尤其 `indexSubagentDescendants` 血缘归并、`sessionNode` 行状态字段顺序、`groupByWorkspace` 未分组桶规则、`sessionVisible` blank/archived/subagent 判据）——升级后对照 §7.1 派生层与 `test/workspace-tree.test.cjs` 重跑**；⑦ 若排除清单被回退（官方包恢复装载）→ 本件与官方**双注册冲突**抛 "already has a registration" |
| `@lansi-ai/dsh-forge-network`（forge-network-client.js，2026-09-10 M4-b 配套） | 官方槽位 **`settings.general.item`**（通用设置分区**行注入**，与既有 `@lansi-ai/dsh-forge-settings` 同机制，由自研 `@lansi-ai/dsh-forge-settings-shell` 经 `renderSlot` 渲染）；`window.desktopBridge.network` 为**自有契约**（非官方） | 🟡 中 | ① `settings.general.item` 槽位名与其行渲染契约是否变；② 若自研设置外壳被回退为官方 `ui-settings-general`，该槽位是否仍存在（回退需同步改排行/注入面）；③ `dsw-alias-*` 主题 token 是否变（仅影响视觉） |

### 7.2 Host 半（主进程模块，M2 项目内形态）

| 模块 | 依赖官方契约 | 风险 | 升级核查要点 |
|---|---|---|---|
| `forge-api.ts`（ctx.desktop） | 无官方 UI 契约；内部自研审计/配置 | 🟢 低 | 基本无上游依赖 |
| `forge-tray/notify/shortcuts/clipboard/autostart/rewarm` | Electron API 为主，官方 UI 无强绑定 | 🟢 低 | 基本无需核查 |
| `forge-appearance.ts`（骨架外观） | 官方 `html/body/#root` **骨架结构** | 🟡 中 | 官方 body/#root 骨架是否变；`--dsd-*` 变量契约是否仍适用（应跟进 D-18） |
| `dsh-protocol.ts`（dsh://） | 无官方 UI 依赖 | 🟢 低 | — |
| `compat-webserver.ts`（webServer 等价面） | 官方第三方插件 HTTP 原义 | 🟢 中 | 第三方插件路由签名是否变（若官方 webServer 契约变动） |
| `forge-credentials.ts`（自有化 credentials provider · M4） | 官方 `@deepseek-ai/dsh-credentials` seam：`CredentialProvider` 基类（构造即 provide `credentials` 服务）+ 8 个抽象方法签名 + `credentials/reference-updated`/`record-updated` 事件；`dsh-atomic-write`（withFileLock/writeFileAtomic）、`dsh-launch-environment`（launchEnvironmentOf 分层）；`.credentials.yaml` **version-1 文档格式**（与官方 CLI 互换读写）；路径解析走自有 `forge-home-paths.ts`（不再依赖官方 dsh-home-paths） | 🟡 中 | ① 基类抽象方法签名是否变；② 文档格式是否升版（version 2）；③ 分层语义（process > file > project-env > user-env）是否变；④ roster 已删官方条目——若恢复官方条目会重复 provide 冲突 |
| `forge-home-paths.ts`（自有化 harness home 路径解析 · M4） | 官方 `@deepseek-ai/dsh-home-paths` 的**解析语义**（非运行时）：优先级 configured > `$DSH_HOME` > `~/.dsh`、空串视为未设、tilde 展开、`canonicalizeWatchPath` realpath 规范化 | 🟡 中 | 官方若变更环境变量名（DSH_HOME）、默认目录名（.dsh）或优先级语义 → 官方 16 包与自研栈对同一环境解析出不同 home，数据面脱钩——升级时逐字节 diff 该包 lib/index.js |
| `forge-proxy.ts`（网络代理设置 · 2026-09-10 M4-b 配套） | **electron-updater 的 session 分区契约（关键）**：其 HTTP 走独立分区 `electron-updater`（`out/electronHttpExecutor.js` 的 `NET_SESSION_NAME` + `getNetSession()`，options `cache:false`，`AppUpdater.netSession` 即它）→ 代理必须**对该分区单独 `setProxy`**，只设 `defaultSession` 时「检查更新」仍走直连且**无任何报错**；Electron `session.setProxy` 的 `direct` / `system` / `fixed_servers` 三模式 | 🟡 中 | ① 上游是否改分区名或 `getNetSession()` 的 options —— 改则两侧建出**不同 session**，代理静默失效（本件的 `EXTRA_PARTITIONS` 须同步）；② 上游是否改用 Node 栈发请求（则 `setProxy` 整体失效，需换机制）；③ `setProxy` 模式枚举/`fixed_servers` 规则语法是否变 |

### 7.3 骨架 / 宿主注入面（非插件，但咬官方 HTML）

| 项 | 依赖官方 | 风险 | 升级核查要点 |
|---|---|---|---|
| `boot-graph.ts` `LAYOUT_SKELETON_CSS` | 官方 `html,body,#root{height:100%}`、`#root` 挂载点 | 🔴 高 | 官方 #root 尺寸/挂载规则是否变；我们要的 `position:fixed` 锚定是否仍能赢（坑 19） |
| `boot-graph.ts` `CLIENT_EXCLUDE_IDS` | 官方被排除包（2026-09-07 现状 8 项）：`ui-layout` / `ui-sidebar` / `ui-directory-picker-browse` / `dsh-client-hmr` / `dsh-cordis-client-runner` / `dsh-client-ui-cordis` / `dsh-session-log-export`（仅 client 半） / `ui-settings-general` / **`ui-workspace`（M6-P3 W1，本表 §7.1 末行五项接管面）** | 🔴 高 | 升级是否新增互斥包；排除清单是否需更新；**逐条确认被排除包对外提供的服务/全局贡献是否已由自有件接管**（ui-workspace 的 `uiWorkspace` 服务即此类隐性连坐，见 §2 该行）；同文件多处编辑须串行 + dist 产物 grep 反查（坑 18） |
| `dsh-ui-protocol.ts` `injectBootManifest` | 官方 index.html 结构（`</head>` 注入点） | 🟡 中 | 官方 index.html 挂载结构是否变（若自建根容器须此处插入） |
| `boot.ts` §3b 宿主平面 `disabled` 清单（父/宿主 roster，坑 53） | 官方 **`dsh-base/cordis.patch.yml`**（把模型可见行注册在宿主平面）+ **`dsh-web-app/cordis.patch.yml`**（逐行 `disabled` 交回 agent 预设）；依据 = `dsh-tools` 的 `view(scope)` = 全局层 + scope 链（预设只能影子覆盖同名，屏蔽不掉全局层其它工具） | 🔴 高 | 上游升级后重跑 `npm run upstream:assess` 并逐条 diff 这两份官方 patch：① 官方是否新增/删除「模型可见行」（工具、`agent-instructions`、`plan-mode`、compaction 段）→ 本清单须同步增删；② 官方是否把某行重新搬回宿主平面；③ 漏对齐的后果 = 该行从全局层渗进**所有**预设（含极简模式），每轮白烧数千 token 且不报错（本清单 2026-09-10 按 0.1.5-alpha.2 对齐） |

### 7.4 升级逐条核查 SOP（M4-d 必执行）

> **2026-09-01 已执行两轮**：① `rc.8 → 0.1.1-rc.2` 逐条核对**无破坏性变更**（见 upstream-migrations C 区）；② **`0.1.1-rc.2 → 0.1.2-alpha.3` 破坏性迁移**按 M4-d3 专项执行完毕（载波重构 `__DSH_TRANSPORT__`、三 controller、`__DSH_BOOT_READY__`、M6 插件契约重对——见 `m4-d3-012-alpha3-migration-plan.md`）。下方勾选清单为 `rc.8 → 0.1.1-rc.2` 轮结论（历史）；0.1.2 轮的契约变化已并入 §1/§2/§7.1。

升级 `rc.8 → 0.1.1-rc.2` 时，按以下顺序逐条勾选，**先登记 diff 再适配**（ADR-005）。**2026-09-01 本条已执行完毕**（结论：全部无破坏性变更，详见 upstream-migrations C 区）：

1. [x] 官方 dist `index.html`：`#root` 挂载点、body 结构是否变（**无变**）
2. [x] 官方 CSS：`html/body/#root` 规则（尤其 `height:100%`）是否变；我们的骨架锚定是否仍能压过（**无变**）
3. [x] 官方 `dsh-client-ui-layout` 槽位契约：root 槽位 children/scope/kind 是否变（**无变**）
4. [x] 官方 `dsh-client-ui-sidebar` 槽位契约：sidebar 子槽位是否变（**无变**）
5. [x] 官方 `dsh-client-connection` 基类：`AbstractApiClient` 签名是否变（**零差异**）
6. [x] 官方 `runtime.defineStore` / `ctx.layout` / `ctx.sessions` 服务 API 是否变（**无变**）
7. [x] `CLIENT_EXCLUDE_IDS`：是否新增互斥包需排除（**ui-* 包清单完全一致，无需新增**）
8. [x] settings.section / sidebar.footer.action 等消费槽位是否变（**无变**）
9. [x] 官方 `dsh-web-frontend` 版本：确认 dist 结构、槽位契约无破坏性变更（**已发布 0.1.1-rc.2，待实机截图回归**）
10. [x] 更新本表（刷新各契约 → 最新值），并同步 plugin-inventory.md、active-context.html（**本次已同步 upstream-migrations/11-risks/12-references/01-research/09-roadmap/prd-and-design/extension-guide/plugin-inventory**）

> **关键提醒**：本表无法穷尽上游未知变更——升级前务必以 `sync-upstream` 登记 diff（ADR-005）为准，先对照 diff 逐条刷新本表，再改自有插件。

