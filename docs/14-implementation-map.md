# dsh-desktop 实现地图（Implementation Map）

> 基线：`dsh-v0.1.2-alpha.3`（2026-09-01 M4-d3 由 rc.8 直升；方案见 `m4-d3-012-alpha3-migration-plan.md`）· Electron 44 · 状态：M3 代码完成，M4-d3 0.1.2 升级专项完成，M3-b4 dogfood 与 M4 分发并行推进（2026-09-01）。
> 本文回答三个问题：**程序由哪些部分组成**（架构）、**每部分代码在哪**（位置）、**关键链路怎么走**（实现细节）。

![dsh-desktop 架构图](architecture-diagram.jpg)

---

## 1. 一句话架构

**Electron 主进程内嵌 Cordis Host**（D-1），官方 Web UI 发行物经自定义协议 `dsh-ui://` 加载（D-3），所有 client↔host 通信经 **Electron IPC 载波**（D-2，零 TCP 端口），桌面能力（托盘/通知/快捷键/剪贴板/自启/审计）以 `ctx.desktop` 聚合服务 + bridge unary 方法表形态提供（M2）。

```
┌────────────────────────── Electron 主进程 ──────────────────────────┐
│  desktop-shell (main.ts)      ── 应用外壳：窗口/协议/崩溃自愈/生命周期     │
│  desktop-host (boot.ts)       ── Cordis Host 装配：overlay patches 插件树 │
│    ├─ apiProxy (dsh-host-apiproxy)  ── 官方 RPC 入口 + mux/host 事件流    │
│    ├─ ctx.desktop (desktop-api.ts)  ── 审计总线 + 配置 + 下行桌面事件      │
│    ├─ ctx.webServer 等价面 (compat)  ── 第三方插件 HTTP 路由内存化        │
│    └─ WindowManager              ── 多窗口注册表 + 持久化                   │
│  bridge.ts                    ── IPC 桥：unary 方法表 + 帧路由 + respond │
└────────────────────┬───────────────────────────────────────────────┘
                     │ Electron IPC（dsh:rpc / dsh:frame / desktop:invoke …）
┌────────────────────┴───────────────────────────────────────────────┐
│  preload.ts                   ── contextBridge 白名单 window.desktopBridge │
│  renderer（官方 dist + 注入）  ── ipc-connection.js 载波变体 + 桌面 UI 插件 │
│    加载方式：dsh-ui://app/index.html（协议层注入 __DSH_BOOT__ 图谱）       │
└────────────────────────────────────────────────────────────────────┘
```

## 2. 分层与数据流

- **单向数据流**：`renderer（仅消费 desktopBridge 白名单）→ preload → bridge（zod 校验 + unary 表/apiProxy 分发）→ Cordis Host 插件树`。
- **上行 RPC**：`ipcRenderer.invoke('dsh:rpc', {rpcId, method, params})` → bridge 先查 unary methodTable（桌面专属方法），未命中 fallback 到 `apiProxy`（官方 `toFetchHandler` 经 `/api/<method>` 虚拟路由分发给 host 服务）。
- **下行帧**：Host `apiProxy.events.mux/host`（AsyncIterable）→ `carrier-relay.ts` 逐帧 → `webContents.send('dsh:frame', payload)` → preload `onFrame` → `ipc-connection.js` 的 `readIpFrames` 重包 `{rpcId, payload}` 交官方 ConnectionController 分发到各 sink。
- **帧应答**：renderer `respond(rpcId, body)` → bridge `dsh:respond` → apiProxy 的 `/api/respond` 回填。
- **解耦铁律**：renderer 禁触 Electron/Node API；主进程不反向依赖 renderer；所有 IPC 入参先过 zod（`src/types/contract.ts`）。

## 3. 目录 → 职责速查（放置铁律见 architecture.md）

