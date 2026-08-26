---
description: 项目当前 Sprint 激活上下文与动态任务看板（dsh-desktop · M1）
globs: "*"
alwaysApply: true
---

# 激活上下文与任务看板 (active-context.md)

## 01. 当前迭代目标 (Current Sprint Goal)
- **版本阶段**：M0 → M1（桌面客户端可行性闭环）
- **核心业务价值**：官方 Web UI 在桌面内嵌运行（`dsh-ui://` + IPC 载波，零 HTTP 端口），第三方插件无改动装载，崩溃可自愈。
- **关键交付物**：Electron 骨架 + desktop profile 装配 + IPC 载波四件套 + 零端口 bundle spike 结论 + 崩溃恢复初版；门禁 = 官方 UI 可对话 + `netstat` 无监听。

## 02. 任务清单与状态 (Task Kanban)
- [x] **步骤 1: 基础设施与脚手架搭设**（2026-08-25 完成）
  - [x] npm 单包 + Electron 44 + TypeScript `strict`（Node16）+ ESLint 基线（沙箱限制弃 pnpm → npm，规则已同步）
  - [x] `.rules/` 规则已就位；`docs/` 设计基线已迁入（含 ADR）；`src/desktop-shell/main.ts` 最小入口编译通过
- [x] **步骤 2: M0 基线核对与事实刷新**（2026-08-25 完成）
  - [x] 钉上游 `dsh-v0.1.0-rc.8`（本地检出权威）；`sync-upstream` 迁移登记表建立（ADR-005）
  - [x] 复核 R3（respond 实现）、dsh-terminal 现行 API（`/terminal/stream`）、`BootSeams`/`loadBundle` 签名
  - [x] `patch-invariants` 差集基线落盘（`docs/upstream-migrations.md` B 区；spec 随步骤 3 装配落地）
- [x] **步骤 3: 装配原型与 dist 协议加载**（2026-08-26 完成）
  - [x] 配置依赖：`@deepseek-ai/dsh`/`dsh-app-boot`/`dsh-web-app` 精确 `0.1.0-rc.8`（npm install --save-exact，2026-08-25 完成）
  - [x] 获取官方 web-app dist 发行物（`@deepseek-ai/dsh-web-frontend@0.1.0-rc.8` **直接依赖**声明，index.html+assets 分块齐全；**R4 解除**，无需自建构建脚本）
  - [x] `boot()` desktop profile 装配最小可运行（`src/desktop-host/boot.ts`：overlay patches 禁用 webserver/web-runtime/web-startup/connection/client-*；`!!js` 表达式改为 TS 直接求值；`dshHomePath` 路径在步骤 4 解决）
  - [x] `dsh-ui://` 自定义协议注册并加载官方 UI（`dsh-ui-protocol.ts`：dist 直读 + `__DSH_BOOT__` manifest 注入 + queueLoader shim；Electron 窗口 `loadURL('dsh-ui://index.html')` 验证通过）
- [x] **步骤 4: IPC 载波实现（四件套）**（2026-08-26 完成）
  - [x] `src/types/` zod 契约 + channel 常量 + AppError 码表（channels.ts / contract.ts / errors.ts / index.ts）
  - [x] bridge 宿主端：unary 表分发 + respond 回填 + 帧路由 per-window（bridge.ts）
  - [x] preload `desktopBridge` 白名单（rpc/respond/onFrame/onDesktopEvent/windowControl/getPlatformInfo）（preload.ts）
  - [x] roster/manifest 覆盖：`connection`/`client-runtime` 禁用 + IPC 载波服务注册（manifest.ts）
  - [x] `dsh-ui://` scheme 特权注册 + 占位诊断页 + dist 回退（dsh-ui-protocol.ts）
  - [x] 构建脚本：copy-web.cjs 复制静态资源到 dist
  - [x] 验证通过：renderer → preload → bridge → host 全链路 RPC 通信畅通
- [x] **步骤 5: 零端口 bundle spike（方案 A 定案，方案 B 备选）**（2026-08-26 方案 A 完成）
  - [x] 方案 A：`dsh-ui://plugins/<id>/client.js?rev=` 协议直读（`boot-graph.ts` 图谱生成 + `dsh-ui-protocol` bundle route + 样例插件 + 自动化验证通过）
  - [ ] 方案 B：`BootSeams.loadBundle` 覆写（暂未实测，留作对比兜底；官方 `manifest.d.ts` 已确认 `loadBundle?: (url) => Promise<void>` 钩子可用）
  - [x] 结论落 ADR-007：方案 A 为默认零端口 bundle 装载路径；R5（官方 dist 资源路径绝对路径语义）仍未验证
