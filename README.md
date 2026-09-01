# dsh-desktop — DeepSeek Harness 桌面客户端（非套壳路线）

> 状态：**M1 实施中** — 脚手架已就绪（Electron 44 + TS strict + ESLint），主链路由 `src/desktop-shell` 起步。
> 目标版本基线：`@deepseek-ai/dsh` `0.1.0-rc.8`（本地检出权威基线；2026-09-01 实测上游最新稳定为 `0.1.1-rc.2`，diff 已在升级迁移表登记，升级前核查）。
>
> **当前优先级（2026-08 用户确认）**：先做「把 DSH 做成桌面应用」的技术方案，**主面复用官方 Web UI 发行物**；
> 自绘 Desktop UI（[`docs/13-ui-design.md`](docs/13-ui-design.md)、[ADR-006](docs/adr/adr-006-custom-ui.md)）**暂缓为二期可选**，
> 本轮不纳入主线。下文「定位/判定/路线」均以「官方 UI 复用 + 内嵌宿主 + IPC 载波」为默认方案。

## 一句话定位

把 DeepSeek Harness 做成一个**真正的桌面应用**：Electron 主进程**内嵌 Cordis Host**（与官方 Web 版同内核、零移植），
渲染进程加载**官方 Web UI 发行物**（`file://`/自定义协议 + IPC 桥接，**不开放 HTTP 端口**），
所有桌面原生能力（托盘、全局热键、系统通知、剪贴板、开机自启、协议唤起、多窗口）以 **host 插件** 形态注入运行时，
与官方「一切皆插件」的架构同构——**不是给网页套壳，而是把桌面能力变成可装配、可卸载、可审查的插件树**。

## AI 驱动开发声明

本项目（含 `docs/` 设计文档、`.rules/` 工程规则、`src/` 代码、`scripts/` 验证脚本）**全程由 AI 驱动编写**，
迭代过程基于 `.trae/rules/workflow.md` 的协作 SOP 与 `docs/pitfalls.md` 的实战踩坑记录进行。
开发中遵循以下原则：

- **契约优先**：所有 IPC 契约 / zod Schema / DTO 先定义于 `src/types/`，作为唯一类型源头，preload / 桥 / 测试类型均由推导获得。
- **规则驱动**：`.trae/rules/` 下的核心规范（`core-standards` / `architecture` / `active-context` / `git-commit-guide` / `workflow`）约束编码、放置、提交与看板同步。
- **可复现排障**：开发中遇到的环境/架构问题与解法沉淀于 [`docs/pitfalls.md`](docs/pitfalls.md)，供后续会话与协作者查阅复用。
- **质量自检链**：交付前必过 typecheck / lint / build + 自动化验证脚本（`scripts/verify-*.cjs`）全绿，并经实机验收。

> 说明：代码为 AI 生成 + 人工决策审阅的产物；架构与技术选型（Electron 内嵌 Host、IPC 载波零端口、官方 UI 复用、插件化桌面能力）基于 `docs/` 与 ADR 的评审结论确定。

## 「非套壳」判定标准（本项目红线）