| 路径 | 职责 | 关键文件 |
|---|---|---|
| `src/desktop-shell/` | Electron 外壳：入口、协议、参数、崩溃自愈 | `main.ts` / `preload.ts` / `dsh-ui-protocol.ts` / `argv.ts` / `relaunch.ts` / `web/*` |
| `src/desktop-host/` | Host 装配、IPC 桥、载波、桌面能力模块 | `boot.ts` / `bridge.ts` / `boot-graph.ts` / `manifest.ts` / `carrier-relay.ts` / `window-manager.ts` / `desktop-*.ts` / `compat-webserver.ts` / `dsh-protocol.ts` / `session-rewarm.ts` / `theme-sync.ts` / `cordis-inventory.ts` / `log.ts` |
| `src/types/` | 唯一类型源头：zod Schema + channel 常量 + 错误码 | `channels.ts` / `contract.ts` / `desktop.ts` / `window.ts` / `errors.ts` / `boot.ts` |
| `src/desktop-compat/`、`src/desktop-plugins/` | 预留目录（当前能力以项目内模块形态在 desktop-host） | — |
| `docs/` | 设计文档、ADR、坑档、dogfood 台账 | `upstream-contracts.md` / `pitfalls.md` / `dogfood-issues.md` |
| `scripts/` | 构建/打包辅助 | `copy-web.cjs` / `make-sums.cjs` 等 |

---

## 4. 启动时序（main.ts bootstrap）

```
userData 重定向(dev) → parseArgv(--serve/--hidden) → 注册 dsh-ui scheme 特权
→ app.setAsDefaultProtocolClient('dsh') → 崩溃处理器+熔断守卫 → 单实例锁
→ whenReady:
  1. registerDshUiProtocol()                 （协议 handler：dist/bundle/compat 三路由）
  2. registerIpcBridge()                     （dsh:rpc / dsh:respond / dsh:ready / desktop:invoke）
  2.5 registerCordisInventoryCompat()        （必须早于建窗，防 404 被客户端缓存）
  3. bootDesktopHost()                       （Cordis 插件树挂载；见 §5）
  3.5 Agent 预设诊断探针                     （失败必显：坑 16 第一现场）
  4. setApiProxyHandler(callApi)             （unary 未命中 → toFetchHandler + typertGateway fallback）
  4.6 installThemeSync() + await ready        （ui-theme 偏好 → nativeTheme，建窗前保证首帧正确）
  4.5 rewarmPersistedSessions(callApi)       （冷会话 session.create 重挂载；坑 11）
  5. registerIpcCarrierServices(hostCtx)     （ipc-carrier / api-proxy 服务注册）
  6. createWindow()                         （主窗口，dsh-ui://app/index.html）
  7. createWindowManager() + registerWindowManagerMethods + setWindowManager
  7.6 loadState()/restorePersistedWindows() （--hidden 时跳过恢复）
  8. startDownlinkRelay(apiProxy, mainWin)  （mux/host 双流 → dsh:frame）
  9. 桌面能力装配（需 ctx.desktop）：
     tray + notify + shortcuts + clipboard + cmdpalette + audit-viewer + autostart
  10. 路由 pendingDshUrl（second-instance/open-url/启动参数缓存）
```

退出（`before-quit`）：`windowManager.saveState/dispose` → 各能力清理函数 → `removeIpcHandlers()` → `resetOnCleanQuit()`（熔断计数清零）。

## 5. Host 侧装配（boot.ts）

- `bootDesktopHost()` 调官方 `@deepseek-ai/dsh-app-boot` 的 `boot('dsh-desktop', cordis.yml, patches, prepare, bareModuleBaseUrl)`。
- 根配置 = `.runtime/cordis.yml`（内容 `[]`，仅作 Include 根锚点），全部配置由 **overlay patches** 覆盖：
  - **§1 insert**：全量核心 host 服务（llm/session/agent/sandbox/fs/tools/skill/subagent/workflow…约 70 条），含 `api-gateway`（ctx.apiProxy，下行事件流来源）与第三方 `opencode-usage`。
  - **§2 覆盖**：`system-prompt` 桌面 persona。
  - **§3 禁用**：`webserver/web-runtime/web-startup/connection/client-runtime/cordis-host-runner` 等 Web 传输层（零端口红线）。
  - **§4 insert**：`storage/storage-json/storage-domain/agent-presets`（坑 16：必须经 insert 数组进树，非 insert 补丁对空根配置是静默 no-op）。
  - 补丁值策略：原 `!!js` 表达式全部在 TS 中直接求值（R6 规避）。
