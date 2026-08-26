# 05 · 宿主插件设计（desktop bundle）

> 原则：**每个桌面能力 = 一个 host 插件**（Cordis 插件，注册 `ctx.desktop.*` 下的服务/命令/事件）。
> 与官方「一切皆插件」同构：可装配、可卸载（effect 自动清理）、可 patch、可被模型工具调用、动作进轨迹。

## 1. 插件清单与职责

| 插件（包名建议） | 职责 | 暴露的 ctx 服务/事件 | 依赖注入 |
| --- | --- | --- | --- |
| `desktop-host-core` | 注册 `ctx.desktop` 总服务、桌面事件表、动作日志（`desktop/action` → 审计）、配置 schema | `ctx.desktop`（聚合）+ `desktop/action` 事件 | — |
| `desktop-host-runtime` | 装载 dist、注册 IPC 桥宿主端（unary + respond + 帧下行）、`__DSH_BOOT__` 等价物供给、桌面启动握手 | `ctx.desktopRuntime` | `apiProxy`, `clientModules` |
| `desktop-host-tray` | 托盘图标、菜单（会话列表、快速问答框、状态、退出）、气泡提示（配合 notifications） | `desktop/tray` 子命令、`desktop/action: tray.*` | `desktop`, `sessions` |
| `desktop-host-shortcuts` | 全局热键注册/注销（Win `globalShortcut`；mac `Menu` 加速键兼容层）、动作→事件 | `desktop/shortcuts` | `desktop` |
| `desktop-host-notifications` | 系统通知（Win toast / mac 通知中心）、点击回调（定位会话窗口）、完成/审批/错误三类触发点 | `desktop/notification-click` | `desktop`, `sessions`, `events` |
| `desktop-host-clipboard` | 读（白名单上下文）/ 写（**需 approval**）剪贴板；供客户端面板与（可选）模型工具使用 | `desktop/clipboard` | `desktop`, `approval` |
| `desktop-host-protocol` | 注册 `dsh://` 协议、解析唤起参数（open/ask）、路由到窗口/输入框 | `desktop/protocol` | `desktop` |
| `desktop-host-restart` | 宿主异常退出检测、自动重启（事件溯源重建会话视图）、退出前 flush 持久化 | `desktop/app` | `desktop`, `session` |
| `desktop-host-updater` | 版本检查、下载、校验（SHA256）、安装、回滚 | `desktop/updater` | `desktop` |
| `desktop-host-windows` | 多窗口管理（会话独立窗口、焦点跟随 agent 活动、窗口状态持久化） | `desktop/windows` | `desktop`, `sessions` |
| `desktop-host-standby`（可选 P2） | 空闲窗口冻结、低功耗驻留 | — | `desktop` |

## 2. 通用插件骨架（模板，实现期统一）

```ts
// 每个 desktop-* 插件：host 单面（无 client 半）或双面（少量 client 设置 UI）
import { Context } from '@deepseek-ai/cordis'

export const inject = ['desktop']           // 依赖 desktop-core 先就绪
export function apply(ctx: Context): void {
  ctx.effect(() => { /* 注册 Electron 原生能力，返回清理函数 */ }, 'desktop-tray: install')
  ctx.desktop.onAction('tray.click', (p) => { /* … */ })
}
```

## 3. `ctx.desktop` 服务接口（desktop-api 包定义，zod schema 同步）

```ts
interface DesktopCore {
  onAction(action: string, fn: (payload: unknown) => void): () => void   // 审计型事件（emit）
  log(action: string, payload?: unknown): void                            // 结构化日志 + 轨迹
  readConfig<T>(key: string): T | undefined
  // 以下按能力聚合（代理到具体 host 插件；插件未装载时调用抛 SERVICE_UNAVAILABLE 风格错误）
  tray?: TrayApi; shortcuts?: ShortcutsApi; notifications?: NotificationsApi
  clipboard?: ClipboardApi; protocol?: ProtocolApi; windows?: WindowsApi; updater?: UpdaterApi
}
```

