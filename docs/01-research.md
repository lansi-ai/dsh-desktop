# 01 · 调研报告 — DeepSeek Harness 架构与桌面化基础

> 依据：本地 `_harness-src/`（官方 `deepseek-ai/deepseek-harness` 源码检出，`dsh-v0.1.0-rc.x`）中的权威文档、
> 官方 GitHub 仓库与预览页、社区桌面项目。全部出处在 [`12-references.md`](12-references.md)。

---

## 1. DSH 是什么

DeepSeek Harness（`dsh`）是 DeepSeek AI 开源（MIT）的 agent harness：**模型负责「想」，Harness 负责「在受控环境里把想法落地」**——
工具、环境、会话、权限、沙箱、执行循环全归它管。当前处于 **developer preview**，官方明示「未来将出现破坏兼容性的变更」。

其架构灵魂是 **「一切皆插件」**：连模型适配器、工具注册表、会话日志、Agent Loop、沙箱、存储、UI 甚至启动入口本身都是插件——
整个系统**没有「必须先改它」的特权内核**，所有能力挂在一棵**可替换、可隔离、可卸载的插件树**上。

- 驱动框架：vendored **Cordis**（`@deepseek-ai/cordis`，基于 https://github.com/cordiverse/cordis）
- 用户运行方式：`npx @deepseek-ai/dsh@next web` → 启动 Web UI（默认 `http://127.0.0.1:3080`）
- 版本事实（调研时点）：npm `next` 渠道本机为 `0.1.0-rc.7`；GitHub Releases Latest 为 `dsh-v0.1.0-rc.12`

## 2. Cordis 三支柱（插件系统底层）

| 支柱 | 语义 | 对桌面的意义 |
| --- | --- | --- |
| **Service** | 插件向共享 `ctx` 注册稳定 key（`ctx.tools`、`ctx.llm`、`ctx.sessions`…），其他插件按 key 注入依赖，加载顺序由内核保证 | 桌面能力可注册 `ctx.desktop` 服务，任何插件/工具可注入 |
| **Event** | 类型化事件，四种分发：`emit`（广播）/ `waterfall`（中间件，可 `next()` 委托或短路）/ `parallel` / `serial` | 审批/安全拦截是 `waterfall` 的既有实现方式，桌面权限可复用 |
| **Effect** | 一切注册（监听器、工具、适配器、路由）通过 `ctx.effect()`；卸载时**自动撤销**，热替换无残留 | host 插件卸载时托盘/热键/路由自动清理，无泄漏 |

> 见 `docs/cordis-primer.md`、`docs/cordis-tutorial/` 与 `vendor/cordis/`。最简插件：`export const myPlugin = (ctx) => { ctx.service(...); ctx.on(...); ctx.effect(...) }`。

## 3. Host / Client 分层（桌面化的关键架构事实）

仓库目录即分层：`packages/host/*`（Node 宿主能力）、`packages/client/*`（浏览器能力）、`apps/*`（应用装配）。

```
apps/*  (apps/web = vite 应用；apps/cli = dsh bin 分发)
  ▼ consume
packages/host/*          packages/client/*
  apiproxy 协议层            pure libs: ui-slots / ui-primitives / loader
  webserver HTTP 载体        dsh.client 插件（node 半=空 apply；client 半=src/client/）
  frontend-static dist 托管
  ▼
harness core packages（session/agent-loop/llm/tools/sandbox/shell/…）
```

**权威结论（GUI 分层说明，`.agents/notes/.../2026-07-19-gui-layering-and-rpc-protocol.md`）**：

> 超出既有 ACP/stdio，更多产品客户端将来——**Web (server)、Electron，以及其他**。
> 需要一个稳定分层模型让新客户端干净插入。

- **新增应用的官方 Checklist**：
  1. 选择一种 **fetch 表现**：浏览器同源 HTTP / 进程内 `host.handler.fetch` / **自定义 transport 子类（例如未来的 Electron IPC）**；
  2. 在 `apps/` 写一个装配模块：`startHost()` + 一个 client 子类 + 应用私有的信号/打印/退出语义；
  3. **只有需要 HTTP 载体才引入 `dsh-host-webserver`，否则零端口**。
- **载波子类表（原文表格）**：`InProcessApiClient`（进程内）、`WebApiClient`（浏览器）、`FixtureApiClient`（无服务器开发），
  以及一行假设示例——**「IPC bridge subclass (hypothetical example — no such shell exists) | an Electron shell | IPC 序列化往返 | 只换 doFetch」**。
  → **官方为我们的 Electron IPC 桥预留下了精确插槽，契约与基类不变。**
- **webserver 文档（`docs/subsystems/web-server.md`）**：
  > 该服务器只服务浏览器：**Electron 通过 `file://` 加载已构建文件，并经 IPC 桥接发送 fetch 请求，不使用本服务器。**

### 四象限 RPC 协议（apiproxy）