| 维度 | 套壳（反面教材） | 本项目（目标） |
| --- | --- | --- |
| Host 进程 | 外部子进程 `dsh web`，壳只是浏览器 | 主进程内嵌 Cordis Host，生命周期与应用合一，可编程启停 |
| 传输 | 直接加载 `http://127.0.0.1:3080` | 官方预留的 Electron 载波插槽：`file://` dist + `AbstractApiClient` IPC 桥（`doFetch` 覆写），零端口 |
| 原生能力 | 无 / 壳层脚本零散处理 | 每个能力一个 host 插件（`desktop-tray` / `desktop-shortcuts` / …），经 `cordis.patch.yml` 装配 |
| UI | WebView 原样 iframe | **复用官方 Web UI 发行物**，经官方槽位注入桌面侧功能（二期可选自绘主面，见 ADR-006） |
| 旧插件 | 无视 | host 半零改动可用（desktopRoutes 等价面）；client 半经零端口 bundle 兼容面保留（ADR-007） |
| 可审查性 | 壳行为不可见 | 桌面动作进会话轨迹、权限走 approval 服务、日志统一 |
| 分发 | 安装包 + 手动 `dsh plugin` | 一包涵盖 runtime + 官方 UI dist + 插件 + 皮肤 + 更新，零外部依赖（仅 Electron 运行时） |

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [`docs/01-research.md`](docs/01-research.md) | DSH 架构调研：Cordis、Host/Client 分层、四象限 RPC、客户端插件加载、SDK、官方/社区桌面现状 |
| [`docs/02-requirements.md`](docs/02-requirements.md) | 产品定位、目标用户、功能需求矩阵（P0/P1/P2）、非功能需求 |
| [`docs/03-routes.md`](docs/03-routes.md) | 技术路线对比：Electron 内嵌 Host + 官方 UI 复用（推荐）/ Tauri 2 / SDK 自研 / PWA / 纯套壳；选择论证 |
| [`docs/04-architecture.md`](docs/04-architecture.md) | 总体架构：进程模型、模块划分、数据流、与官方 layering 模型的对齐 |
| [`docs/05-host-plugins.md`](docs/05-host-plugins.md) | 宿主插件设计：desktop bundle、`ctx.desktop.*` 服务接口、各能力插件规格 |
| [`docs/06-client-plugins.md`](docs/06-client-plugins.md) | 客户端插件设计：官方 UI 槽位注入 + 零端口 bundle 兼容面（含旧插件承接） |
| [`docs/07-desktop-shell.md`](docs/07-desktop-shell.md) | 桌面外壳设计：主进程装配（`boot()`）、IPC 桥协议、官方 dist 装载、窗口管理、打包分发、自动更新 |
| [`docs/08-security.md`](docs/08-security.md) | 安全与信任模型：无端口、renderer 隔离、权限、签名、外链白名单 |
| [`docs/09-roadmap.md`](docs/09-roadmap.md) | 里程碑 M1–M6 与任务拆解、验收标准 |
| [`docs/10-development.md`](docs/10-development.md) | 开发环境、构建链路、调试、测试、与上游同步 |
| [`docs/11-risks.md`](docs/11-risks.md) | 风险登记与控制措施 |
| [`docs/12-references.md`](docs/12-references.md) | 全部依据：本地源码路径 + 官方/社区 URL 引用 + 现有插件 API 面盘点 |
| [`docs/13-ui-design.md`](docs/13-ui-design.md) | **（二期可选）** Desktop-First 自绘 UI 愿景——暂缓，主线不依赖 |
| [`docs/adr/`](docs/adr/) | 架构决策记录：[ADR-001 选 Electron](docs/adr/adr-001-electron-stack.md) · [ADR-002 宿主内嵌](docs/adr/adr-002-inprocess-host.md) · [ADR-003 IPC 载波](docs/adr/adr-003-ipc-fetch-carrier.md) · [ADR-004 装配模型](docs/adr/adr-004-profile-bundle-model.md) · [ADR-005 版本钉死](docs/adr/adr-005-version-pinning.md) · [ADR-006 自绘主面](docs/adr/adr-006-custom-ui.md)（暂缓·可选） · [ADR-007 旧插件兼容](docs/adr/adr-007-plugin-compat.md) |

## 关键结论速览

1. **官方已为桌面预留架构插槽**：GUI 分层说明明确「未来 Electron 应用复用同一套 web client 包，仅换 IPC fetch 载波」；
   webserver 文档明确「只服务浏览器：Electron 用 `file://` 加载 dist，fetch 走 IPC 桥」。
2. **社区桌面（sdkwork-ai/deepseek-harness-desktop 等）已实现「Electron + IPC + 官方 Web profile + 打包分发」**——
   它们解决的是**分发与桌面体验**，未深入**宿主内嵌与能力插件化**。本项目的差异化在第二层深度。
3. **推荐方案（当前主线）**：Electron 主进程内嵌 Host（`dsh-app-boot.boot()` 装配 desktop profile），
   renderer 加载**官方 UI dist**，传输用官方预留的 IPC 载波；桌面能力全部做成 host 插件。
4. **旧插件不丢弃**：`dsh-terminal` / `dsh-rule-manager` / `dsh-restart` 的 host 半经 `desktopRoutes` 等价面零改动可用，
   client 半经零端口 bundle 兼容面保留（ADR-007）。
5. **红线**：默认**零 HTTP 端口**；一切与官方 API 的耦合点（`AbstractApiClient.doFetch`、`BootSeams.loadBundle`、
   `webServer` 路由、bundle patch）都收敛在少数可替换文件，随上游 rc 版本钉死。
6. **UI 差异化（二期可选）**：见 [`13-ui-design.md`](docs/13-ui-design.md) 与 [ADR-006](docs/adr/adr-006-custom-ui.md)——本轮明确不纳入主线。

## 目录规划（未来实现期）

```
dsh-desktop/
├─ docs/                  # 本文档集（当前阶段唯一内容）
├─ shell/                 # Electron 应用（main / preload / IPC 桥 / 协议 / 窗口/托盘）
├─ bundle/                # desktop profile 的 cordis.patch.yml（dsh.bundle 声明）
├─ packages/
│  ├─ desktop-host-*      # 桌面能力宿主插件（tray/shortcuts/notifications/clipboard/compat/…）
│  ├─ desktop-client-*    # 官方 UI 槽位注入的客户端插件
│  └─ desktop-*           # 共享库（IPC 协议类型、桥接、配置 schema）
├─ scripts/               # 构建（dist/shell）/ 打包 / 签名 / 更新产物脚本
└─ tools/                 # 与上游 dsh 仓库同步的工具
```

## 许可证与归属

设计文档按 MIT 发布（与 DeepSeek Harness 一致）。本项目为独立社区项目，与 DeepSeek 官方无附属关系；
所有官方商标/名称的使用遵循其品牌指引。