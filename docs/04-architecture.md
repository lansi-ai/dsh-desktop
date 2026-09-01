# 04 · 总体架构

> 主线：L2（官方 UI 复用 + 内嵌宿主 + IPC 载波）。自绘 UI（ADR-006/13）为二期可选，不改变本架构的宿主与协议面。

## 1. 架构总览（进程模型）

```
┌────────────────────────────────────────────────────────────────────┐
│  dsh-desktop（Electron）                                             │
│                                                                     │
│  ┌─ 主进程（Node, 唯一 Node 宿主）───────────────────────────────────┐ │
│  │  Cordis Host（dsh-app-boot.boot() 装配 desktop profile）          │ │
│  │   ├─ dsh-base       模型/会话/工具/沙箱/审批/持久化/设置/凭据      │ │
│  │   ├─ web 子集       无 webserver/web-runtime 的 HTTP 面；保留      │ │
│  │   │                 storage、session-*、workspace、api-gateway…  │ │
│  │   ├─ desktop bundle 托盘/热键/通知/剪贴板/协议/更新/compat…（host  │ │
│  │   │                 插件）+ desktopRoutes（webServer 兼容面）      │ │
│  │   └─ api 网关       ctx.apiProxy（进程内 handler）                 │ │
│  │         ▲ IPC 桥（preload 暴露的 window.desktopBridge）            │ │
│  ├─ 主窗口 × N（renderer：官方 Web UI dist 经 dsh-ui:///file://）     │ │
│  │        └─ client 插件 bundle 经零端口 bundle 服务（官方机制）       │ │
│  ├─ Tray / 全局热键 / 通知（宿主插件驱动，非壳层脚标）                  │ │
│  └─ 更新器 / 崩溃恢复 / 协议注册（desktop-updates / desktop-recovery） │ │
└────────────────────────────────────────────────────────────────────┘
```

