# 上游拴合面速查（dsh-v0.1.0-rc.8 · 实证沉淀）

> **用途**：对接/排查 `@deepseek-ai` 上游包时先查此表，免钻 node_modules。
> **事实来源**：M1-M3 攻坚实证（坑号 = docs/pitfalls.md）；基线升级（M4-d）时须逐条复核此表并刷新。

## 1. RPC 三通道归属（renderer → host）

| 通道 | 承载方法形态 | 代表方法 | 桌面端入口 |
|---|---|---|---|
| apiProxy domain 方法 | **点分**（`domain.method`） | `session.list/create/prompt`、`agentPreset.list/select/read/copy/remove`、`settings.update`、`host.describe` | `toFetchHandler(apiProxy)` 经 `http://local/api/<method>` 虚拟路由（坑 2/3）；main.ts `callApi` |
| Typert remote | **斜杠**（`domain/method`） | `commands/list`、`fileReferences/list`、`goals/*`、`dynamicCordisRunner/*` | apiProxy 返回 404 → `typertGateway.invokeRpc(method, params)`（坑 12） |
| connection 直拦截 | — | 上游 HTTP 部署经 `connection.rpc.intercept('/api')` 认领 | **零端口不存在**（IPC 载波替代 connection） |

**排障判据**：主进程日志 `RPC 失败 (X): HTTP 404` = X 不在 apiProxy 表（查 `dsh-api-remotes/lib/client.js` descriptor 确认归属通道）。

## 2. 服务注册名 vs cordis 条目 id（`ctx.get()` 用左列）

| 服务名（camelCase） | 条目 id（kebab-case） | 包 / 来源 |
|---|---|---|
| `agentPresets` | `agent-presets` | @deepseek-ai/dsh-agent-presets（坑 16） |
| `typertGateway` | `typert-gateway` | @deepseek-ai/dsh-api-gateway（坑 12） |
| `apiProxy` | `api-gateway` | @deepseek-ai/dsh-host-apiproxy |
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
| apiProxy `static inject` | 不含 agentPresets——插件装载失败时 apiProxy 照常就绪，调用时才报 `this deployment composes no agent presets` |
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

> **用途**：`rc.8 → 0.1.1-rc.2` 升级（M4-d）时，逐条核对下方「依赖契约」是否在上游变更。
> **原则**：自有插件只在「拴合面」咬官方——要么消费官方槽位/服务，要么塞进官方 DOM。升级时**先对契约、再改代码**。
> **新增于 2026-08-27（D-18 拴合面债收口）**，来源 = plugin-inventory.md + boot-graph desktopDecls。
> **2026-09-01 已核对**：下表各「核查要点」在 0.1.1-rc.2 均无变更（官方 ui-* 包清单与槽位契约零差异，详见 upstream-migrations C 区）。旧版所标目标版本「rc.12」系臆测项，实际最新稳定为 `0.1.1-rc.2`。

### 7.1 Client 半（renderer bundle，消费官方 UI 槽位/运行时）

| 自有插件 | 依赖官方契约 | 风险 | 升级核查要点 |
|---|---|---|---|
| `@lansi-ai/dsh-ipc-connection`（ipc-connection.js） | 继承官方 `AbstractApiClient`（dsh-client-connection 基类） | 🔴 高 | 基类 `doFetch`/`readIpFrames`/`start` 签名是否变；connection 服务独占是否仍成立 |
| `@lansi-ai/dsh-desktop-layout`（desktop-layout-client.js） | **root 槽位**：sidebar/conversation/details/shell.overlay（single/session-maybe/list + scope）；`runtime.defineStore`；`ctx.layout` 服务名 | 🔴 高 | 槽位名/kind/scope 是否变；`defineStore` API；`layout` 服务注入是否仍被官方消费方期望 |
| `@lansi-ai/dsh-desktop-sidebar`（desktop-sidebar-client.js） | **sidebar 子槽位**：brand.mark/name/workspaces/settings/footer.action（single/list + root）；官方 `ui-workspace`/`ui-settings` 注册者的 owner props 契约 | 🔴 高 | 子槽位名是否变；workspaces 注册者期望的 props（wide/expandSidebar）是否变 |
| `@lansi-ai/dsh-desktop-titlebar`（desktop-titlebar-client.js） | 官方 `#root` 结构（顶部 32px 让位）、官方 UI 布局高度 | 🟡 中 | `#root` 容器结构是否变；官方 UI 顶栏高度是否变（顶栏下边线探针同步） |
| `@lansi-ai/dsh-desktop-settings`（desktop-settings-client.js） | `settings.section` 槽位、`ui-onboarding` namespace（dsh-client-ui-settings-general） | 🟡 中 | settings.section 槽位名是否变；桌面 section 是否仍可注入 |
| `@lansi-ai/dsh-desktop-panel`（desktop-panel-client.js） | `sidebar.footer.action` 槽位 | 🟡 中 | 槽位名是否变 |
| `@lansi-ai/dsh-desktop-cmdpalette`（禁用壳） | 官方运行时导航、`ctx.sessions`/`workspaces` | 🟢 低 | 禁用壳下无功能风险；仅作入口隐藏，恢复时才核查 |
| `@lansi-ai/dsh-desktop-audit-viewer`（desktop-audit-viewer-client.js） | 审计 Tab 槽位、`ctx.desktop` | 🟡 中 | 审计槽位是否变；ctx.desktop 聚合服务是否仍供桌面能力 |

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