- **prepare 钩子**（Loader 安装后、插件树挂载前）注入：
  - `cmdlineArgs`（provideCmdline）、`desktopStartup` 元信息（portless/serve）；
  - `ElectronDirectoryPicker`（extends 官方 DirectoryPicker，用 Electron dialog 替代 koffi FFI 崩溃路径）；
  - `ctx.desktop` 聚合服务（desktop-api.ts）；
  - `ctx.webServer` 等价面（compat-webserver.ts）。
- `RUNTIME_ROOT`：dev → 项目 `.runtime/`；打包 → `userData/.runtime`（asar 只读收口）。
- `--serve[=port]` 兼容模式：额外 INSERT webserver 条目绑定 loopback（默认 38000），供旧插件 HTTP 原义路由。

### 5.1 上行 RPC 落地细节（main.ts callApi）

```ts
// 官方 toFetchHandler(apiProxy) 把 client-request envelope 经 /api/<method> 分发
const apiFetch = toFetchHandler(apiProxy)
const callApi = async (method, params) => {
  const res = await apiFetch.fetch(new Request(`http://local/api/${method}`, {...envelope}))
  if (res.status === 404 && typertGateway) {
    // Typert remote 端点（commands/list 等）不在 apiProxy unary 表，走 gateway 兜底（坑 12）
    const r = await typertGateway.invokeRpc(method, params)
    ...
  }
  return unpackServerResponse(res)  // 解包 server-response 信封 result.ok → value
}
```

`http://local` 为虚拟 base（toFetchHandler 只读 pathname）。

## 6. IPC 桥（bridge.ts）

- **通道**（`src/types/channels.ts`）：
  - 上行：`dsh:rpc`（invoke 返回 server-response）、`dsh:respond`（帧应答）、`dsh:ready`（就绪通知）、`desktop:invoke`（桌面能力统一入口）。
  - 下行：`dsh:frame`（server-request 帧）、`desktop:event`（桌面事件）、`desktop:window-event`（窗口广播）、`desktop:session-context`（会话上下文注入）。
- **unary methodTable**（Map<method, handler>）：桌面专属方法优先命中；未命中 fallback `defaultApiProxyHandler`。已注册方法族：
  - `desktop.getPlatformInfo` / `desktop.windowControl.{focus,minimize,close}`
  - `desktop.window.{create,closeBySession,closeById,focusBySession,listSessions}`（registerWindowManagerMethods）
  - `desktop.shortcut.{register,unregister}`、`desktop.clipboard.{readText,writeText}`、`desktop.panel.{open,close}`
  - `desktop.cmdpalette.{open,quickAsk,switchSession,close,listSessions}`
  - `desktop.audit.{query,listActions}`、`desktop.autostart.{setEnabled,getStatus}`
  - `dynamicCordisRunner/inventory`、`pluginInventory/list`（插件清单等价面）
- **READY 追踪**：preload 就绪通知 → `windowStates` 标记 + WindowManager 自动推送会话上下文。
- **帧发送**：`sendFrame`（zod frameSchema 校验 + 本地监听器分发）、`broadcastFrame`（仅就绪窗口）、`broadcastWindowEvent`。
- 错误统一 `AppError`（code/message/data，`src/types/errors.ts` 码表 1xxx/2xxx/3xxx/4xxx/5xxx）。

## 7. 零端口载波（client 侧）

### 7.1 `__DSH_BOOT__` 图谱（boot-graph.ts，纯逻辑不依赖 Electron）

