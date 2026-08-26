# ADR-002 · 进程模型：Host 内嵌 Electron 主进程

状态：**已接受**（2026-08）· 关联：[`04-architecture.md`](../04-architecture.md)、[`07-desktop-shell.md`](../07-desktop-shell.md)

## 背景
Host 放哪：Electron 主进程内嵌 vs 侧车子进程（Spawn `dsh web`/SDK 子进程）vs 外置（纯套壳）。

## 决策
**Host 以 `dsh-app-boot.boot()` 装配在 Electron 主进程内**（唯一 Node 宿主）。

## 理由
1. 生命周期合一：启动/退出/崩溃恢复程序化可控（`prepare` 钩子注入桌面服务）；侧车列表、日志、重启全部要自己管；
2. 零端口（ADR-003）成为天然形态而非补丁；
3. 桌面能力（`ctx.desktop`）与服务、工具、会话同 context——模型可感知、审计可统一；
4. 官方 Checklist 明示「apps/ 下写装配模块：startHost() + client 子类」，内嵌正是该模式的直接实例。

## 后果
- 主进程更重；Host 崩溃威胁整个应用 → `desktop-host-restart` 兜底（M1-T6）
- Chromium 多进程 + Node 宿主同进程：退出竞态（R6）需 e2e 矩阵
- 单请求单锁：多实例改走「第二实例转发参数」

## 备选否决
- 子进程侧车：失去生命周期/端口零证明/审计统一（L1 社区路线）
- SDK 子进程 + 自绘 UI：L3，主线不采纳（未来作为自绘面增强的载体，见 [03-routes.md](../03-routes.md) Route C）

## 复查触发
上游将 Host 拆分为可独立 embed 的库（如官方出 `dsh-host-embed`）时，评估迁移收益。