- [x] **步骤 6: 零端口验证与崩溃恢复初版**（2026-08-26 完成；`--serve` 兼容冒烟归 M2 兼容层，ADR-007）
  - [x] `netstat` 零监听验证（默认模式，2026-08-26 通过 —— Electron 进程无任何 TCP 监听端口）
  - [ ] `--serve` 兼容模式冒烟（**归 M2 兼容层**，ADR-007；需重启用官方 webserver）
  - [x] 崩溃 relaunch 自愈 v0（有限重启 + 熔断；`src/desktop-shell/relaunch.ts` 主/渲染崩溃兜底 + 熔断计数，已通过 typecheck/lint/build）
- [ ] **步骤 7: M1 门禁验收与收尾**（2026-08-26 部分推进）
  - [x] 官方 dist 接入 + R5 修复（本轮，**实机验证通过**）：`FORCE_PLACEHOLDER=false` + 固定虚拟 host `dsh-ui://app` 布局 + `resolveRelative` 仅取 pathname 映射官方 dist 根；实机验证 **6 项资源全部 200，不再白屏**；dist 自 tarball 落盘恢复；`verify-bundle-spike.cjs` 扩展断言 6 项落盘；typecheck/lint/build 通过
  - [x] 第 3 层前置：`@dsh-desktop/ipc-connection` client bundle 最小实证完成 —— 继承官方 `AbstractApiClient`、`doFetch` 信封透传 + `server-response` 包装（rpcId 回显/error 窄化）、preload `request(envelope)` 透传通道；`verify-ipc-carrier.cjs` Step1/2 通过，typecheck/lint/build 全绿
  - [x] 官方 UI 完成日常对话全流程（**实机验收通过**，2026-08-26）：IPC 载波 + 自动扫描图谱 + Electron 目录选择，官方 UI 成功渲染、选择工作区、日常对话全流程打通
    - [x] 攻坚第 1 批（本轮，**脚本实证通过**）：boot-graph 组装官方 UI 最小激活集（typert-registry/api-gateway/api-remotes + ipc-connection 独占 connection，含 inject/external/immediately 与依赖序；client-connection 基类依赖，**第 2 批实机证伪后移出图谱**）+ ipc-connection 载波补齐（`connection.rpc.call` 真实分发 host booleanResult + `readIpFrames` 帧泵 server-request 信封 + 最小连接循环 `start`）+ contract 四象限信封 schema；`verify-ipc-carrier.cjs` 扩至 4 步、`verify-bundle-spike.cjs` 增激活集断言，typecheck/lint/build + 双脚本全绿
    - [x] 攻坚第 2 批·实现（本轮完成，**待实机验收**）：host 会话事件→下行帧中继 `src/desktop-host/carrier-relay.ts` —— 消费 `ctx.apiProxy.events.mux/host` 事件流（官方 dsh-host-apiproxy 已把 session/event、session/jobs、approval/question requested 装配为 `{rpcId, payload:frame}` 帧），逐帧 `payload` 经 `webContents.send('dsh:frame')` 下发 renderer（ipc-connection readIpFrames 用自身 streamRpcId 重包）；main.ts 接线（createWindow 返回值 + 窗口 closed 释放中继）；frameSchema 保守 dst 判定未扩（中继绕过其 3 种枚举直推原始帧，renderer 端按 `frame.type` 判类）；typecheck/lint/build 全绿
    - [x] 攻坚第 2 批·实机（**验收通过**，2026-08-26）：官方 UI 成功渲染进入 + 工作区选择 + 日常对话全流程打通。期间连环修复：(a) `host.apiproxy` 错误入口 → 改官方 `toFetchHandler`（host 无 `.handleRpc`，用 `/api/<method>` 虚拟路由 + 解包 server-response）；`new Request` 相对 URL 抛错 → 用 `http://local` 虚拟 base；(b) `uuid` schema 过严拦截 → 放宽 `rpcIdSchema` 为非空字符串；(c) 图谱缺 client UI 插件空白 → **自动扫描方案**（boot-graph 复刻官方 ClientModuleRegistry，从 node_modules 自动发现 42 个 `dsh.client` 包含 33 个 ui-*，剔出 client-connection）；(d) `host.pickDirectory` 崩溃 → koffi 在 Electron 不兼容，改用 **Electron 原生 dialog.showOpenDialog** 的 `ElectronDirectoryPicker extends DirectoryPicker`（Service 注入，kind:native）；(e) `ui-onboarding` 未注册拦截 → host 补丁加 `ui-settings-general`（注册 settings namespace）。typecheck/lint/build + 双脚本全绿
  - [ ] 第三方 web 插件（webServer 路由 + 槽位 + 同源 fetch 模式）无改动装载验证（需 desktop-compat 兼容层，未实现）
  - [ ] `docs/active-context.html` 看板同步落盘 + 里程碑提交

