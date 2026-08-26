# Upstream 同步与拴合面迁移登记表（sync-upstream · ADR-005）

> 基线版本：**`dsh-v0.1.0-rc.8`**（本地检出 `_harness-src`，commit `141eb6f`，2026-08-25 决策 D-4 修订）
> GitHub Latest（rc.12）差异登记于「C. 升级核查」区，**M4 升级前**统一 diff 核查。
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

## C. 升级核查（rc.8 → 未来版本）

| 待办 | 归属 | 触发器 | 状态 |
| --- | --- | --- | --- |
| rc.8 ↔ rc.12 差异 diff（S1/S2/S3 逐行） | ADR-005 | M4 升级前 | pending（登记于 11-risks R19） |
| `respond`/`approval/requested` 帧模型是否变更 | S2 | 同 diff | pending |
| `dsh-terminal` `/terminal/stream` 是否新增并存 `/terminal/run` 移除 | 兼容面 | 同 diff | pending |
| dist 构建产物锁定脚本是否随版本漂移 | S3b | 同 diff | pending |
| 上游迁移 `apiproxy`→`typert` 等新协议面 | R20 | 上游公告 | watch |

## D. sync-upstream SOP（升级一次跑一遍）

1. `git diff` 上游基线区间 → 逐文件归类到 S1/S2/S3(含 S3b) 或「其他」；
2. 「其他」类：不进桌面仓库，审查是否需台账记录；
3. S1–S3 逐行对照：更新本表 A/B 区 + 重跑 `tests/patch-invariants.spec.ts` 断言；
4. 按 `workflow.md` 场景 D（上游基线变更）更新规则链并将版本升级登记到 12-references；
5. commit：`build(upstream): 同步 dsh-v0.1.0-<ver> 拴合面 diff 迁移登记`。