- **自动扫描** `node_modules/@deepseek-ai` 下所有 `dsh.client.platform==='web'` 包（复刻官方 ClientModuleRegistry：inject/external/immediately + 拓扑排序 `orderByModuleGraph`）。
- **关键排除**：
  - `@deepseek-ai/dsh-client-connection` **不入图谱**（D-9：官方驱动对图谱全量激活，会抢注 connection 服务 → 404/retry），改为 HTML 预载注册 factory（`PRELOAD_ONLY_IDS`）。
  - `dsh-client-ui-directory-picker-browse`（与 native 版互斥，双激活抛 "already has a registration"）。
- **桌面注入条目**：`@lansi-ai/dsh-ipc-connection`（载波）、`@lansi-ai/dsh-desktop-layout`（布局插件，接管 root 槽位，官方 ui-layout 经 CLIENT_EXCLUDE_IDS 禁用）、`@lansi-ai/dsh-desktop-settings`、`@lansi-ai/dsh-desktop-panel`、`@lansi-ai/dsh-desktop-cmdpalette`（现已禁用壳）、`@lansi-ai/dsh-desktop-audit-viewer`。
- **关键排除（2026-08-27 追加）**：`@deepseek-ai/dsh-client-ui-layout`（官方布局插件，与 `@lansi-ai/dsh-desktop-layout` 抢注 root 槽位，方案 B 互斥）。
- **HTML 注入脚本**：queue shim（`window.__ModuleLoader__` 队列模式）+ 预载 script（client-modules/client-runtime/client-connection）+ `window.__DSH_BOOT__ = <graph JSON>`（`<` 转义为 `\u003c` 防逃逸）。
- **bundle route**：`/plugins/<id>/client.js[.map]?rev=<sha1-12>`，`resolveBundleRequest` 从 `bundlePathMap` 直读产物；rev = 内容 hash 破缓存。

### 7.2 `dsh-ui://` 协议（dsh-ui-protocol.ts）

请求处理优先级：**bundle route**（`/plugins/*`）→ **compat 路由**（`matchesCompatRoute` 动态白名单 → `dispatchHttpCompat`）→ **静态文件**（官方 dist 或占位页；`resolveRelative` 仅取 pathname，normalize 防越界；index.html 注入 boot 图谱）。
scheme 特权：standard/secure/supportFetchAPI/corsEnabled（注册须在 whenReady 前）。

### 7.3 ipc-connection.js（renderer 载波变体，浏览器 bundle）

- 继承官方 `AbstractApiClient`（require 预载的 client-connection 取基类）：
  - `doFetch` → `desktopBridge.request`（信封透传，保留 rpcId）→ 包回 server-response 信封；
  - `openMux/openHost` → `readIpFrames`：`desktopBridge.onFrame` 帧入队列 + waiter 唤醒，产出 `{rpcId: streamRpcId, payload: frame}` AsyncIterable；
- `MinimalConnectionLoop`：常驻泵 mux/host 双流到 sinks；`host.describe` 成功触发 `onConnected`。
- `rpc.call('/api', endpoint, {args})` 逻辑通道 → host typertGateway 对接。
- `apply` 时 `ctx.provide('connection', handle)` —— **独占提供 connection 服务**（替代官方 Web 传输）。

### 7.4 compat-webserver（ctx.webServer 等价面）

- `HttpCompatRegistry` 内存路由表：`register({kind:'prefix'|'exact', path, handler})`（对齐官方 webServer.register 语义）。
- `dispatch` 构造 req（asyncIterator 读 body）/res（writeHead/end 收集内存）喂给官方 handler —— 对第三方插件（如 opencode-usage）完全透明。
- renderer 侧插件 `fetch('/<route-prefix>/*')` 因与页面同源（dsh-ui://app）被协议层拦截转发。

## 8. 多窗口（WindowManager，window-manager.ts）