**错误模型**：沿用 Harness 错误分类（`CODE_*` 字符串，开放 union，见 `docs/architecture.md` 的 error taxonomy 惯例）；
客户端/工具对未知 code 做降级处理。例：`DESKTOP_TRAY_UNAVAILABLE`、`DESKTOP_CLIPBOARD_DENIED`、`DESKTOP_SHORTCUT_CONFLICT`。

## 4. 桌面-会话联动（事件接线）

| 触发 | 事件 | 动作 |
| --- | --- | --- |
| agent 回合完成且有新消息 | `session/event`（`assistant/message`） | 通知（若窗口不可见） |
| approval/question requested | `approval/requested` 帧 | 通知 + 托盘高亮 + 窗口聚焦（可点击直达） |
| 工具执行错误 | `host/agent-error` / `tool/post-execute` | 通知（可配置静默） |
| 会话被改名/删除 | `session/title` / `session/delete` | 托盘列表刷新、窗口标题同步 |
| 更新就绪 | `desktop/updater-ready` | 通知 + 托盘菜单项 |

## 5. 桌面动作审计（满足 R-15）

- 所有桌面动作（托盘点击、热键唤起、通知点击、协议唤起、剪贴板写、更新安装）→ `desktop/action` 事件 → 统一审计通道：
  - 落 `ctx.logger`（结构化，含时间/动作/会话 id 关联）
  - 可选「进会话轨迹」：在发起会话的 `session/event` 流外，用独立 `desktop/audit` 持久化面（P2：可查询）
- 剪贴板写、文件删除类敏感动作：**必须**先走 `approval`（waterfall 中间件）—复用官方审批管道

## 6. 可选：把桌面能力暴露给模型（P2，谨慎）

- 注册工具 `desktop_*`（如 `desktop_notify`、`desktop_read_clipboard`）需满足：
  - 进 `dsh-tools` 目录即可被守卫执行管道约束；写操作走审批
  - 提示词引导节制：默认**不注入**，靠 settings 开关显式启用
- 风险与对策：模型误触桌面动作 → 默认全关、审批兜底、动作白名单由用户配置

## 7. 与其他宿主插件的互操作（旧 Web 插件 host 半兼容）

- **第三方 web 插件**（用户现有 `dsh-terminal` / `dsh-rule-manager` / `dsh-restart` 均为此模式）：
  依赖 `ctx.webServer.register` 注册 HTTP 路由。桌面 profile 禁用真实 webserver → 由 **`desktop-host-compat`** 提供：
  - **`ctx.desktopRoutes`（webServer 等价面）**：`register({kind, path, handler})` 原样可用，
    语义 = 挂到 IPC 桥 method 表（`dsh:http:<method>:<path>`），零监听；SSE/长连接路由经帧下行通道；
  - `--serve=<port>` 兼容模式：完整装配官方 `webserver`（loopback），旧插件「HTTP 原义」可用（调试/临场）；
  - 旧插件 `inject: ['webServer']`：提供同名兼容服务或 patch 层改指 `desktopRoutes`——M2 spike 二选一（ADR-007）；
  - 目标：**三个旧插件 host 半零改动可用**（M2 验收矩阵，[ADR-007](adr/adr-007-plugin-compat.md) §3）。
- **官方 `dsh-web-app` 的 webStartup/webRuntime**：本 bundle 提供 `desktopStartup`（等价服务）供给桥接与握手参数

## 8. 实施约束

- 每个 host 插件**单包单职责**，可独立 `pnpm build`；`cordis.patch.yml` 逐行 insert/disable（用户可整行删）
- 插件不得 import Electron 之外的原生依赖（如 Windows API）直入——统一经 `shell/` 胶水（Electron 能力层）暴露，
  保持「宿主插件可单测、可在纯 Node 环境跑」的可测试性
- 插件间协作只走 Cordis 服务/事件（方向纪律同官方：跨包 value import 是构建错误）