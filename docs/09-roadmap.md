# 09 · 里程碑路线图

> 目标：**M3 结束 = 可天天用的个人工具**；M5 = 可分发。总工期预估（单人主力 + 零碎协作）：M1–M3 约 6–8 周，M4–M5 约 4–6 周。

## M0 · 设计与验证（本文档集 · 已完成/进行中）
- 交付：本 `docs/`（调研、路线、架构、插件设计、安全、ADR）
- **基线（2026-08-25 决策）**：钉本地检出 `dsh-v0.1.0-rc.8`（**2026-09-01 实测上游最新稳定为 `0.1.1-rc.2`**，差异登记 sync-upstream）；**2026-09-01 已按 M4-d3 实际升级采用 `0.1.2-alpha.3`**（破坏性载波重写，见 `m4-d3-012-alpha3-migration-plan.md`）

## M1 · 桌面骨架（"能打开官方 UI 并对话"）—— 门槛里程碑
目标：Electron 壳 + 内嵌 Host + **官方 UI dist 原样呈现** + IPC 传输 + **第三方 web 插件无改动装载**。

| 任务 | 说明 | 验收 |
| --- | --- | --- |
| T1 装配原型 | `shell/main.ts` 用 `dsh-app-boot.boot()` 装 web profile（复用 base+web-app），`prepare` 供给 desktop 服务 | 启动无端口无浏览器，日志显示 tree settled |
| T2 dist 到达 | `dsh-ui://` 协议加载 `dsh-web-frontend` dist；`__DSH_BOOT__` 注入 | UI 完整渲染（loading 页→真 UI） |
| T3 IPC 载波 | `AbstractApiClient` 子类（IPC fetch）+ preload 桥 + 帧下行 | 输入→模型回复→轨迹 tab 正常；审批/问答帧可达（PendingCard 显示） |
| T4 零端口 bundle | spike 定案：`dsh-ui://plugins/...` 协议直读 vs `BootSeams.loadBundle` | `dsh-rule-manager`、`dsh-terminal` client 半无改动装载可见 |
| T5 旧插件 fetch 拦截 | `/terminal/run`、`/rules/*` 等旧插件同源 fetch 经桥拦截到 desktopRoutes | 旧插件 host 半+client 半全链可用 |
| T6 零端口验证 | 重启后 `netstat` 无监听；关窗驻留可用 | R-03/R-05 达标 |
| T7 崩溃恢复初版 | `desktop-host-restart`：宿主崩溃→错误页→relaunch→会话历史重建 | 杀掉宿主进程后 5s 内恢复可见会话 |
| 门禁 | 全量回归：与 Web 面功能一致性抽查清单（对话/轨迹/设置/插件/技能） | 无 P0 缺口 |

## M2 · 桌面能力插件化（P0 桌面功能 + 旧插件保命）
| 任务 | 验收 |
| --- | --- |
| desktop-host-core + desktop-api | `ctx.desktop` 具备、`desktop/action` 审计落地 |
| desktop-host-runtime / compat | IPC 桥宿主端稳定；多窗口载波注册表；desktopRoutes 等价面 + 零端口 bundle 服务就绪 |
| 旧插件兼容验证 | `dsh-rule-manager`、`dsh-terminal`、`dsh-restart`：host 半零改动可用；client 半经 bundle 服务 + fetch 拦截可用（ADR-007 验收矩阵） |
| desktop-host-tray | 托盘：会话列表/快速问答/状态/退出；关窗驻留 |
| desktop-host-notifications | 完成/审批/错误三类通知 + 点击定位会话 |
| desktop-host-shortcuts | 全局热键唤出快速问答（默认 Ctrl+Shift+Space） |
| desktop-host-clipboard | 写审批链路（approval waterfall）e2e |
| desktop-client-settings / panel | 官方 UI 注入桌面设置卡 + 侧栏「桌面」面板 |
| 门禁 | 桌面能力全部可 `dsh plugin` 列表可见、可 patch 关闭、卸载无残留 |

## M3 · 多窗口与深度交互（P1 前半）—— 2026-08-26 启动
**推进节奏：分两波 —— M3-a（多窗口 + 命令面板）→ M3-b（协议 + 审计 + 自启）**

### M3-a 第一波：多窗口 + 命令面板
| 任务 | 子项 | 验收 |
| --- | --- | --- |
| M3-a1 窗口管理器基建 | WindowManager 单例（窗口注册表 + 会话绑定 + 创建/销毁/聚焦 API）；`types/window.ts` zod 契约；多窗口 IPC 通道；preload 白名单扩展；main.ts bootstrap 集成 | typecheck + lint 零错误 |
| M3-a2 会话独立窗口 | 新建窗口（renderer→主进程→新 BrowserWindow→dsh-ui:// + 会话上下文）；独立 IPC 载波路由（per-window carrier-relay）；窗口会话同步广播；窗口崩溃恢复；窗口间切换 | 3+ 窗口独立对话 + 同步 + 恢复 |
| M3-a3 窗口状态持久化 | 位置/大小持久化到 settings-file；会话绑定持久化（重启恢复）；Z-order 记忆 | 重启后窗口状态恢复 |
| M3-a4 命令面板（Ctrl+K 混合方案） | renderer 内 Ctrl+K 面板（会话/插件/设置）+ desktop-cmdpalette-client.js 注入；主进程全局 Ctrl+Shift+P 快速提问悬浮窗；desktop-cmdpalette.ts host 插件；preload 白名单；boot-graph 图谱注入 | Ctrl+K 切换会话 + Ctrl+Shift+P 唤起提问 |
| M3-a5 M3-a 门禁 | 多窗口实机验证 + 命令面板冒烟 | Dogfood 启动：日常使用 |

