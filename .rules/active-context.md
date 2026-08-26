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
- [ ] **步骤 6: 零端口验证与崩溃恢复初版**
  - [ ] `netstat` 零监听验证（默认模式）+ `--serve` 兼容模式冒烟
  - [ ] 崩溃 relaunch 自愈 v0（有限重启 + 熔断）
- [ ] **步骤 7: M1 门禁验收与收尾**
  - [ ] 官方 UI 完成日常对话全流程
  - [ ] 第三方 web 插件（webServer 路由 + 槽位 + 同源 fetch 模式）无改动装载验证
  - [ ] `docs/active-context.html` 看板同步落盘 + 里程碑提交

## 03. 关键决策与架构遗留 (Key Decisions & Context)
- **已做出的关键技术决策**：
  - D-1 Electron 主进程内嵌 Cordis Host（非外部子进程）
  - D-2 IPC fetch 载波零端口（`--serve` 显式兼容）
  - D-3 主线 = 官方 Web UI 发行物复用（自绘 UI 为 P2，ADR-006 启用）
  - D-4 基线钉本地检出 `dsh-v0.1.0-rc.8`（rc.12 差异登记 sync-upstream，M4 升级前核查）
  - D-5 载波替换 = roster/manifest 覆盖 IPC 变体（不改 dist）
  - D-6 兼容层 = `ctx.desktopRoutes` + fetch 拦截白名单（ADR-007）
- **风险与技术债记录**：
  - R5 open：`dsh-ui://` 在真实 file:// 环境的官方 dist 资源路径绝对路径语义未验证（bundle route 已通过；M1-T4 spike 决出）
  - ~~R4~~ **closed**：dist 构建产物可得性 —— `@deepseek-ai/dsh-web-frontend@0.1.0-rc.8` 直接携带官方 dist 发行物，无需自建构建脚本
  - R6 open：`!!js` 表达式在 overlay patches（JS 对象直传 `boot()`）中不被 Cordis Loader 求值（仅 Include YAML 解析阶段激活）——当前以 TS 直接求值绕过；`dshHomePath()` 等 Cordis 服务需在步骤 4 通过 `prepare` 钩子提供
  - R7 open：`session-persistence-jsonl` / `storage-json` 的 `root` 路径使用硬编码 `.runtime/user-data/...`；待 `dshHomePath` 服务可用后切回 `!!js dshHomePath(...)` 语义
  - 暂存项：自绘 Desktop UI（U-01~08）按 P2 记账，ADR-006 启用前不投入

## 04. 下一步即时行动 (Next Immediate Actions)
- **当前正在处理**：步骤 5 方案 A 已完成（2026-08-26）。**下一步 = 验证官方 dist 资源路径（R5）+ 步骤 6: 零端口验证与崩溃恢复初版**。
- **步骤 6 首要任务**：`netstat` 零监听验证（默认模式）+ `--serve` 兼容模式冒烟 + 崩溃 relaunch 自愈 v0（有限重启 + 熔断）。
- **关键阻塞项**：官方 UI 客户端模块系统需要 `@dsh-desktop/ipc-connection` 客户端模块工厂，当前 IPC 载波经 preload.desktopBridge 独立提供，后续需接入 DSH 模块系统；官方 dist 资源路径绝对路径语义（R5）待验证。
- **AI 交互指令提示**：后续会话可直接提示 "按照 active-context.md 的下一步继续执行"。

## 05. 规则自我演进维护
本文件为动态看板。每次完成任务节点或发生业务需求变更时，AI 必须按 `workflow.md` 场景 C 规则更新协议，同步更新 MD 版并重新渲染 `docs/active-context.html`，确保任务状态与工程代码一致。