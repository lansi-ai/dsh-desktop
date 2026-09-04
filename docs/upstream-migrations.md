# Upstream 同步与拴合面迁移登记表（sync-upstream · ADR-005）

> 基线版本：**已升级至 `dsh-v0.1.2-rc.1`**（2026-09-04 自动工具执行，详见「C-4」；**首次跨线升至 `next` 稳定线**；前基线 `0.1.2-alpha.5` 由 2026-09-03 C-3 自动升级；再前 `0.1.2-alpha.4` 由 2026-09-02 C-2 升级；旧基线 `dsh-v0.1.0-rc.8` 检出 `_harness-src`，commit `141eb6f`，2026-08-25 决策 D-4 修订）
> **升级目标（2026-09-01 事实刷新）：`dsh-v0.1.1-rc.2`** 为官方 `latest`/`next` 稳定基线；文档旧载「rc.12」系早期调查臆测项——npm/GitHub 均无 `0.1.0-rc.12`。`0.1.2-alpha.3` 为官方实验性版本，**虽非官方转正基线，但已由桌面按 M4-d3 专项实际升级采用**（用户决策，推翻 C-1 预评估「不选」结论）。该两版本 3 类拴合面 diff 均已登记于「C. 升级核查」与「C-1」。
> **2026-09-04 事实刷新**：官方 `next` 线已推进至 `dsh-v0.1.2-rc.1`（`latest` 仍为 `0.1.1-rc.2`，四包 `next` 标签全部对齐），0.1.2 系列由此转正进入 rc 阶段；桌面已按 C-4 自动升级至该基线。
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

### C-1 预评估：`0.1.2-alpha.3`（2026-09-01 只读评估 → **2026-09-01 已按 M4-d3 执行升级**）

> **预评估结论：不选 `0.1.2-alpha.3`，维持 `0.1.1-rc.2`**（依据 = 官方未转正 + 破坏性升级）。**该结论已被用户决策推翻（2026-09-01）**：M4-d3 实际执行 0.1.2 升级专项，桌面按官方 worker-preview 自持传输形态整链迁移（方案见 `docs/m4-d3-012-alpha3-migration-plan.md`），实机验证全链路可用。本区差异表仍作为迁移依据保留。

| 拴合面 | 0.1.1-rc.2 → 0.1.2-alpha.3 diff | 桌面影响 | 迁移风险 |
|---|---|---|---|
| S2 · IPC 载波 (`client-connection`) | **破坏性**：`web-api-client.ts` 删除、`AbstractApiClient`/`WebApiClient` 彻底不存在；connection 重构为 `ctx.provide('connection', handle)` + **API Gateway 拥有连接循环**；`ClientTransportHooks` 契约变（`fetch` 语义变 + 新增 `openStream`/`ownsHost`） | `ipc-connection.js` 继承基类路径无存，载波需整条重写；`__DSH_TRANSPORT__` 注入面要重对 | 🔴 高 |
| S3b · roster/runtime (`client-modules`/`runtime`) | **破坏性**：runtime 大规模重组，`sessions/manager(1131)/service/session/conversation-assembler`、`workspaces/*`、`contract/store` 等 ~20 文件删除（净 -7000 行），store 拆到新包 `dsh-client-store`；modules 注入重构 | manifest/装配契约大变；`seed.ts` 新增 `@deepseek-ai/dsh-client-store` 静态模块 | 🔴 高 |
| S1 · 装载协议 (`web/src/boot.ts`) | 新增 **`__DSH_BOOT_READY__` 启动就绪门控**（boot 等待注入表生效）；prefetch 不再读 `__DSH_TRANSPORT__.loadBundle` | 桌面 boot 注入需补就绪门控对接 | 🟡 中 |
| ui-slots / ui-layout / ui-sidebar | `ui-slots` store.ts/renderer.ts、`ui-sidebar` SidebarRoot、`ui-layout` AppFrame/DocumentTitle/theme-presenter 均改 | 自绘插件（layout/sidebar/titlebar）拴合面需逐条重对 | 🟡 中 |
| 全仓规模 | 7036 文件变化，+355K/-144K（含大量测试快照/构建基建重构） | — | 🔴 高 |

