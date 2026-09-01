# PRD 与技术设计方案 (prd-and-design.md)

> 由 `start-project` 阶段 1 头脑风暴 Sign-off 之作（2026-08-25）汇总落盘。详细证据链见 `docs/01-research.md` ~ `docs/13-ui-design.md` 与 `docs/adr/`（本仓库设计基线，已从 `plugins/dsh-desktop/docs/` 迁入）。

## 1. 业务背景与产品定位

**dsh-desktop**：面向个人的 DeepSeek Harness 桌面客户端——本质是「把桌面操作系统变成了 Harness 的可插拔能力层」。

- **不是**：网页套壳（不依赖外置浏览器与外部 HTTP 端口，宿主内嵌、零端口）。
- **是**：与官方同内核（同一 Cordis Host 插件树、同一会话/轨迹/沙箱语义）的桌面应用，桌面特有能力全部通过官方插件机制注入。
- **产品形态**：桌面应用（Windows 优先）。

### 目标用户
1. 已将 DSH 作为日常 AI 编程/自动化工具、希望获得原生桌面体验（托盘驻留、快捷键唤出、多窗口）的开发者；
2. 现有 Web UI 用户中，期待桌面工作流（键盘优先、命令面板、信息密度）的开发者；
3. 不愿/不便配置 Node 与插件环境的普通用户（一包安装即用）；
4. 需要「后台持续运行 + 会话并行 + 系统级集成」（通知、剪贴板、文件关联）的重度用户。

## 2. 核心业务价值

| 价值主张 | 描述 |
| --- | --- |
| 零端口桌面宿主 | 默认不监听任何 HTTP 端口；renderer ↔ Host 全走 IPC 载波 |
| 官方 UI 即主面 | 复用官方 Web UI 发行物（`dsh-ui://` 内嵌），升级零移植 |
| 桌面 = 插件树 | 托盘/热键/通知均为 host 插件（`ctx.desktop.*`），可被 patch 增删 |
| 一包安装即用 | 无需 Node/pnpm/配置；同 `$DSH_HOME` 数据与 `dsh web` 无缝共享 |
| 旧插件不丢弃 | `dsh-terminal` / `dsh-rule-manager` / `dsh-restart` 零端口可用 |

## 3. 已 Sign-off 的关键决策（2026-08-25）

| # | 决策 | 结论 | 依据 |
| --- | --- | --- | --- |
| D-1 | 技术栈 | **Electron 主进程内嵌 Cordis Host**（`dsh-app-boot.boot()` 装配 desktop profile） | ADR-001 / ADR-002 |
| D-2 | 传输载波 | **IPC fetch 桥**（`ipcRenderer.invoke('dsh:rpc'/'dsh:respond')` 上行 + `webContents.send('dsh:frame')` 下行），零 HTTP/WS 端口；`--serve=<port>` 为显式兼容模式 | ADR-003 |
| D-3 | UI 主线 | **主线 = 官方 Web UI 发行物复用**（`dsh-ui://` 自定义协议加载，不修改 dist）；自绘 Desktop UI 降为 **P2 技术债**（ADR-006 启用前不投入） | 02 修订 / ADR-006 |
| D-4 | 版本基线 | 原钉 **本地检出 `dsh-v0.1.0-rc.8`**（权威事实源；**2026-09-01 实测上游最新稳定为 `0.1.1-rc.2`**，差异 diff 登记 sync-upstream 迁移表 C 区）；**2026-09-01 已按 M4-d3 实际升级采用 `0.1.2-alpha.3`**（载波整链重写，见 `m4-d3-012-alpha3-migration-plan.md`） | ADR-005 |
| D-5 | 兼容策略 | host 半 = `ctx.desktopRoutes`（webServer 等价面，零监听）；client 半 = 官方槽位注入 + fetch 拦截（白名单） | ADR-007 |
| D-6 | 里程碑基线 | M1：官方 UI 可对话 + 零端口验证 + 崩溃恢复初版；托盘/热键/通知后置 | 09-roadmap |

## 4. 权威架构事实（评审已抽查源码验证）

1. **官方 Electron 插槽**：`docs/subsystems/web-server.md` 原文「Electron loads dist over file:// and carries fetch over an IPC bridge」，与 `AbstractApiClient` 子类表（`IPC bridge subclass | an Electron shell | 只换 doFetch`）逐字对应。
2. **载波替换唯一通路（A3 澄清）**：「只换 doFetch」是抽象层说法；实际
   `WebApiClient` 下行走 WebSocket（`openMux`/`openHost` 已覆写），且官方 dist 硬编码 `new WebApiClient()`。
   桌面换载波 = desktop profile 的 roster/manifest（`__DSH_BOOT__` 由 desktop-runtime 供给）把
   `connection`/`client-runtime` patch 行为 **IPC 载波变体**（覆写 `doFetch` + `openMux` + `openHost` + rpc 四件套），**不改官方 dist**。