- 双向绑定：`windowRegistry: Map<windowId, WindowRecord>` + `sessionToWindow: Map<sessionId, windowId>`；`createSessionWindow` 去重（已存在聚焦）。
- 每个会话窗口独立 `startDownlinkRelay`（per-window 帧 pump）+ 独立 preload READY。
- 持久化：`userData/window-state.json`（bounds + zIndex + sessionId，debounce 500ms；重启按 zIndex 排序恢复；`--hidden` 跳过恢复）。
- 窗口事件广播：`window/created|closed|state-changed`、`session/list-updated` → `desktop:window-event` 通道。
- 会话上下文注入：READY 后 `desktop:session-context` 推送 `{sessionId, windowId, ts}`。
- 状态：`M3-a4 命令面板与多窗口全量验证已挂起`（2026-08-27 用户决策；dogfood 仅验「不崩不干扰」）。

## 9. 桌面能力模块（desktop-host/desktop-*.ts）

均以项目内模块形态存在（prepare/main 装配，插件包化留 M5），统一经 `ctx.desktop`（DesktopCore：onAction/emitAction/log/readConfig/writeConfig/sendDesktopEvent）+ `registerMethod` 接入 bridge。

| 模块 | 功能 | 要点 |
|---|---|---|
| `desktop-api.ts` | `ctx.desktop` 聚合服务 | 审计 JSONL 串行写盘（`userData/audit.jsonl`）；配置懒注册 settings `desktop` namespace（schemastery dict），未就绪回退内存；`sendDesktopEvent` 广播到全部窗口 |
| `desktop-tray.ts` | 托盘 | 关窗驻留（close 拦截 → hide，`quitting` 标记放行）；菜单（显示/快速问答/退出）；黑白双版图标随 nativeTheme |
| `desktop-notify.ts` | 系统通知 | 消费独立冷流 `events.mux`；approval/error/session 三类；窗口可见且聚焦时免打扰；点击定位主窗口 |
| `desktop-shortcuts.ts` | 全局快捷键 | 预置 Alt+Shift+Q（唤起）、Alt+Shift+Space（快速问答）；动态 register/unregister（zod 校验）；触发 → emitAction + sendDesktopEvent |
| `desktop-clipboard.ts` | 剪贴板 | read 免审批；write 过 approval（R-11），服务不可用降级放行并审计 |
| `desktop-cmdpalette.ts` | 命令面板 host 半 | Ctrl/Cmd+Shift+P → quick-ask 下行；bridge 方法族；UI 已禁用（renderer 侧禁用壳） |
| `desktop-audit-viewer.ts` | 审计查询 | 读 audit.jsonl + 过滤（action/sessionId/时间范围）+ 倒序分页；`desktop.audit.query/listActions` |
| `desktop-autostart.ts` | 开机自启 | `app.setLoginItemSettings({openAtLogin, args:['--hidden']})`；OS 登录项为唯一真源（getStatus 实时读）；dev 模式拦截 |
| `dsh-protocol.ts` | `dsh://` 系统协议 | open（聚焦/创建会话窗口，去重）/ask（quick-ask 预填）/settings（打开设置面板）；second-instance/open-url/启动参数三入口；**R10 安全白名单待 M4-a2** |
| `session-rewarm.ts` | 冷会话预热 | 启动后遍历 `session.list`，对带 cwd 非 subagent 会话 `session.create{sessionId, cwd}` 重挂载（坑 11：blank 复用路径跳过 create 导致 "not attached"） |
| `theme-sync.ts` | 主题联动 | `settings.describe` 读 `ui-theme.preference` → `nativeTheme.themeSource`（system 态直传防反馈钉死）；订阅 mux `settings/document-updated` 增量同步；nativeTheme updated → 刷新黑白双版图标 |
| `cordis-inventory.ts` | 插件清单等价面 | 从 boot 图谱派生 `dynamicCordisRunner/inventory` + `pluginInventory/list`（direct + agent: 前缀双注册） |

## 10. preload 白名单（preload.ts）

- `contextBridge.exposeInMainWorld('desktopBridge', …)`，sandbox + contextIsolation + nodeIntegration:false。
- 面积：`rpc`（自动解包 data）/ `request`（信封透传，官方 doFetch 用）/ `respond` / `onFrame` / `onDesktopEvent` / `windowControl` / `windowManager`（create/close/focus/list + onWindowEvent + onSessionContext）/ `cmdPalette` / `audit` / `autostart` / `desktopShortcut` / `desktopClipboard` / `getPlatformInfo` / `openDesktopPanel` / `closeDesktopPanel`。
- 通道常量在 preload 内联（沙箱无法 require 相对模块，与 `types/channels.ts` 人工同步）。
- 脚本尾部即发 `dsh:ready`（windowId=-1，主进程 fromWebContents 取实际 ID）。

