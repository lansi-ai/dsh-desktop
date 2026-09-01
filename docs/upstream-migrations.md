# Upstream 同步与拴合面迁移登记表（sync-upstream · ADR-005）

> 基线版本：**`dsh-v0.1.0-rc.8`**（本地检出 `_harness-src`，commit `141eb6f`，2026-08-25 决策 D-4 修订）
> **升级目标（2026-09-01 事实刷新）：`dsh-v0.1.1-rc.2`**（npm `latest`/`next` 与 GitHub Latest 一致；同版本号的 `dsh-app-boot`/`dsh-web-app`/`dsh-web-frontend` 均已发布，可 4 包对齐）。文档旧载「rc.12」系早期调查臆测项——npm/GitHub 均无 `0.1.0-rc.12`，真实最新稳定为 `0.1.1-rc.2`（`0.1.2-alpha.3` 为实验性，不作基线）。该版本 3 类拴合面 diff 已完成并登记于「C. 升级核查」。
> 本表随每次上游基线升级滚动更新；升级时必须逐行核对「3 类拴合面」，未核对完不得宣告升级完成。

## A. 3 类拴合面（耦合收敛的唯一依据）

| # | 拴合面 | rc.8 事实（已复核） | 桌面侧动作 | 迁移风险 |
| --- | --- | --- | --- | --- |
| S1 | **装载协议面** · `BootSeams` | `packages/client/web/src/boot.ts:19`：`BootSeams = Pick<ClientModuleCreateOptions, 'loadBundle'>`，官方 README 明示「为外部 `<script>` 执行无法到达页面上下文的环境（即 file:// 加载场景）转发 loadBundle】 | 方案 B：`BootSeams.loadBundle` 覆写（零端口 spike 备选） | 结构变更即破坏 dist 装载 |
| S2 | **IPC 载波面** · `WebApiClient` | `packages/client/connection/src/client/web-api-client.ts:13`：`class WebApiClient extends AbstractApiClient`；下行走 WebSocket（`openMux`/`openHost` 已覆写），dist 内 `new WebApiClient()` 硬编码 | roster/manifest 覆盖 `connection`/`client-runtime` 行为 IPC 变体（覆写 `doFetch`+`openMux`+`openHost`+rpc 四件套），**不改 dist** | 帧模型/rpcId 变更即破坏载波 |
| S3 | **装配 profile 面** · `dsh-app-boot` | `packages/boot/app-boot/`（`dsh --profile headless` 亦由 CLI 装配）；desktop profile 叠加于 base + web-app 之上 | `boot()` 装配 desktop profile：禁 `webserver`/`web-runtime` 行，供 `ctx.desktop.*` 服务 | profile 语义变更即破坏装配 |
| S3b | **client-runtime roster** | `packages/client/runtime/`；装配顺序测试见 `apps/web/tests/assembled-boot.ts:202`（`dsh-client-modules` + `dsh-client-runtime`） | roster/manifest（`__DSH_BOOT__` 由 desktop-runtime 供给）挂载 IPC 载波变体 | 包名/导出变更即破坏 manifest |

> 原则：除上述 3 类文件（+S3b 的 roster/manifest）外，升级 diff 一律**不落在桌面仓库**；
> 官方 dist 构建脚本锁定 tag，任何 diff 若超出 S1–S3 范围，先按 ADR-005 升级流程审查再落盘。

## B. patch-invariants 差集基线（desktop profile 相对 web-app 的改行清单）

desktop profile 相对官方 web-app 的预期差集**必须全部落入 S1–S3 窗口**，逐行登记如下（步骤 3 装配实现时逐行勾销，并落 `tests/patch-invariants.spec.ts` 断言）：

| 改点 | 拴合面 | 目标行/结构 | 断言行计划 |
| --- | --- | --- | --- |
| 禁用 `webserver` 行 | S3 | desktop profile 的 cordis 配置 | 断言 webServer 未实例化（无监听） |
| 禁用 `web-runtime` 行 | S3 | 同上 | 断言连接层走 IPC 变体（无 WS 直连） |
| `connection` RPC 行为 → IPC | S2 | `openMux`/`openHost`/`doFetch`/rpc 覆写 | 断言请求经 `ipcRenderer.invoke` 出站 |
| `client-runtime` 下行 → 帧路由 | S2 | `webContents.send('dsh:frame')` per-window | 断言 pending 表回填、respond 配对该帧 |
| `BootSeams.loadBundle`（若方案 B） | S1 | 覆写为 `dsh-ui://plugins/<id>/client.js?rev=` | 断言第三方 web 插件 bundle 可装载（不改 dist） |