**核心主张**：主进程 = 官方 Host 的换壳（同一 `boot()` 装配管线），renderer = 官方 Web client 的换载波（同一四象限 RPC，
只换 `doFetch` 与 bundle 到达路径）。桌面不是「第三套实现」，而是官方联机应用家族的一个新成员——与官方在
[GUI 分层说明](https://github.com/deepseek-ai/deepseek-harness)中预留的 Electron 插槽精确对应。

## 2. 模块划分（未来实现期的仓库布局）

```
shell/                        # Electron 应用装配（apps 层，对应官方 apps/cli 的角色）
├─ main.ts                    # startHost() + 窗口/托盘/生命周期 + IPC 桥宿主端
├─ preload.ts                 # contextBridge 白名单 API（window.desktopBridge）
├─ ipc-fetch.ts               # IPC fetch 载波宿主端：routes → ctx.apiProxy 或 desktopRoutes
├─ protocol.ts                # dsh-ui:// 自定义协议注册 + 零端口 bundle 服务
├─ tray.ts / shortcuts.ts …   # 只做「把 Electron 能力暴露给 ctx.desktop 服务」的胶水
bundle/                       # desktop bundle（npm 包，dsh.bundle.patch）
├─ cordis.patch.yml           # desktop profile 的增删改行
└─ package.json               # "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
packages/
├─ desktop-api/               # 共享类型与 schema：IPC 信封、ctx.desktop 接口、desktopRoutes、config schema（零依赖）
├─ desktop-host-core/         # ctx.desktop 服务注册器 + 桌面事件（desktop/action 等）+ 审计
├─ desktop-host-tray/         # 托盘 host 插件
├─ desktop-host-shortcuts/    # 全局热键 host 插件
├─ desktop-host-notifications# 系统通知 host 插件
├─ desktop-host-clipboard/    # 剪贴板 host 插件（写需 approval，读白名单）
├─ desktop-host-protocol/     # dsh:// URL 协议 host 插件
├─ desktop-host-restart/      # 宿主重启/崩溃自愈 host 插件
├─ desktop-host-updater/      # 自动更新 host 插件
├─ desktop-host-compat/       # 兼容层：desktopRoutes（webServer 等价面）、零端口 bundle 服务
├─ desktop-client-*           # 官方 UI 槽位注入（见 06）
└─ desktop-utils/             # 共享小工具
scripts/                      # build-dist / build-shell / sign / make-update / sync-upstream
```

## 3. 数据流（一次对话往返）

```
用户输入（官方 composer）
  → renderer 侧 connection 客户端（IPC 载波子类，替换 WebApiClient 的 doFetch）
  → IPC invoke('dsh:rpc', fullForm) → preload → 主进程桥
  → ctx.apiProxy 进程内 handler（与 Web 完全相同的语义：zod 校验、rpcId、事件）
  → session.prompt → agent loop → llm → 工具执行（含 approval 请求帧）
  → server-request 帧（session/event、approval/question requested）
  → 主进程桥 → webContents.send('dsh:frame') → renderer 侧 readSse 等价物
  → 官方 UI 实时渲染（assistant/chunk 即 token 流）
```

## 4. 与官方三层模型的映射

| 官方层 | Web 应用 | dsh-desktop | 差异 |
| --- | --- | --- | --- |
| Front 层 | `dsh-host-apiproxy`（fetch/ 抽象 + api/ 定义） | 同左，进程内 | 无 |
| Assembly 层 | apps/cli 的 web.ts（composeProfile + boot + webStartup 服务） | shell/main.ts（startHost + desktop 服务 + IPC 桥） | 装配模块是我们的 |
| Carrier 层 | `dsh-host-webserver`（HTTP + WS + bundle 路由 + __DSH_BOOT__ 注入） | **IPC 桥（自定义）+ 零端口 bundle 服务** | 不引入 webserver（零端口） |
| Client libs | dsh-client-* | 同左（dist 原样构建） | 无 |
| Client plugins | 同源 `/plugins/<id>/client.js` | `dsh-ui://` 协议或 `BootSeams.loadBundle` 覆写 | 换到达路径 |
| Applications | `@deepseek-ai/dsh` bin + `dsh-web-frontend` | shell/ + dist 产物 | 我们的 |

## 5. 关键接口契约（设计要点）

### 5.1 IPC 载波（对齐官方 `AbstractApiClient` 子类约定）
- 上行 client-request：`invoke('dsh:rpc', fullForm)` → server-response；
- 下行 server-request 帧：`webContents.send('dsh:frame', fullForm)`（session 事件/审批）；
- 应答：`invoke('dsh:respond', clientResponse)`；重启对齐「reconnect=rebuild」；
- 信封/zod/rpcId 纪律逐字复用官方 `api/rpc.ts`（依赖其类型，防漂移）。

### 5.2 自定义协议
| 协议 | 用途 |
| --- | --- |
| `dsh-ui://` | 加载官方 UI dist（`file://` 的替代；协议可控性/行为更稳） |
| `dsh-ui://plugins/<id>/client.js?rev=` | 等价官方 `/plugins/<id>/client.js` 的零端口 bundle 路由（desktop-host-compat 供给） |
| `dsh://…` | 外部唤起（`dsh://open?session=<id>`、`dsh://ask?q=…`） |

> M1 spike 需验证：`dsh-ui://plugins/...` 方案 vs `BootSeams.loadBundle` 覆写方案，择优后固化（二选一）。

### 5.3 桌面服务（host 端 `ctx.desktop`）
```
interface DesktopService {
  windows: { list(); focus(id); close(id); open(sessionId?); setVisible(id, v) }
  tray: { setMenu(items: TrayItem[]); notify(title, body, {sessionId?}) }
  shortcuts: { register(accel, actionId); unregister(accel) }
  clipboard: { read(); write(text) /* 写需审批 */ }
  protocol: { getPendingInvocation(): Promise<Invocation|null> }
  app: { relaunch(); quit(); getVersion() }
  compat: { routes: DesktopRoutes }
  // 事件（并入 Cordis 事件表）：desktop/action、desktop/notification-click …
}
interface DesktopRoutes {      // webServer 等价面（ADR-007）
  register({kind:'exact'|'prefix', path, handler}): () => void
  // HTTP 语义子集：method/status/json/stream(SSE→帧)/body cap
}
```

### 5.4 配置面（desktop profile 的 patch 行，示意）
```yaml
- insert:
    - id: desktop-core        name: '@lansi-ai/dsh-desktop-host-core'
    - id: desktop-tray        name: '@lansi-ai/dsh-desktop-host-tray'
    - id: desktop-shortcuts   name: '@lansi-ai/dsh-desktop-host-shortcuts'
    - id: desktop-compat      name: '@lansi-ai/dsh-desktop-host-compat'   # desktopRoutes + 零端口 bundle 服务
    - id: desktop-runtime     name: '@lansi-ai/dsh-desktop-host-runtime'  # IPC 桥宿主端+dist 资产供给
- id: webserver
  disabled: true
- id: web-runtime
  disabled: true
```

## 6. 与官方 Web 面的一致性保障

| 面 | 保障手段 |
| --- | --- |
| 协议契约 | 直接类型/导入官方 `apiproxy` 的 api/ 子路径；新增方法自动对齐（五步清单） |
| client 插件 | `dsh.client` 声明、roster、inject 语义不变（经零端口 bundle 服务装载）；官方/第三方 web 插件无改动可用（M1 验收） |
| host 插件 | 同一 Cordis：web 装的全部 host 插件原样装载（依赖 HTTP 路由的经 desktopRoutes 兼容）；`--serve` 模式可完整开 webserver |
| 会话数据 | 同一 `$DSH_HOME` 持久化；桌面与 web 并存（ADR-003 的 `--serve` 模式） |
| 版本 | 锁上游基线；`sync-upstream` 脚本逐 rc 升级并记录 breaking 迁移（ADR-005） |

## 7. 拓扑图（未来补齐）

正式文档将用 Mermaid 给出：desktop profile 组合图、依赖图（packages 间方向纪律）、启动时序图（boot → 握手 → 首页 → 活跃）。
此处先以文字固化结构，实现期以图补全。