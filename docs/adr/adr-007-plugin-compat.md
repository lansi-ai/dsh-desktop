# ADR-007 · 旧 Web 插件兼容策略（host 路由面等价物 + 零端口 bundle 服务 + fetch 拦截）

状态：**已接受**（2026-08）· 关联：[`06-client-plugins.md`](../06-client-plugins.md)、[`05-host-plugins.md`](../05-host-plugins.md)

## 背景
桌面模式下宿主以 `boot()` 装配 desktop profile（零端口、无 webserver），依赖官方 Web 面机制的旧插件
（含用户现有 `dsh-terminal` / `dsh-rule-manager` / `dsh-restart`，
均为「host 半 = `ctx.webServer` 路由 + client 半 = 官方槽位 + 同源 fetch」模式）面临三个兼容面：
- `ctx.webServer` 服务不存在（端口禁用）→ host 半注册路由的入口消失
- 零端口下没有同源 HTTP → 官方 `/plugins/<id>/client.js` 无法通过浏览器 script 加载
- `file://` 或自定义协议下，旧插件的同源 `fetch('/rules/*')` 无法到达任何服务器

## 事实盘点（三个现有插件）

| 插件 | host 半依赖 | client 半依赖 |
| --- | --- | --- |
| dsh-terminal | `ctx.webServer` 路由 `/terminal/stream`（SSE，UI 主用）+ legacy `/terminal/run`（一次性） | `conversation.view` 槽 + `fetch('/terminal/stream')` |
| dsh-rule-manager | `ctx.webServer` 路由 `/rules/*`（REST） | `settings.section` 槽 + `fetch('/rules/*')` |
| dsh-restart | `ctx.webServer` 路由 `/restart` | `sidebar.footer.action` 槽 + `fetch('/restart')` |

## 决策

### 1) Host 半：全兼容（目标：旧插件代码零改动）
- 保留 `ctx.webServer` 注册表语义：`desktop-host-compat` 提供 **`ctx.desktopRoutes`（webServer 等价面）**，
  `register({kind, path, handler})` 原样可用，语义 = 挂到 IPC 桥 method 表（零监听）；
  流式路由（SSE）→ 帧下行（`webContents.send('dsh:frame')` 转 SSE 事件）。
- `--serve=<port>` 兼容模式：完整装配官方 `webserver`（loopback），旧插件「HTTP 原义」可用（调试/临场）。
- 旧插件 `inject: ['webServer']`：提供同名兼容服务或 patch 层改指 `desktopRoutes`——M2 spike 二选一。

### 2) Client 半：bundle 交付（端口协议变更，行为一致）
- `dsh.client` 声明、roster、inject 语义不变——客户端插件的**官方槽位注入正常工作**（`conversation.view`/`settings.section`/`sidebar.footer.action` 等）。
- 零端口下 bundle 交付走自定义方案（M1 spike 终选）：
  - 方案 A：`dsh-ui://plugins/<id>/client.js?rev=...` 协议直读（主进程从已装载插件包读取 bundle）
  - 方案 B：`BootSeams.loadBundle` 覆写（`dsh-client-web` README 的预留钩子）
- 官方 dist 里旧插件的**同源 `fetch('/rules/*')`** 等需要拦截：
  - preload `window.fetch` hook 匹配已注册路径 → 改走 `ipcRenderer.invoke('dsh:http', {path, method, body})` → 主进程 → `desktopRoutes` handler
  - 未注册路径一律报错（白名单机制，安全）。

### 3) 验收矩阵（M1/M2 门禁）

| 插件 | host 半（零端口） | client 半（零端口） | 说明 |
| --- | --- | --- | --- |
| dsh-terminal | ✔ desktopRoutes 等价面 | ✔ 官方槽位注入 + fetch 拦截 → SSE | 全链可用 |
| dsh-rule-manager | ✔ | ✔ 槽位注入 + REST 路由 | 全链可用 |
| dsh-restart | ✔（桌面重启语义由 desktop-host-restart 适配） | ✔ 槽位注入 + POST 拦截 | 桥接后原生化 |
| 任意第三方（同类模式） | ✔ | ✔ | 同构保证 |

## 理由
- host 半路由面 = Web 里已有功能的零端口等价物，不增加新契约；兼容窗口不需要（官方 UI 复用为默认，不需要第二个 UI 容器）
- client 半的 bundle 交付与 fetch 拦截 = 标准 Electron IPC 桥的常规用法，技术债最低
- 这三类兼容面覆盖社区插件的**主流模式**（webServer 路由 + 槽位 + 同源 fetch），投入产出比最高

## 后果
- 需维护 `desktopRoutes` 等价面 + fetch 拦截 hook + 零端口 bundle 服务（技术债集中在 `desktop-host-compat` 包）
- M1 spike 必须先出结论（`dsh-ui://` 协议 vs `BootSeams`，fetch 拦截 vs 协议直读）——阻塞 M1 门禁

## 备选否决
- 只做 `--serve`（保留 HTTP 端口）：违背零端口红线与「非套壳」主张
- 不做兼容层：旧插件废弃，迁移成本转嫁用户，社区生态断层
- 兼容窗口（ADR-006 缓冲方案）：官方 UI 复用为主面时不需要第二窗口——自绘 UI 才需要，留到 ADR-006 启用时再引入

## 复查触发
M1 spike 结论；社区插件生态规模变化；官方 UI 槽位/插件机制大版本变更。