**桌面侧适配清单（已按 M4-d3 执行，2026-09-01）**：① 重写载波（不再有 AbstractApiClient，改用 `__DSH_TRANSPORT__` + API Gateway 连接面）——`ipc-connection.js` 弃继承，HTML boot 脚本注入 `__DSH_TRANSPORT__ = {fetch, openStream, ownsHost:true}`；② 重对 client-runtime 的 manifest/装配契约 + 补 `dsh-client-store` 静态注册——`boot-graph.ts` 产 `WebBootGraph{rev,entries,batches}`、`dsh-client-modules` 替代 `client-runtime`、store 由官方 dist 内核 seed；③ 补 `__DSH_BOOT_READY__` 就绪门控；④ 自绘插件契约全量重核对——`defineStore` 迁 `dsh-client-store`、external 对齐 `ui-renderer`、AppFrame 补 `SessionProvider`。实机验证全链路可用。

#### C-1a 否决理由（预评估时维持 `0.1.1-rc.2` 的理由 · **已执行后作历史记录**）

| # | 理由 | 说明 | 对应事实 |
|---|---|---|---|
| R1 | **官方未把它当稳定基线** | `0.1.2-alpha.3` 在 npm 上只挂 `alpha` 标签，`latest`/`next` 仍指 `0.1.1-rc.2` —— 官方自己都没转正，说明仍在实验迭代、破坏性变更随时可能再来。我们按 ADR-005 只认一个稳定基线，不踩 alpha 试错线 | dist-tags: `{alpha: 0.1.2-alpha.3, latest/next: 0.1.1-rc.2}` |
| R2 | **对桌面是破坏性升级，非增量补丁** | 本次不是「打的补丁多了点」，而是**核心传输层整体重构**：桌面包的载波基类 `AbstractApiClient` 被删、需整条重写；runtime 净删约 7000 行、清单/装配契约全变。这意味着要重做适配层，不是升级几个版本号 | S2/S3b：`web-api-client.ts` 删除 + runtime 大规模删除文件 |
| R3 | **与我们当前主线（M6 自绘 UI）直接冲突** | M6 正在把官方 `ui-*` 逐个换成自研插件（layout/sidebar/titlebar 已落地）。`0.1.2` 把 ui-slots/layout/sidebar 契约也改了，若现在升，会迫使已上线的自研插件全部重对契约、打断 D-20 自绘主线 | ui-slots store/renderer、SidebarRoot、AppFrame 均变更 |
| R4 | **收益不明确、风险即时兑现** | `0.1.2` 相对 `0.1.1-rc.2` 的发布说明主要是体验优化（image upload 相关），无当前项目缺失的关键能力；而破坏性适配成本高、与主线冲突大、「先升再说」违背可回滚原则 | 对照 0.1.2 release notes + ADR-005 原则 |

> **预评估后的行动（历史）**：原计划按 M4-d2 升 `0.1.1-rc.2`；`0.1.2-alpha.3` 留待官方转正再评估。**该行动已被用户决策改写（2026-09-01）：直接执行 M4-d3 升 `0.1.2-alpha.3`**（详见 M4-d3 看板 + `docs/m4-d3-012-alpha3-migration-plan.md`）。C-1 差异表（含本 C-1a 否决理由）作为迁移依据与历史记录保留。

### C-2 升级核查：`0.1.2-alpha.3` → `0.1.2-alpha.4`（2026-09-02 执行完成 · 无破坏性变更）

> **结论：桌面零适配直接升级**（仅 package.json 四包版本号 + lockfile）。diff 工作区 = 浅克隆 tag 快照（`desktop/.tmp-harness-012a4`，commit `4e84901`，diff 完毕已删除；标准 worktree `_harness-012a4` 可按需重建）。全仓 2397 文件变更，大头为 `invariant.ts` 样板删除 + tsconfig/README 噪声，实质变更聚焦 session 域内部重构与 ui-* CSS 打磨。