验证命令：`netstat -ano | findstr LISTENING` 无 308x；`npm run dev` 官方 UI 可对话。
基线版本锚：以上断言以 rc.8 实现为准；升级时按「C」流程重跑 diff 并更新断言行。

## C. 升级核查（rc.8 → 0.1.1-rc.2）

> **2026-09-01 已完成 rc.8↔0.1.1-rc.2 3 类拴合面逐行 diff**（源码：`_harness-011rc2` worktree HEAD `b150a551b`）。结论：**无破坏性变更**，桌面侧零适配即可升级。逐行结论如下。

| 拴合面 | rc.8 → 0.1.1-rc.2 diff 结论 | 桌面侧影响 | 迁移风险 |
| --- | --- | --- | --- |
| S1 · 装载协议 (`web/src/boot.ts`) | 纯增量：新增可选全局 `__DSH_TRANSPORT__.loadBundle`（transport 优先，`this.seams` 仍兜底）；桌面不设 `__DSH_TRANSPORT__`，`BootSeams.loadBundle` 路径不变 | 无 | 🟢 低 |
| S2 · IPC 载波 (`client-connection`) | `web-api-client.ts`（AbstractApiClient 基类）**零差异**；`index.ts`/`rpc.ts` 仅参数化新增 `ClientTransportHooks` + `RpcFetch`（`createWebConnectionRpc(fetch?)` 可注入），默认仍 `globalThis.fetch`；export `./client`/`./src/*` 面一致；http-bridge 上限 160MiB→300MiB | ipc-connection.js 继承基类路径不受影响 | 🟢 低（非破坏） |
| S3 · 装配 profile (`app-boot`) | 仅 package.json 版本号 + README 变更，无 profile 语义差异 | 无 | 🟢 低 |
| S3b · roster/manifest (`client-modules`/`runtime`) | `WebBootGraph`（manifest.ts）**零差异**；`modules/index.ts` 重构图：`injectBootManifest(html)→bootInjections(graph)` 注入链改为 `ctx.on('webserver/index-inject')` 表。桌面为**零端口自研注入**（dsh-ui-protocol.ts `injectBootManifest`），不消费官方 tapIndex/index-inject 链 | 桌面自研注入不受影响；manifest 结构兼容 | 🟢 低 |
| 官方 ui-* 槽位包清单 (`packages/client/ui-*`) | 两版本**完全一致**：ui-layout/ui-sidebar/ui-slots 仅版本号+README；ui-primitives 仅 markdown 渲染增强；无新增/删除互斥包 | `CLIENT_EXCLUDE_IDS` 无需新增；`dsh-desktop-layout/sidebar` 消费的 root/sidebar 子槽位 + `defineStore` + `ctx.layout` 契约零差异 | 🟢 低 |
| `respond`/`approval/requested` 帧模型 | connection 包帧语义无变更（仅注入参数化） | 桌面帧路由不变 | 🟢 低 |
| `dsh-terminal` `/terminal/stream` | 本次 diff 未涉 terminal 通道 | — | 待 M4-d 实测复核 |
| dist 构建产物锁定脚本 | `dsh-web-frontend`/`dsh-web-app` 均发布 `0.1.1-rc.2`，4 包可对齐 | 升级后需截图回归 | 🟢 低 |
| 上游 `apiproxy`→`typert` 新协议面 | R20 | 新协议面 | watch |

**已更换 diff 工作区**：`E:\Projects\DSH\_harness-011rc2`（tag `dsh-v0.1.1-rc.2`，HEAD `b150a551b`），与 rc.8 检出 `_harness-src` 并行对比。升级执行时可直接复用此 worktree。

### C-1 预评估：`0.1.2-alpha.3`（2026-09-01，仅只读评估 · 未列入升级计划）

> **结论：不选 `0.1.2-alpha.3`，维持计划基线 `0.1.1-rc.2`。** 依据 = 官方未转正（npm `latest`/`next` 仍指 `0.1.1-rc.2`）+ 对桌面为**破坏性升级**。评估用的 worktree `_harness-012a3`（HEAD `dd6322d60`）可复用，待官方转 rc/稳定 后再按 ADR-005 重跑。