3. **审批链路已就绪（R3 解除）**：基线源码 `respond` 已完整实现（pending 表 + `approval/requested` 稳定 rpcId 帧 + 重复应答 `not-pending`，配套 `api-proxy-approval.spec.ts`）。
4. **旧插件现行 API**：`dsh-terminal` UI 主用 `POST /terminal/stream`（SSE），`POST /terminal/run` 为 legacy 一次性接口——兼容面需覆盖两条路由。
5. **拴合面（耦合收敛）**：仅 3 类文件（装配模块 / IPC 载波 / bundle patch），配 `sync-upstream` 迁移登记（ADR-005），升级 diff 范围可控。

## 5. 需求矩阵（P0 = M1–M3）

| ID | 需求 | 优先级 |
| --- | --- | --- |
| R-01 | 一包安装即用（无 Node/pnpm） | P0 |
| R-02 | 官方 UI 复用主面（`dsh-ui://`，可完成日常对话全流程） | P0 |
| R-02b | 旧插件兼容（host 半零改动 + client 半随主面） | P0 |
| R-03 | 宿主内嵌、零端口（`netstat` 无 308x 监听） | P0 |
| R-04 | 同一数据目录（共享 profile/sessions/credentials） | P0 |
| R-05 | 会话持久与后台（关窗不杀宿主、托盘驻留） | P0 |
| R-06 | 桌面原生通知 | P0 |
| R-07 | 全局热键唤醒 | P0 |
| R-08 | 托盘菜单 | P0 |
| R-10 | 桌面面板（官方槽位注入） | P0 |
| R-17 | 原生设置窗口 | P0 |
| R-09/11/12/13/15/16/18/19 | 多窗口/剪贴板桥/开机自启/`dsh://` 协议/会话审计/命令面板/自动更新/离线启动 | P1 |
| R-14/20~24、U-01~08 | 文件关联/崩溃自愈/主题化/看板/Git 集成/TTS；自绘 UI 差异化 | P2 |

非目标：不做多用户/云同步、不做插件商店平台、不承诺修复上游内核缺陷。

## 6. 技术选型与安全约束

- **框架**：Electron（主进程 = Host 嵌入式容器；renderer = `dsh-ui://` 官方 dist）。
- **语言**：TypeScript 全程（主进程 + renderer preload + host 插件）。
- **Host 装配**：`dsh-app-boot` / `@deepseek-ai/dsh` 基线 rc.8；desktop profile 叠加于 base + web-app 之上，禁用 `webserver`/`web-runtime` 行。
- **安全红线**（08）：
  - renderer：`contextIsolation: true` + `sandbox: true` + 白名单 IPC（无 `ipcRenderer.send` 裸通）；
  - CSP：`default-src 'self'`、`connect-src 'none'`（网络请求全走 host 侧）;
  - fetch 拦截白名单：仅放行已注册 `desktopRoutes` 路径；
  - 凭据不落 renderer；审批类写操作过 `approval` 服务。

## 7. 性能与兼容性目标

| 维度 | 目标 |
| --- | --- |
| 冷启动（到可用 UI） | ≤ 3s（Win 中端） |
| 宿主热启动（常驻唤起） | ≤ 300ms |
| 常驻内存 | ≤ 400MB |
| 兼容 | Win10/11（x64；arm64 可选）；macOS/Linux 后置（M5 起） |

## 8. 路线图与里程碑（09）

| 里程碑 | 内容 | 门禁 |
| --- | --- | --- |
| M0 | 基线核对（rc.8 事实刷新）、脚手架、dist 协议加载 spike 前置 | 事实表过审 |
| M1 | 装配原型 + dist 协议加载 + IPC 载波 + 零端口 bundle spike + 崩溃恢复初版 | 官方 UI 可对话；第三方 web 插件无改动装载；`netstat` 无监听 |
| M2 | 旧插件（terminal/rule-manager/restart）兼容全链；托盘/热键/通知 | 兼容验收矩阵全绿 |
| M3 | 通知点击定位/多窗口初版/会话审计 | R-05~R-09 达成 |
| M4+ | 自动更新、`dsh://` 协议、安装包签名、macOS | P1/P2 项 |

## 9. MVP 边界（M1 明确范围）

**包含**：Electron 脚手架 → desktop profile 装配 → `dsh-ui://` 官方 dist 加载 → IPC 载波（rpc/respond/帧）→ 零端口 bundle spike（方案 A `dsh-ui://plugins/...` vs 方案 B `BootSeams`）→ 零端口验证 → 崩溃恢复初版。

**不含**（后置）：托盘/热键/通知（M2）、旧插件兼容全链（M2）、多窗口/剪贴板（M3）、自绘 UI（ADR-006 启用后）。

## 10. 风险登记（摘要，详见 11-risks）

- **R3 审批帧**：closed（已核实实现）。
- **R5 `BootSeams`/自定义协议**：open，M1-T4 双案 spike, 2 天出结论。
- **R19 基线漂移**：closed（钉 rc.8；**2026-09-01 实测上游最新稳定为 `0.1.1-rc.2`**，差异 diff 登记迁移表 C 区）。
- **R20 上游 typert 迁移**：watch。
- **R1/R2**：watch（上游破坏性变更 / 官方桌面稀释）。