| 拴合面 | alpha.3 → alpha.4 diff 结论 | 桌面影响 | 迁移风险 |
| --- | --- | --- | --- |
| S1 · 装载协议 (`web/src/boot.ts` + `__DSH_BOOT_READY__`) | **零差异**（`apps/web` 仅 tests 变更；`dsh-client-web` 仅 boot-page CSS） | 无 | 🟢 低 |
| S2 · IPC 载波 (`client-connection` + api gateway/remotes) | `client/connection` 主源码零实质变更（仅 fixture/invariant 样板）；`api/gateway`、`api/remotes`、`workspace/settings-controller` 仅构建配置变更。`__DSH_TRANSPORT__` 契约不变 | 载波零改动 | 🟢 低 |
| S3/S3b · 装配 profile (`app-boot`) + roster/manifest (`client-modules`) | `dsh-app-boot` 仅 tsdown/样板变更；`client/modules` 仅版本号。`__DSH_BOOT__` 图谱格式、PLATFORM_MODULES seed 不变 | 装配零改动 | 🟢 低 |
| **session 域内部重构**（`core/session` +785/-401、`api/session-controller`） | 官方 release 注明两项：① `Session.events` 数组 → 按需读取 API（`seq`/`eventAt()`/`snapshotEvents()`）；② `SessionSeq`/`SessionLogOffset` 品牌强类型拆分。**全部为 host 内部实现**，随 npm 包整体升级封装；wire 契约仅类型层（`SessionSeq` 运行时仍 number、`SessionWireSurfaceOp` 与旧 `SurfaceOp` 变体完全一致 = `append \| {op:'replace',start,end}`）；`session.list`/`session.create`/`session.control` 端点与参数签名未动 | session-rewarm（wire 消费）不受影响；桌面源码无 `.events`/`SessionSeq` 直接消费 | 🟢 低（官方提示开发者关注兼容性，已核对） |
| ui-* 包清单 | 与 alpha.3 **完全一致**，零增删 | `CLIENT_EXCLUDE_IDS` 无需新增 | 🟢 低 |
| ui-slots / ui-renderer | **增量式**：新增可选 `keyedHooks` 隔间（`KeyedHooksSources`/`KeyedSnapshotSelectorHook`）+ `bindInjectSources` 对其绑定；既有 `hooks` 契约与 `SessionProvider`/scoped slots 语义不变 | 自研 layout/sidebar/titlebar 零改动 | 🟢 低 |
| ui-theme | `ctx.theme` API 不变；新增 `corner-shape.css`/`gradient-shadow-text.css` 样式注入（官方「圆角、描边、投影」打磨） | ThemePresenter 等价面零改动 | 🟢 低 |
| 其余 ui-*（chat/conversation/tool/trajectory 等） | CSS 打磨 + 内部重构（deliverables/trajectory 内聚），槽位契约未变 | 官方 UI dist 整体受益，无适配 | 🟢 低 |
| dist 构建产物 | `dsh-web-frontend`/`dsh-web-app` 发布 `0.1.2-alpha.4`，4 包 npm 可对齐；`index.html` 结构未变 | dsh-ui-protocol 注入点稳定 | 🟢 低 |
| 行为面（非代码） | 官方 release：父/子 Agent `send_message` 双向消息取代单向 `report`；Web PTC 默认撤下通用 `workflow` 工具；Python SDK/Headless/ACP/自定义 Profile 默认启用 `web_fetch` | **实机启动失败一处（已修）**：`send_message` 取代 `report` 后，官方未再发布独立包 `@deepseek-ai/dsh-tool-subagent-report`（npm 最高 alpha.3，**漏发 alpha.4**），新工具并入 `dsh-tool-subagent` 本体——桌面 roster（boot.ts + desktop-patch.yml 两处同源）残留 `tool-subagent-report` 条目致 loader import 失败 → 条目移除（对齐官方 web-app roster），typecheck/lint/build 复验零错误 | 🟡 中（已收口） |

