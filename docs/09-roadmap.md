# 09 · 里程碑路线图

> 目标：**M3 结束 = 可天天用的个人工具**；M5 = 可分发。总工期预估（单人主力 + 零碎协作）：M1–M3 约 6–8 周，M4–M5 约 4–6 周。

## M0 · 设计与验证（本文档集 · 已完成/进行中）
- 交付：本 `docs/`（调研、路线、架构、插件设计、安全、ADR）
- **基线（2026-08-25 决策）**：钉本地检出 `dsh-v0.1.0-rc.8`（rc.12 差异登记 sync-upstream，M4 升级前核查）；待办：spike 计划（见下）

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

## M3 · 多窗口与深度交互（P1 前半）
- 会话独立窗口（拖出/新建）、窗口状态持久化、焦点跟随 agent 活动
- 命令面板（Ctrl+K：切换会话/命令/设置/插件开关）——复用官方 UI 的面板或注入
- `dsh://` 协议唤起（open/ask）→ 窗口聚焦
- 开机自启（设置开关）
- 桌面会话审计查询工具（audit.jsonl 尾部查看）
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