## 11. renderer 注入插件（src/desktop-shell/web/*-client.js）

浏览器 bundle（不参与 Node 编译），经 `__DSH_BOOT__` 图谱条目激活：

- `desktop-settings-client.js`：官方 slots 机制注册 `settings.section`（id=desktop, order=10）——托盘/通知/快捷键/面板位置 Toggle + AutoStartSetting（autostart bridge）+ 快捷键提示；读写经官方 settings（`settings.describe/mutate` RPC）。
- `desktop-panel-client.js`：`sidebar.footer.action` slot 悬浮面板 + `onDesktopEvent` 响应 open/close-panel。
- `desktop-audit-viewer-client.js`：审计 Tab UI（query/listActions bridge）。
- `desktop-cmdpalette-client.js`：**禁用壳**（factory 返回空插件，Ctrl+K 不注册；仅保留 quick-ask 下行 → focusComposer 聚焦官方输入框并预填）。
- `ipc-connection.js`：见 §7.3（connection 服务独占提供）。

## 12. 崩溃自愈（relaunch.ts）

- 主进程 `uncaughtException` → `app.relaunch()`；`unhandledRejection` 仅记录。
- 渲染进程 `render-process-gone` → reload；60s 窗口内 ≥3 次 → 升级整体重启。
- 熔断：`.runtime/relaunch-state.json` 跨进程计数，超限（3 次/60s）拒绝自启；正常退出清零。

## 13. 构建与打包（M4-a1 已完成）

- `npm run build` = `tsc` + `copy-web.cjs`（web bundle → dist）。
- `npm run dist` = build + `electron-builder --win --publish never` + `make-sums.cjs`（SHA256SUMS）。
- `electron-builder.yml`：nsis + portable 双 target x64；asar: true；`asarUnpack: **/node-pty/**`（winpty/conpty 需真实文件路径）；`npmRebuild: false`（预编译产物）。
- 打包路径适配：`app.isPackaged` → userData 不重定向、`RUNTIME_ROOT` 收敛至系统 userData/.runtime、bareModuleBaseUrl 相对路径天然兼容 asar 布局。
- 镜像注意：GitHub 直连超时需 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`。

## 14. 关键风险与遗留

| 项 | 状态 | 说明 |
|---|---|---|
| R10 协议安全 | **open（M4-a2 第一优先级）** | `dsh://` 来源校验 + 参数 zod 强校验（session id 格式/query 长度）分发前必补 |
| R6 `!!js` | open（已规避） | overlay patches 中不生效，已在 TS 求值替代 |
| R7 硬编码 `.runtime` 路径 | open（已打包收口） | dshHomePath 服务可用前以 RUNTIME_ROOT 兜底，完整可配置化留 M5 |
| `dsh-cordis-host-runner` 未装载 | 技术债 | `dynamicCordisRunner/*` inspect 类 service-unavailable，MVP 非阻断，M5 评估 |
| M3-a4 命令面板 / M3-a5 多窗口全量验证 | 挂起 | 2026-08-27 用户决策；恢复路径见 active-context.md |

## 15. 排障速查

- `$env:DSH_VERBOSE='1'`：全量终端日志（默认热路径静默，`log.ts`）。
- 桥失败必显：`[dsh-bridge] RPC 失败 (method)` 终端留痕。
- Agent 预设空白 → 看启动期 `[dsh-boot] Agent 预设扫描` 探针输出（坑 16）。
- 会话 "not attached" → `[session-rewarm]` 日志（坑 11）。
- 上游拴合面速查：`docs/upstream-contracts.md`；坑档：`docs/pitfalls.md`；dogfood 台账：`docs/dogfood-issues.md`。