**验证记录（2026-09-02）**：`npm install` 成功（四包对齐 `0.1.2-alpha.4`）；`npm run typecheck` 零错误；`npm run lint` 零告警；`npm run build` 成功。**实机首启暴露 1 处 roster 残留**（上行为面行，tool-subagent-report 条目移除后收口）；roster 全量 99 引用/97 包存在性 + 版本核对通过。实机对话冒烟待做（与 M3-b4 dogfood 合并观察）。

### C-3 升级核查：`0.1.2-alpha.4` → `0.1.2-alpha.5`（2026-09-03 自动执行 · 无破坏性变更）

> **结论：桌面零适配直接升级**（`scripts/upstream.cjs` 自动评估判定 safe）。拴合面 4 面 + ui-* 槽位契约零差异，roster 92 包全部存在，官方 web-app roster 包集无新增/删除。升级过程自动化工具完成（bump 30 依赖 + install + typecheck/lint/build + 本登记）。

| 拴合面 | alpha.4 → alpha.5 diff 结论 | 桌面影响 | 迁移风险 |
| --- | --- | --- | --- |
| S1 · 装载协议面 | 零差异 | 无 | 🟢 低 |
| S2 · IPC 载波面 | 零差异 | 无 | 🟢 低 |
| S3 · 装配 profile 面 | 零差异 | 无 | 🟢 低 |
| S3b · roster/manifest 面 | 零差异 | 无 | 🟢 低 |
| ui-* 槽位契约 | 零差异 | 无 | 🟢 低 |
| roster 包存在性（92 包） | 全部存在 | 无 | 🟢 低 |
| 官方 web-app roster 包集 | 无新增/删除 | 无 | 🟢 低 |

**验证记录（2026-09-03）**：`npm install` 成功（30 依赖升 `0.1.2-alpha.5`）；`npm run typecheck` 零错误；`npm run lint` 零告警；`npm run build` 成功。实机冒烟待做（与 M3-b4 dogfood 合并观察）。

## D. sync-upstream SOP（升级一次跑一遍）

1. `git diff` 上游基线区间 → 逐文件归类到 S1/S2/S3(含 S3b) 或「其他」；
2. 「其他」类：不进桌面仓库，审查是否需台账记录；
3. S1–S3 逐行对照：更新本表 A/B 区 + 重跑 `tests/patch-invariants.spec.ts` 断言；
4. 按 `workflow.md` 场景 D（上游基线变更）更新规则链并将版本升级登记到 12-references；
5. commit：`build(upstream): 同步 dsh-v0.1.0-<ver> 拴合面 diff 迁移登记`。

### C-4 升级核查：`0.1.2-alpha.5` → `0.1.2-rc.1`（2026-09-04 自动执行 · 无破坏性变更）

> **结论：桌面零适配直接升级**（`scripts/upstream.cjs` 自动评估）。

| 拴合面 | 0.1.2-alpha.5 → 0.1.2-rc.1 diff 结论 | 桌面影响 | 迁移风险 |
| --- | --- | --- | --- |
| S1 · 装载协议面 | 零差异 | 无 | 🟢 低 |
| S2 · IPC 载波面 | 零差异 | 无 | 🟢 低 |
| S3 · 装配 profile 面 | 零差异 | 无 | 🟢 低 |
| S3b · roster/manifest 面 | 零差异 | 无 | 🟢 低 |
| ui-* 槽位契约 | 零差异 | 无 | 🟢 低 |
| roster 包存在性（92 包） | 全部存在 | 无 | 🟢 低 |
| 官方 web-app roster 包集 | 无新增/删除 | 无 | 🟢 低 |

**验证记录（2026-09-04）**：`npm install` 成功（30 依赖对齐升 `0.1.2-rc.1`，214 包变更）；`npm run typecheck` 零错误；`npm run lint` 零告警；`npm run build` 成功。install 期 3 条 `EBADENGINE` 告警为无害项（`@earendil-works/pi-ai`、`pi-telemetry`、`undici` 要求 node ≥22.19.0，本机 22.16.0，属上游依赖的引擎声明偏严，未影响安装与构建）。
**待办**：实机冒烟随 M3-b4 dogfood 合并观察；`next` 线为首次跨线升级，重点关注官方 UI 发行物装载与 roster 装配无回归。