## 03. 关键决策与架构遗留 (Key Decisions & Context)
- **已做出的关键技术决策**：
  - D-1 Electron 主进程内嵌 Cordis Host（非外部子进程）
  - D-2 IPC fetch 载波零端口（`--serve` 显式兼容）
  - D-3 主线 = 官方 Web UI 发行物复用（自绘 UI 为 P2，ADR-006 启用）
  - D-4 基线钉本地检出 `dsh-v0.1.0-rc.8`（rc.12 差异登记 sync-upstream，M4 升级前核查）
  - D-5 载波替换 = roster/manifest 覆盖 IPC 变体（不改 dist）
  - D-6 兼容层 = `ctx.desktopRoutes` + fetch 拦截白名单（ADR-007）
  - D-9 官方 client-connection **不入图谱**：官方 web boot 驱动（BootRunner）对图谱每个条目全量 `loader.create()` 激活（`immediately` 仅控 prefetch 时机），若入图必被激活、抢先提供 Web 传输 connection → 基类改「图谱外预载注册」（`PRELOAD_ONLY_IDS` + `registerPreloadOnly`），connection 服务由 ipc-connection 独占（攻坚第 2 批实机证伪后落地）
  - D-10 自动扫描 client 图谱：boot-graph 复刻官方 ClientModuleRegistry（`scanClientPackages`/`orderByModuleGraph`），从 node_modules/@deepseek-ai 自动发现全部 `dsh.client.platform==='web'` 包（42 个，含 33 个 ui-*），替代手拼最小激活集；`dsh.client.inject` 为模块加载依赖（完整包名），与 Cordis 服务注入（服务名）分离
  - D-11 host `directoryPicker` 契约：官方 `-auto` 依赖 webServer（零端口禁用）、`-native` 用 koffi（Electron 主进程崩溃，`napi_get_last_error_info` fatal）→ 改用**本地 `ElectronDirectoryPicker extends DirectoryPicker`**（prepare 钩子注入，`new` 构造即 `ctx.provide('directoryPicker')`），`capability()` 返回 kind:native，`pick(signal)` 用 Electron `dialog.showOpenDialog` 返回 `string|null`
  - D-12 host RPC 入口 = 官方 `toFetchHandler(apiProxy)`：host-apiproxy 无 `.handleRpc`，应把 client-request envelope 经 `/api/<method>` 虚拟路由分发（`new Request` 需绝对 base `http://local`），解包 server-response 的 `result.value`
- **风险与技术债记录**：
  - R4 **reopened（本轮）**：官方 dist 在 npm 发行物（tarball 含 dist/assets，89 文件）中，但 `npm install` 未落盘 node_modules（仅元数据）；本轮已从 tarball 恢复 dist。重装依赖后需校验 dist 完整性。
  - R5 **已实机修复（本轮）**：改用固定虚拟 host `dsh-ui://app` 布局 + `resolveRelative` 仅取 pathname 映射；实机验证官方 dist 6 项资源全部 200（不再白屏）。已按 D-9 将 `client-connection` 移出图谱改预载注册，实机重验通过——官方 UI 已经 ipc-connection 走 IPC 载波完成日常对话
  - R6 open：`!!js` 表达式在 overlay patches（JS 对象直传 `boot()`）中不被 Cordis Loader 求值（仅 Include YAML 解析阶段激活）——当前以 TS 直接求值绕过；`dshHomePath()` 等 Cordis 服务需在步骤 4 通过 `prepare` 钩子提供
  - R7 open：`session-persistence-jsonl` / `storage-json` 的 `root` 路径使用硬编码 `.runtime/user-data/...`；待 `dshHomePath` 服务可用后切回 `!!js dshHomePath(...)` 语义
  - 暂存项：自绘 Desktop UI（U-01~08）按 P2 记账，ADR-006 启用前不投入
  - **排障手册**：`docs/pitfalls.md`（M1 攻坚第 2 批实战踩坑记录，含 8 类坑 + 排障方法论）——后续会话排障时**先查阅该文档**再动手

## 04. 下一步即时行动 (Next Immediate Actions)
- **当前正在处理**：步骤 7 攻坚第 2 批（**已完成，实机验收通过**，2026-08-26）。官方 UI 成功渲染进入 + 工作区选择 + 日常对话全流程打通；期间按 D-9/10/11/12 连环修复（client-connection 预载注册、自动扫描图谱、Electron 目录选择器、toFetchHandler RPC 入口）；typecheck/lint/build + 双验证脚本全绿。
- **下一攻坚目标**：步骤 7 剩余项 —— (1) 第三方 web 插件（webServer 路由 + 槽位 + 同源 fetch 模式）无改动装载验证（需 desktop-compat 兼容层）；(2) `docs/active-context.html` 看板同步落盘 + 里程碑提交。
- **关键阻塞项**：（已解除）官方 UI 对话全链路（IPC 载波 + 自动扫描图谱 + 工作区 + 会话）已通。剩余待办为第三方 web 插件装载（desktop-compat 层）+ 看板落盘。
- **AI 交互指令提示**：后续会话可直接提示 "按照 active-context.md 的下一步继续执行"。

## 05. 规则自我演进维护
本文件为动态看板。每次完成任务节点或发生业务需求变更时，AI 必须按 `workflow.md` 场景 C 规则更新协议，同步更新 MD 版并重新渲染 `docs/active-context.html`，确保任务状态与工程代码一致。