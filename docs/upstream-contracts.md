# 上游拴合面速查（dsh-v0.1.2-alpha.4 · 2026-09-02 复核）

> **用途**：对接/排查 `@deepseek-ai` 上游包时先查此表，免钻 node_modules。
> **事实来源**：M1-M3 攻坚实证（坑号 = docs/pitfalls.md）+ 2026-09-01 M4-d3 迁移实证（0.1.2-alpha.3）。
> **⚠️ 0.1.2 破坏性变更**：`dsh-host-apiproxy`/`AbstractApiClient`/`dsh-client-runtime` 已删，RPC 通道与载波形态整体重构（见 §1/§2）；§7 契约矩阵已按 M4-d3 迁移后的实际代码刷新，后续上游再升级须逐条复核。
> **2026-09-02 alpha.4 复核（C-2）**：`0.1.2-alpha.3 → 0.1.2-alpha.4` **无破坏性变更**，本表全部契约条目在 alpha.4 仍然成立（session 域为 host 内部重构；ui-slots/ui-renderer 新增 `keyedHooks` 为增量可选）。详见 upstream-migrations「C-2」。

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
| `desktop` / `webServer` / `desktopStartup` | （无条目，prepare 钩子注入） | 本项目 desktop-api / compat-webserver（坑 9） |

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
| agent-presets roots | `dist/resources/agent-presets`（boot.ts `join(__dirname,'..','resources',...)`） | `\dist\resources\agent-presets`（M4-a1 核验） |
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
| `@lansi-ai/dsh-desktop-layout`（desktop-layout-client.js） | **root 槽位**：sidebar/conversation/details/shell.overlay（single/session-maybe/list + scope）；`defineStore`（**0.1.2 源已由 `dsh-client-runtime/client` 迁至 `@deepseek-ai/dsh-client-store`**）；`ctx.layout` 服务名；AppFrame 渲染 details（strict session scope）须包 `SessionProvider` | 🔴 高（已迁移） | 槽位名/kind/scope 是否变；`defineStore` API；`layout` 服务注入是否仍被官方消费方期望；SessionProvider 是否仍由渲染器注入 |
| `@lansi-ai/dsh-desktop-sidebar`（desktop-sidebar-client.js） | **sidebar 子槽位**：brand.mark/name/workspaces/settings/footer.action（single/list + root）；官方 `ui-workspace`/`ui-settings` 注册者的 owner props 契约 | 🔴 高 | 子槽位名是否变；workspaces 注册者期望的 props（wide/expandSidebar）是否变 |
| `@lansi-ai/dsh-desktop-titlebar`（desktop-titlebar-client.js） | 官方 `#root` 结构（顶部 32px 让位）、官方 UI 布局高度 | 🟡 中 | `#root` 容器结构是否变；官方 UI 顶栏高度是否变（顶栏下边线探针同步） |
| `@lansi-ai/dsh-desktop-settings`（desktop-settings-client.js） | `settings.section` 槽位、`ui-onboarding` namespace（dsh-client-ui-settings-general） | 🟡 中 | settings.section 槽位名是否变；桌面 section 是否仍可注入 |
| `@lansi-ai/dsh-desktop-panel`（desktop-panel-client.js） | `sidebar.footer.action` 槽位 | 🟡 中 | 槽位名是否变 |
| `@lansi-ai/dsh-desktop-cmdpalette`（禁用壳） | 官方运行时导航、`ctx.sessions`/`workspaces` | 🟢 低 | 禁用壳下无功能风险；仅作入口隐藏，恢复时才核查 |
| `@lansi-ai/dsh-desktop-audit-viewer`（desktop-audit-viewer-client.js） | 审计 Tab 槽位、`ctx.desktop` | 🟡 中 | 审计槽位是否变；ctx.desktop 聚合服务是否仍供桌面能力 |
| `@lansi-ai/dsh-desktop-session-export`（desktop-session-export-client.js，2026-09-02 M6 外壳小件） | 官方槽位 `conversation.session.header.utilities`（ui-conversation 声明）；官方 host 半 `session-log-download` 行（boot.ts §1，/export 命令 + `/api/session.export` ZIP 路由）；`@deepseek-ai/dsh-client-ui-primitives`（Modal/Button，守卫 require）；`command/executed` 事件 | 🟡 中 | 槽位名是否变；host 半路由/命令契约是否变；primitives Modal/Button 签名是否变 |

### 7.2 Host 半（主进程模块，M2 项目内形态）

| 模块 | 依赖官方契约 | 风险 | 升级核查要点 |
|---|---|---|---|
| `desktop-api.ts`（ctx.desktop） | 无官方 UI 契约；内部自研审计/配置 | 🟢 低 | 基本无上游依赖 |
| `desktop-tray/notify/shortcuts/clipboard/autostart/rewarm` | Electron API 为主，官方 UI 无强绑定 | 🟢 低 | 基本无需核查 |
| `desktop-appearance.ts`（骨架外观） | 官方 `html/body/#root` **骨架结构** | 🟡 中 | 官方 body/#root 骨架是否变；`--dsd-*` 变量契约是否仍适用（应跟进 D-18） |
| `dsh-protocol.ts`（dsh://） | 无官方 UI 依赖 | 🟢 低 | — |
| `compat-webserver.ts`（webServer 等价面） | 官方第三方插件 HTTP 原义 | 🟢 中 | 第三方插件路由签名是否变（若官方 webServer 契约变动） |

### 7.3 骨架 / 宿主注入面（非插件，但咬官方 HTML）

| 项 | 依赖官方 | 风险 | 升级核查要点 |
|---|---|---|---|
| `boot-graph.ts` `LAYOUT_SKELETON_CSS` | 官方 `html,body,#root{height:100%}`、`#root` 挂载点 | 🔴 高 | 官方 #root 尺寸/挂载规则是否变；我们要的 `position:fixed` 锚定是否仍能赢（坑 19） |
| `boot-graph.ts` `CLIENT_EXCLUDE_IDS` | 官方被排除包（ui-layout/ui-sidebar/directory-picker-browse） | 🟡 中 | 升级是否新增互斥包；排除清单是否需更新 |
| `dsh-ui-protocol.ts` `injectBootManifest` | 官方 index.html 结构（`</head>` 注入点） | 🟡 中 | 官方 index.html 挂载结构是否变（若自建根容器须此处插入） |

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