所有 wire 消息是四象限判别联合（`api/rpc.ts`）：`client-request`（客户端起）→ `server-response`；
`server-request`（服务端起：会话事件、审批/问答 requested）→ `client-response`（`POST /api/respond` 回填 rpcId）。
rpcId 纪律、错误模型（`RpcErrorDetailsMap`，details 必填）、zod 双向校验均有严格约定。
**载波完成窄形 → 全形**；`RpcResult<T> = {ok:true,value}|{ok:false,error}`——业务方法不抛错。

方法/帧的种类（节选，签名即事实源，见 `packages/host/apiproxy/src/api/`）：
`session.list / session.create / session.history / session.rename / session.prompt / session.cancel / host.describe / host.pickDirectory / command.execute / events.mux / events.host / respond`；
帧：`session/event`（透传核心事件，`assistant/chunk` 即 token 流）、`session/subscribed`、`approval/question requested|resolved`、`host/agent-error` 等。

### 客户端插件加载模型（`2026-07-23-client-plugin-loading-model.md`）

浏览器端镜像宿主的职责划分：`dsh-client-modules`（`ClientModuleSystem`，懒 CJS 表）站在 Node ESM loader 的位置，
vendored `@cordisjs/plugin-loader` 站在治理位置。**「模块系统管字节与身份（代码如何到达），Loader 管插件生命周期」**。

- Host 侧从 loader 条目扫描 `package.json` 的 `dsh.client` 声明 → 组装 `window.__DSH_BOOT__ = { rev, entries: [{id, url, rev, inject, immediately, external}] }`
- 每个 bundle 作为同源外部 `<script src="/plugins/<id>/client.js?rev=…">`（`async`）到达，map 在同路径 `.map`
- **模块系统只留一个可替换的 `loadBundle` 钩子**（`BootSeams`）——官方为「外部 script 无法到达页面上下文的环境」预留，
  正是 Electron `file://` 环境加载 client 插件 bundle 的官方扩展点（`dsh-client-web` README 明示）
- 热更新：`client-hmr` 行（node 半轮询 bundle mtime → SSE 广播 rebuilt 帧；浏览器半 invalide→prefetch→refresh）
- **装配 = 配置**：roster 在 `packages/bundle/web-app/cordis.patch.yml` 里以普通行声明；换部署 = 换 yml/overlay

## 4. 配置即装配：profile / bundle / patch

- **Profile**：`$DSH_HOME/profiles/<name>/` 目录 = `package.json`（`dsh.profile.bundles` 有序列表 + 出树插件依赖）+ 用户 `cordis.patch.yml`
- **Bundle**：npm 包，`package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`；内置 `base` / `web-app` / `headless` 三个模板
- **Patch 行**：按 `id` 覆盖整行 `config` 或 `insert` 新行；`!!js` 表达式在装载时求值（可访问 `ctx.webStartup` 等服务）；
  应用顺序：bundle 层（按 profile 列表顺序）→ profile patch → home patch → `--patch` overlay
- `dsh-base`：每个 profile 的第一层（模型适配器、持久化、沙箱、审批、设置、凭据、遥测…）
- `dsh-web-app`：浏览器应用层（webserver、web-runtime、connection、modules、client-runtime、全部 ui-* 行）
- Web 专属禁用：web-app 把 `tool-bash/pwsh/fs/…` 移到 agent preset 层（`tool-*` 禁用、preset 行开启）——组合语义的实例
- `dsh --profile web --dump-config` 可看全树；**任意行都能被自己的 patch 替换** → desktop profile 可基于此增删

## 5. 把 Host 跑起来：app-boot

`@deepseek-ai/dsh-app-boot`（`packages/boot/app-boot/README.md`）是 bin 的装配胶水，**桌面应用可直接复用**：
`boot(binName, absoluteConfigPath, patches?, prepare?, bareModuleBaseUrl?)` → 创建根 context → 挂 Loader →
`prepare` 钩子（可提供 launcher 自有 context 槽）→ 装载并 await include 树 → `assertEntriesLoaded/Activated` → 返回根 context。
另有 `loadEnv / loadLayeredEnv / resolveConfigPath / mountRootInclude / watchUserPatches (HMR) / renderConfigDump` 等。
`prepare` 钩子即「应用私有槽位」——Electron 主进程可在此注入 `ctx.desktop` 等服务。

## 6. SDK：另一个进程驱动 runtime（备选路线素材）

- **TS SDK** `@deepseek-ai/dsh-sdk-client` + **Python SDK** `deepseek-harness`：外部进程经 **stdio JSON-RPC** 驱动一个完整 runtime 子进程
- 高层 `DeepSeekHarness({launch, provider, model, maxTokens})`：`run(prompt)` 拥有一次活动区间（排队→等 `agent/inbox/spliced`→收至整 agent `idle`），
  返回 `RunResult { sessionId, finalResponse, events, notifications }`
- 底层 `HarnessClient`：显式 `start/initialize/prompt/request/close` + 通知订阅（`subscribe(filter)` / `subscribeSessionTree(id)`）
- 限制：无捆绑 runtime 解析、**无回合中取消**（放弃回合=关闭 runtime）、client→server 通知未实现（留给未来审批流）
- → 这条路线适合「工具形态」（CLI 伴侣/自研前端），不适合本项目的「桌面应用 + 官方 UI 复用」主线，但可作为未来「自研 UI 面」的基础

