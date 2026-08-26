---
description: 工程项目目录结构地图、模块划分与数据分层流动规范（dsh-desktop）
globs: "*"
alwaysApply: true
---

# 工程架构地图 (architecture.md)

## 01. 目录映射与文件放置规则
- `src/desktop-shell/`：Electron 应用外壳（`main.ts` 入口、BrowserWindow 创建、`dsh-ui://` 协议注册、单例锁、崩溃 relaunch）。禁止写业务逻辑与 Host 装配。
- `src/desktop-host/`：宿主装配（`boot()` desktop profile）、`desktop-runtime`（roster/manifest 供给 `__DSH_BOOT__`）、IPC 桥宿主端（unary 表分发 + respond 回填 + 帧路由 per-window）。
- `src/desktop-compat/`：旧插件兼容（`ctx.desktopRoutes` 等价面、preload fetch 拦截白名单、零端口 bundle 服务）。
- `src/desktop-plugins/`：桌面能力 host 插件（desktop-tray / desktop-hotkey / desktop-notify / desktop-settings / desktop-restart 等），一律以插件包形态（`cordis.patch.yml` + `dsh.client` 声明）存在。
- `src/preload/`：`contextBridge` 白名单 API（`desktopBridge`：rpc/respond/onFrame/http/runtime 等）。
- `src/types/`：IPC 契约（`zod` Schema）、DTO、`dsh:*` channel 常量、`AppError` 码表——唯一类型源头，renderer/preload/host 三方共享。
- `src/plugins/`：补充的可 patch 侧插件（如 bundle patch 承载）。
- **放置铁律**：创建任何新文件前核对上述目录；禁止在 `src/` 根目录放置游离业务逻辑；插件边界不得绕开 `ctx.desktop.*` 直连 Electron API。

## 02. 架构分层与数据流向
- **单向数据流与依赖倒置**：
  `renderer（官方 dist，仅消费白名单 bridge）` → `preload（desktopBridge）` → `main（desktop-host IPC 桥）` → `Host 插件树（rpc/approval/会话）`；
  下行：`Host 事件` → `desktop-host 帧路由` → `webContents.send('dsh:frame')` → `preload onFrame` → `renderer 载波变体`。
- **解耦隔离**：renderer 禁止直接触碰 Electron/Node API（唯一出口 = `desktopBridge`）；主进程禁止反向依赖 renderer 业务组件；`desktop-plugins` 只能经 `ctx.desktop.*` 注册能力，不得 import 其他插件内部实现。
- **数据语义**：所有上下行帧逐字复用官方四象限协议（rpcId 纪律、zod、`approval/requested` 稳定 id），转换层只允许「封装」不允许「改写语义」。

## 03. 新建文件定位判定表 (Placement Decision Matrix)
| 当你需要创建以下类型的文件时... | 请强制放置到以下目录： |
| :--- | :--- |
| IPC 契约 / zod Schema / DTO / 错误码 | `src/types/` |
| Electron 窗口/协议/生命周期 | `src/desktop-shell/` |
| Host 装配 / 载波桥 / manifest | `src/desktop-host/` |
| 旧插件路由等价面 / fetch 拦截 / bundle 服务 | `src/desktop-compat/` |
| 托盘/热键/通知/设置等桌面能力插件 | `src/desktop-plugins/[plugin-name]/` |
| renderer 可调用白名单 API | `src/preload/`（同时更新 `src/types/` 契约） |
| 通用无状态纯函数（格式化/路径规范化）| `src/desktop-host/utils/` 或就近 `utils/` |

## 04. 核心设计模式与模块拆分
- **契约定义与数据转换**：网络传输必须使用 DTO（zod 推导类型）；`snake_case ↔ camelCase` 转换统一在 bridge 分发层完成；严禁把 Host 内部对象直接透传给 renderer。
- **组件/类拆分粒度**：单文件 ≤ 200 行（复杂 ≤ 300）；IPC 桥按 domain 拆分（rpc/respond/frame/http 各自模块），禁止一个巨型 `index.ts` 揉合全部通道。
- **状态管理收敛**：窗口/会话/插件装载等全局状态收敛至 `desktop-host` 单例 store；`desktop-shell` 仅持有 UI 壳状态（窗口尺寸/显隐）。
- **插件化红线**：凡桌面能力必须走 `cordis.patch.yml` + host 插件注册（`ctx.desktop.*`）；严禁在 Electron `main.ts` 直接堆业务代码。

## 05. 规则自我演进维护
本文件为架构静态约束。若后续新增业务子模块目录、拆分服务、调整数据流向或重构分层关系，AI 必须按 `workflow.md` 场景 B 规则更新协议，同步正向重构本文件，禁止「架构地图与工程实际脱节」。