# 06 · 客户端插件设计（官方 UI 槽位注入 + 零端口 bundle 兼容）

> 前提：主面复用官方 Web UI 发行物（L2 主线），客户端插件通过官方槽位机制注入 UI。
> 旧 Web 插件兼容策略见 [ADR-007](adr/adr-007-plugin-compat.md)。

## 1. 官方槽位盘点（依据 `packages/client/ui-*` 与现有插件先例）

| 槽位 | 官方占用者 | 我们的注入 |
| --- | --- | --- |
| `conversation.view`（会话页 tab 环） | chat(0) / trajectory(10) / … | `desktop` tab 或状态投影面板（order 20+） |
| `sidebar`（侧栏项） | 会话列表、设置等 | 「桌面」入口：状态、托盘控制、快捷键、更新 |
| `settings`（设置卡） | general / models / plugins / plugin-inventory | 桌面设置卡（通知开关、热键编辑、自启、剪贴板审批、更新通道） |
| `settings.plugins`（插件配置面） | 各插件 config 卡 | desktop-* 各插件的 config 卡（schema 驱动） |
| `sidebar.footer.action` | 重启按钮等 | 「桌面重启」按钮（适配桌面 relaunch 语义） |
| 窗口标题/托盘状态投影 | ui-renderer 管理标题 | 标题显示会话名 + 运行状态（配合 notifications） |

> 先例：`dsh-terminal` 在 `conversation.view` 注册 tab（id `terminal`, order 20）；
> `dsh-restart` 在 `sidebar.footer.action` 注册按钮；
> `dsh-rule-manager` 在 `settings.section` 注册管理分区。

## 2. 客户端插件清单

| 包名 | 槽位 | 功能 | 说明 |
| --- | --- | --- | --- |
| `desktop-client-settings` | `settings` | 桌面设置卡：通知开关、热键编辑、开机自启、剪贴板审批、更新通道（stable/rc/off） | 二期可移入 ADR-006 自绘面 |
| `desktop-client-panel` | `sidebar` + `conversation.view` | 桌面面板：宿主状态、托盘/快捷键开关、协议唤起历史、快速切换会话 | — |
| `desktop-client-statusbar` | 布局注入（css 层面） | 底部/顶栏状态条：活动 agent 数、后台任务、token 快速视图 | P2 |
| `desktop-client-updater` | `settings` | 更新卡：当前版本/最新版本/更新日志/安装按钮/回滚 | — |

## 3. renderer 侧桥接 API（`window.desktopBridge`，preload 白名单）

```ts
interface DesktopBridge {
  // 传输（由 connection 的 IPC 载波子类消费）
  rpc(method: string, body: unknown): Promise<unknown>
  respond(rpcId: string, body: unknown): Promise<{accepted: boolean}>
  onFrame(cb: (frame: unknown) => void): () => void
  // 桌面域（给客户端插件用；读写都过宿主插件）
  onDesktopEvent(cb: (e: { action: string; payload?: unknown }) => void): () => void
  windowControl: { focus(); minimize(); close() }
  getPlatformInfo(): Promise<{ platform; version; channel }>
}
```

## 4. 零端口 bundle 装载（M1 spike 核心验证项）

官方 Web UI 的客户端插件通过 `window.__DSH_BOOT__` 图谱加载：
host 扫描 `dsh.client` 声明 → 组装 manifest → 每个 plugin bundle 经同源 `/plugins/<id>/client.js?rev=` script 到达。
桌面零端口模式下没有 HTTP 服务器，需要替代方案。

**二选一（M1 spike 定案）**：

| 方案 | 原理 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. `dsh-ui://` 协议直读 | 自定义协议注册，浏览器请求 `dsh-ui://plugins/<id>/client.js?rev=` → 主进程从已装载插件包读取 bundle 产物 | 简单直接；与官方 script 到达语义最接近 | 需要自定义协议支持 MIME/rev 校验 |
| B. `BootSeams.loadBundle` 覆写 | dsh-client-web 的 `AppWebEntry(el, seams)` 参数预留的 `loadBundle` 钩子；在桌面版里把「外部 script 执行」换成「IPC 读取 bundle + 注入」 | 完全走官方预留接口 | 需要验证 `seams` 参数在 `file://` 下的完整语义 |

> `dsh-client-web` README：「The optional override parameter `seams` forwards the module system's `loadBundle`
> transport override (`BootSeams`) for environments where external `<script>` execution cannot reach the page context」
> ——正是 Electron `file://` 场景的官方描述。

## 5. 数据/事件分发

- 官方 connection 的帧流（`session/event` 等）经 IPC 桥直通（见 `04-architecture.md §5.1`）。
- 桌面事件：`desktop/action` 等由 host 插件 → IPC → renderer 侧订阅；
  仅当有客户端订阅时才转发（避免无谓 IPC 流量）。

## 6. 旧插件 client 半的兼容（对应 ADR-007）

旧插件（`dsh-terminal`/`dsh-rule-manager`/`dsh-restart`）的 client 半依赖官方槽位 + 同源 `fetch()`：
- 槽位注入：**正常工作**（同一官方 UI roster，相同 `ctx.slots` 注册机制）。
- 同源 `fetch('/terminal/run')` 等：`file://` 或 `dsh-ui://` 下没有同源 HTTP 服务器——需要拦截：
  - 方案 A（bundle 直达）：`desktop-host-compat` 把 `/terminal/run`、`/rules/*` 等注册的路由
    通过 `dsh-ui://` 协议的 `fetch` 拦截映射到 `desktopRoutes` handler（IPC 回传）；
  - 方案 B：渲染器 preload 里 hook `window.fetch`，匹配 `/terminal/run` 等已注册路径 → 改走 `ipcRenderer.invoke('dsh:http', ...)` → 主进程处理；
  - 两种方案均对旧插件**透明**——它们仍调 `fetch(path)`，语义不变。

## 7. 皮肤/主题（P2）

- 官方 `ui-theme` 提供 token 体系（`--dsw-alias-*` CSS 变量）；
- 桌面皮肤 = token 覆盖主题包（纯 CSS 注入，不触碰布局代码）。

## 8. 测试

- 官方 client 插件兼容性：e2e（Playwright + Electron）在桌面窗口跑旧插件回归（规则管理增删改、终端命令、重启按钮）；
- 零端口 bundle 装载：M1 spike 出结论后写专项测试（bundle rev、来源校验、HMR 更新帧）；
- 官方插件生态抽样：`dsh-rule-manager`、`dsh-terminal` 在桌面**无改动**装上即用——M1 门禁。