## 7. Web UI 装配清单（桌面 profile 的参考基线）

`packages/bundle/web-app/cordis.patch.yml`（共 ~130 行）表明 Web 面所需的最小 host 行集合：
`code-runtime / storage(+json+domain) / message-feedback / session-log-export / workspace / session-projection-cache /
session-reference / file-reference-local / session-stats / directory-picker-auto / plugin-inventory / api-gateway(apiproxy) /
cordis-host-runner / web-startup / webserver / web-runtime / client-hmr / modules / connection / api-remotes /
client-runtime / cordis-client-runner / ui-theme / locale / ui-layout / ui-renderer / ui-sidebar / ui-settings（含 general/models/plugin-inventory/plugins）/ ui-conversation / ui-brand-official / ui-attachment / ui-tool / ui-cordis / ui-workflow-run / ui-deliverables / ui-workspace / ui-input-trigger / ui-commands / ui-skill / ui-subagent / ui-reference / ui-jobs / ui-goal / ui-message-feedback / ui-model-selection / ui-permission / ui-agent-preset / ui-settings-plugins / ui-plan / ui-user-questions / ui-trajectory`

**桌面 profile 的差异点**：
- `webserver` / `web-runtime`（默认开 HTTP 端口 + 打开浏览器）→ 替换为 desktop-runtime 行（零端口，dist 走 `file://`，fetch 走 IPC）
- `connection` 的浏览器半（`WebApiClient`）→ 换成 IPC 载波子类
- `modules` 的 bundle 路由（`/plugins/<id>/client.js`）→ 换成自定义协议或 `BootSeams.loadBundle` 覆写
- `directory-picker-auto` 依赖桌面原生选目录 → `directory-picker-native` 或自实现
- 追加 `desktop-*` 行（托盘/热键/通知/…）

## 8. 社区桌面现状（差异化参照）

| 项目 | 形态 | 集成深度 | 来源 |
| --- | --- | --- | --- |
| [`sdkwork-ai/deepseek-harness-desktop`](https://github.com/sdkwork-ai/deepseek-harness-desktop) | Electron 打包官方 Web profile + 插件 + Skills + 皮肤 + 自动更新；**Electron IPC 提供 UI，不打开 HTTP 端口**；Win/macOS/Linux 安装包与便携包 + SHA256SUMS | 分发层深度（运行时装在包里、更新、校验）；核心仍是官方 Web 面 + 宿主作为子进程 | [安装指南](https://raw.githubusercontent.com/sdkwork-ai/deepseek-harness-desktop/master/docs/user/guide/desktop.zh.md)、[中文教程](https://www.cnblogs.com/wlor/articles/22579705) |
| [`fendouai/deepseek-harness-desktop`](https://github.com/fendouai/deepseek-harness-desktop) | 同类社区 fork | 同左 | — |
| [`kyorakuyk/dsh-desktop`](https://raw.githubusercontent.com/kyorakuyk/dsh-desktop/main/README.md) | 同类社区项目 | 同左 | — |

**差异观察**：社区项目解决「安装简单 + 桌面体验」，本质是 **官方 Web profile 的桌面化分发**（壳内运行官方 `dsh` 宿主）。
它们**没有**：把宿主内嵌进应用进程（生命周期、崩溃恢复、程序化控制）、桌面原生气为 Cordis 插件（模型可感知、可审批、可卸载）、
官方 UI 槽位级桌面集成、深度多窗口/Spotlight 交互、桌面权限模型。
→ 这正是本项目的差异化空间（详见 `03-routes.md` 与 `04-architecture.md`）。

## 9. 调研结论（给后续设计的事实清单）

1. 桌面应用 = 官方预留的「第三类应用」：`doFetch` 换载波、装配模块换表面、HTTP 可选（推荐零端口）。
2. 官方 UI（`dsh-web-frontend`）是可复用的 vite 发行物；客户端插件机制对载波透明（靠 `BootSeams`）。
3. 宿主能力全部可插件化（服务/事件/效果），桌面能力以 `ctx.desktop.*` 服务 + host 插件呈现与官方架构同构。
4. profile/bundle/patch 机制让「桌面 = 一个 profile + 一组 bundle」成为一等公民配置，用户可 patch 掉任何桌面能力。
5. SDK 与 apiproxy 协议是两条平行驱动面：前者适合外部进程/自研 UI，后者是官方 Web 面所用——桌面主进程内有第三条（进程内 fetch / IPC）。
6. 上游 rc 快速迭代：**必须钉版本**（见 ADR-005），一切耦合点收敛到少数文件。

> **v2 增补（用户反馈后）**：以上事实结论不因 UI 路线调整而改变；「主面自绘、官方 UI 仅兼容窗口」的决策见
> [ADR-006](adr/adr-006-custom-ui.md) 与 [ADR-007](adr/adr-007-plugin-compat.md)。
> 其中第 3 条（宿主能力插件化）与第 4 条（profile/bundle 装配）是自绘路线仍成立的两根支柱；第 2 条的四象限协议
> 成为自绘 UI 与官方 UI 的**共用数据层**——两者渲染不同，数据语义完全一致。