| 拴合面 | 0.1.1-rc.2 → 0.1.2-alpha.3 diff | 桌面影响 | 迁移风险 |
|---|---|---|---|
| S2 · IPC 载波 (`client-connection`) | **破坏性**：`web-api-client.ts` 删除、`AbstractApiClient`/`WebApiClient` 彻底不存在；connection 重构为 `ctx.provide('connection', handle)` + **API Gateway 拥有连接循环**；`ClientTransportHooks` 契约变（`fetch` 语义变 + 新增 `openStream`/`ownsHost`） | `ipc-connection.js` 继承基类路径无存，载波需整条重写；`__DSH_TRANSPORT__` 注入面要重对 | 🔴 高 |
| S3b · roster/runtime (`client-modules`/`runtime`) | **破坏性**：runtime 大规模重组，`sessions/manager(1131)/service/session/conversation-assembler`、`workspaces/*`、`contract/store` 等 ~20 文件删除（净 -7000 行），store 拆到新包 `dsh-client-store`；modules 注入重构 | manifest/装配契约大变；`seed.ts` 新增 `@deepseek-ai/dsh-client-store` 静态模块 | 🔴 高 |
| S1 · 装载协议 (`web/src/boot.ts`) | 新增 **`__DSH_BOOT_READY__` 启动就绪门控**（boot 等待注入表生效）；prefetch 不再读 `__DSH_TRANSPORT__.loadBundle` | 桌面 boot 注入需补就绪门控对接 | 🟡 中 |
| ui-slots / ui-layout / ui-sidebar | `ui-slots` store.ts/renderer.ts、`ui-sidebar` SidebarRoot、`ui-layout` AppFrame/DocumentTitle/theme-presenter 均改 | 自绘插件（layout/sidebar/titlebar）拴合面需逐条重对 | 🟡 中 |
| 全仓规模 | 7036 文件变化，+355K/-144K（含大量测试快照/构建基建重构） | — | 🔴 高 |

**桌面侧追加适配清单（若未来选 0.1.2）**：① 重写载波（不再有 AbstractApiClient，改用 `__DSH_TRANSPORT__` + API Gateway 连接面）；② 重对 client-runtime 的 manifest/装配契约 + 补 `dsh-client-store` 静态注册；③ 补 `__DSH_BOOT_READY__` 就绪门控；④ 自绘插件契约全量重核对。因当前 M6 自绘主线 + 无开版需求，暂不投入。

#### C-1a 否决理由（为什么维持 `0.1.1-rc.2`，不选 `0.1.2-alpha.3`）

| # | 理由 | 说明 | 对应事实 |
|---|---|---|---|
| R1 | **官方未把它当稳定基线** | `0.1.2-alpha.3` 在 npm 上只挂 `alpha` 标签，`latest`/`next` 仍指 `0.1.1-rc.2` —— 官方自己都没转正，说明仍在实验迭代、破坏性变更随时可能再来。我们按 ADR-005 只认一个稳定基线，不踩 alpha 试错线 | dist-tags: `{alpha: 0.1.2-alpha.3, latest/next: 0.1.1-rc.2}` |
| R2 | **对桌面是破坏性升级，非增量补丁** | 本次不是「打的补丁多了点」，而是**核心传输层整体重构**：桌面包的载波基类 `AbstractApiClient` 被删、需整条重写；runtime 净删约 7000 行、清单/装配契约全变。这意味着要重做适配层，不是升级几个版本号 | S2/S3b：`web-api-client.ts` 删除 + runtime 大规模删除文件 |
| R3 | **与我们当前主线（M6 自绘 UI）直接冲突** | M6 正在把官方 `ui-*` 逐个换成自研插件（layout/sidebar/titlebar 已落地）。`0.1.2` 把 ui-slots/layout/sidebar 契约也改了，若现在升，会迫使已上线的自研插件全部重对契约、打断 D-20 自绘主线 | ui-slots store/renderer、SidebarRoot、AppFrame 均变更 |
| R4 | **收益不明确、风险即时兑现** | `0.1.2` 相对 `0.1.1-rc.2` 的发布说明主要是体验优化（image upload 相关），无当前项目缺失的关键能力；而破坏性适配成本高、与主线冲突大、「先升再说」违背可回滚原则 | 对照 0.1.2 release notes + ADR-005 原则 |

> **维持决策后的行动**：继续按 M4-d2 计划升 `0.1.1-rc.2`（已验证零适配）；`0.1.2-alpha.3` 留待官方转 `rc`/`stable`（`next` 指向它）或 M4-d 后续轮次再评估，届时以官方转正版本重新执行 ADR-005 diff（worktree `_harness-012a3` 已备好）。

## D. sync-upstream SOP（升级一次跑一遍）

1. `git diff` 上游基线区间 → 逐文件归类到 S1/S2/S3(含 S3b) 或「其他」；
2. 「其他」类：不进桌面仓库，审查是否需台账记录；
3. S1–S3 逐行对照：更新本表 A/B 区 + 重跑 `tests/patch-invariants.spec.ts` 断言；
4. 按 `workflow.md` 场景 D（上游基线变更）更新规则链并将版本升级登记到 12-references；
5. commit：`build(upstream): 同步 dsh-v0.1.0-<ver> 拴合面 diff 迁移登记`。