### M3-b 第二波：协议 + 审计 + 自启
| 任务 | 子项 | 验收 |
| --- | --- | --- |
| M3-b1 dsh:// 系统协议 | 协议注册 + Windows 注册表关联；open/ask/settings 三个 action；窗口去重聚焦；dsh-protocol.ts 路由 | 浏览器/命令行 dsh:// 唤起工作 |
| M3-b2 会话审计查询工具 | 审计日志查看器 UI（槽位注入）；desktop-audit-viewer.ts 服务（读取+过滤+分页）；desktop:event + Host 全链路 | 审计 Tab 可过滤查看 |
| M3-b3 开机自启 | 设置开关（desktop-settings 注入）；Windows setLoginItemSettings；配置持久化 | 设置开关生效 |
| M3-b4 M3 门禁 | 完整 dogfood 验收 + 全量回归 + netstat 零监听再验证 | **2 周无浏览器** + 崩溃恢复测试 |

**关键决策（M3 新增）：**
- D-9 多窗口 = 每个会话独立 BrowserWindow（非 Tab），窗口间广播帧同步
- D-10 命令面板 = 混合方案（renderer Ctrl+K + 主进程 Ctrl+Shift+P）
- D-11 dsh:// 协议 MVP = 全覆盖（open + ask + settings），窗口去重聚焦
- D-12 Dogfood = M3-a 完成后即启动，不等全量

**风险：**
- R9 多窗口资源开销：3+ 窗口常驻内存 ≤ 400MB（M5 性能项验证）
- R10 协议安全：dsh:// 协议需校验来源，防恶意链接（M3-b 加白名单）
- **门禁：日常使用 2 周无浏览器**（自用 dogfood）

## M4 · 分发与更新（P1 后半）
- electron-builder 三平台安装包（Win 首发）+ 便携包 + `SHA256SUMS`
- 零外部 Node/pnpm 依赖验证（全新 Win10 x64 机器安装即用）
- 自动更新：描述符/校验/回滚/stable-rc-off 通道
- 离线启动路径（网络不可用时的 UI 与历史）e2e
- **门禁：发布一个 rc 安装包，外部使用者（≥3 人）安装即用无环境报错**

## M5 · 加固与打磨（P1 收尾 + P2 起步）
- Windows 代码签名 / mac notarization（如扩展 mac）
- 性能达标（冷启动 ≤3s、常驻 ≤400MB 实测表）
- 本地用量看板（session-telemetry-otel 物化，R-22）
- 主题化（ui-theme token 覆盖，R-21）
- 可选：桌面工具 `desktop_*`（默认关）

## M6 · 增强与自绘面（探索期，P2）
- **harness 基线动态化（2026-08-26 新增，依赖 M4-b 更新基建）**：基线产物外置至 `userData/harness/<version>/` 版本化目录 + S1/S2/S3 拴合面兼容矩阵协商（版本声明契约 + 桌面侧 adapter 注册表）+ 复用 M4-b 描述符机制下载校验（manifest + SHA256）+ 多版本并存与启动失败自动回滚；门禁 = 应用内完成 `rc.8 → 0.1.1-rc.2` 切换（不重装应用、会话数据无损）。M4-d 首次 `0.1.1-rc.2` 升级仍走整包重发（sync-upstream SOP），作为动态化的对照基线
- 文件拖放/关联（R-14）、Git 集成面（R-23）、TTS（R-24）
- 自绘主面评估（[`13-ui-design.md`](13-ui-design.md)、[ADR-006](adr/adr-006-custom-ui.md)——本期暂缓，若要切：
  宿主与协议不变，切 renderer 为自研 UI + 官方 UI 降为兼容窗口）
- 稳定化：插件签名校验、多窗口测试矩阵扩充

## 持续任务（贯穿）
- **同步上游**：每个 rc 发布 → `sync-upstream` → 破坏性变更迁移登记（ADR-005）→ 回归
- **测试**：单测（desktop-api/bridge）、组件（client 插件，`?fixture`）、e2e（Playwright + Electron）
- **安全评审**：按 `08-security.md §8` 清单每里程碑走一遍
- **文档同步**：本篇与 ADR 随实现更新；「已实现/已否决」标注制

## 关键依赖与前置
| 依赖 | 阻塞 | 缓解 |
| --- | --- | --- |
| 上游 dist 构建产物可复用 | M1-T2 | 若上游 release 构件不含 dist，自建构建脚本（锁定 pnpm 版本+上游 tag） |
| 零端口 bundle 方案可行 | M1-T4 | 两案并行 spike（dsh-ui:// 协议 / BootSeams），2 天内出结论，最坏回退：桌面暂不装第三方 client 插件（仅官方 roster）并单开 issue 上游 |
| 旧插件 fetch 拦截语义 | M1-T5 | preload `window.fetch` hook 拦截已注册路径；未注册路径一律报错；最坏回退 `--serve`（loopback） |
| Windows toast 在未签名 dev 下可用 | M2 通知 | 用 tray 气泡兜底（dev），签名后 toast 全量 |
| 审批帧 wire（`respond` 是否 stub） | M1-T3 | 官方当前为 stub（`always not-pending`）——**必须先确认**；若未实现，桌面侧先做「展示态 + 本机确认入口」绕过（见 ADR-003 风险表） |