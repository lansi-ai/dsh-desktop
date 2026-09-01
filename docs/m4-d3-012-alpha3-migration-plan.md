# M4-d3 · `0.1.1-rc.2 → 0.1.2-alpha.3` 载波深度迁移技术方案

> 状态：**✅ 已执行完成（2026-09-01）**（用户批准方案后按批次实施完毕，实机验证全链路可用）
> 背景：用户决策「实际执行 M4-d3 0.1.2 升级专项」（推翻 M4-d1b 的「不选」结论，重新定义 M4 优先级）。
> 与其配套：本方案改码前评审，符合 `workflow.md` 00 契约确认 + 02 契约优先（API-First）。

---

## 0. 结论速览（TL;DR）

1. 依赖升级已落地：4 官方依赖 `0.1.0-rc.8 → 0.1.2-alpha.3` 已 `npm install` 成功。
2. **0.1.2 对桌面是「整条内核传输链重写」，不是「4 项补丁」**：`@deepseek-ai/dsh-host-apiproxy` 从 npm **删除**，`ctx.apiProxy.events.mux/host`、`toFetchHandler`、`AbstractApiClient` 全部废止，替代为 **`typert-gateway` + `ctx.connection`(HostConnectionHandle) + renderer `__DSH_TRANSPORT__` 自持传输**。
3. 桌面迁移形态 = **官方 worker-preview 自持传输 shell 的同构镜像**（`packages/experimental/webworker-runtime`），这是 0.1.2 为「外壳拥有异物理传输」设计的唯一正轨。
4. 第三方插件 `@lnyanhongyan/dsh-opencode-usage`（peer 锁 `rc.7`）与 0.1.2 **不兼容**，本轮已从依赖移除，看板登记为衍生挂起项。
5. 按 M4-d3 四专项拆解实施，每专项独立可验证，最后一并 typecheck/lint + 看板双落盘。

---

## 1. 现状与 0.1.2 差异（改造基线）

### 1.1 已确认的 0.1.2 事实（源码核实 `_harness-012a3`）

| 拴合面 | 0.1.1-rc.2（旧） | 0.1.2-alpha.3（新） | 桌面影响 |
| --- | --- | --- | --- |
| **S2 · IPC 载波** | `AbstractApiClient` 基类，桌面 `ipc-connection.js` 继承并覆写 `doFetch/openMux/openHost` | `AbstractApiClient/WebApiClient` **删除**；`ctx.provide('connection', handle)`；官方 connection 客户端**读 `__DSH_TRANSPORT__` 选传输** | `ipc-connection.js` 重写为传输注入（见专项①） |
| **S3b · runtime/manifest** | `@deepseek-ai/dsh-client-runtime` 单一包 | **删除**，拆为 `dsh-client-modules` + `dsh-client-store` + `dsh-client-ui-renderer`/`ui-session`/`ui-theme`/`locale` 等 | 静态注册 `dsh-client-store`；`dsh-client-modules` 替代 `client-runtime` 入图谱（见专项②） |
| **S3 · host 装配** | `dsh-host-apiproxy` 提供 `ctx.apiProxy + events.mux/host` | **已删除**，替代 `dsh-api-gateway`(typert-gateway) + `dsh-api-remotes` + `dsh-client-connection`(host) | boot.ts 装配重做（见专项②） |
| **S1 · 装载协议** | `BootSeams.loadBundle` | 新增 `__DSH_BOOT_READY__` 就绪门控；prefetch 不再读 `__DSH_TRANSPORT__.loadBundle` | boot 注入补就绪门控（见专项③） |
| **M6 自研插件** | `defineStore` 来自 `@deepseek-ai/dsh-client-runtime/client` | `defineStore` 迁移至 `@deepseek-ai/dsh-client-store`；ui-slots 核心/SlotCore/renderSlot/ctx.layout 签名**未变** | 改 `require` 源 + 补 store 依赖（见专项④） |

### 1.2 0.1.2 的连接/事件下行模型（关键认知）

```
renderer 插件(ui-*, session-controller)
   └─ ctx.remote.$on/$stream/namespace         ← 唯一下行入口（@deepseek-ai/dsh-api-gateway/client）
        └─ ClientRemoteService                  ← 拥 connection loop 的唯一 owner
             ├─ registerGenerationSource(source)＝ClientRemoteEvents.pumpEvents → openStream('$events')
             ├─ connection.rpc.call('/api', endpoint, payload)                    ← unary
             └─ openRemoteStream() → connection.rpc.open 或 RemoteStreamMuxClient(WS)
   ctx.connection（@deepseek-ai/dsh-client-connection/client 提供）
        └─ apply() 读 window.__DSH_TRANSPORT__ 选传输
```

- host 下行事件（`session/event`、`approval/requested`、waterfall 等）**统一收敛到 Connection 的 generation source**（`$events` 流），不再有独立 mux/host 双流。
- 官方 `createWebConnectionRpc(transport.fetch, transport.openStream)` 已把 carrier 信封编码 / `rpcId` 校验 / server-response 解包**封装在客户端内**，桌面无需重写协议。
- `ownsHost:true` 使 `ctx.connection.isLoopback` 恒真（绕过 Origin/信任围栏）。

---

## 2. 目标架构（桌面 0.1.2 传输形态）

```
┌─ renderer（官方 dist + 自绘插件）─────────────────────────────┐
│  window.__DSH_TRANSPORT__ = {                                  │
│    fetch:      (input,init) => bridgeRpc(input,init),          │  ← preload desktopBridge.request
│    openStream: (endpoint,payload,signal) => bridgeStream(...),  │  ← preload onFrame 多路流
│    ownsHost:   true,                                          │
│  }                                                             │
│  官方 client-connection apply() 读之 → createWebConnectionRpc  │
│  官方 api-gateway(client) 拥 loop → generation source=openStream('$events')
└───────────────┬────────────────────────────────────────────────┘
                │ Electron IPC（dsh-ui:// / dsh:rpc / dsh:frame-stream）
┌───────────────┴────────────────────────────────────────────────┐
│ main → bridge registerIpcBridge                                 │
│  hostCtx（Cordis Host）                                          │
│   ├─ connection  (@deepseek-ai/dsh-client-connection host)      │
│   │    createSharedFetchHandler('/api').fetch  ← unary+$events/result
│   ├─ typertGateway(@deepseek-ai/dsh-api-gateway)                │
│   │    wireStream.open(endpoint,payload,signal) ← $events+业务流
│   └─ api-remotes (@deepseek-ai/dsh-api-remotes)                 │
│        registerRemoteEvents → 产生 $events 源                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 与旧架构的映射（对照下线）

| 旧（0.1.1） | 新（0.1.2） | 动作 |
| --- | --- | --- |
| `ipc-connection.js` 继承 AbstractApiClient 覆写 | `__DSH_TRANSPORT__` 传输注入 | **重写**（专项①） |
| bridge → `ctx.apiProxy` → `toFetchHandler(apiProxy)` | bridge → `connection.createSharedFetchHandler('/api').fetch` | **改**（专项①） |
| `carrier-relay.ts` pump `apiProxy.events.mux/host` | renderer `openStream('$events')` 拉取 host 下行 | **重写**（专项①） |
| boot.ts 装 `host-apiproxy`/`api-gateway` | 装 `connection`(host)+`typertGateway`+`api-remotes` | **改**（专项②） |
| `dsh-client-connection` 仅 preload 注册供继承 | 入图谱，官方 apply 提供 connection | **入图谱**（专项②） |
| `CLIENT_PRELOAD_ONLY`（client-connection 继承基类） | 基类已删；connection 正常入图谱 | **删**（专项②） |
| `dsh-client-runtime` 在 PARSER_PRELOAD 静态预载 | `dsh-client-modules` 替代；`dsh-client-store` 需显式装 | **改**（专项②） |
| boot 脚本无就绪门控 | `__DSH_BOOT_READY__` deferred | **补**（专项③） |
| M6 插件 `defineStore` require `client-runtime/client` | require `@deepseek-ai/dsh-client-store` | **改**（专项④） |

---

## 3. 逐专项实施方案

### 专项① 重写 IPC 载波 → `__DSH_TRANSPORT__` 自持传输

**文件**：
- 重写 `src/desktop-shell/web/ipc-connection.js`（`@lansi-ai/dsh-ipc-connection` →
  `@lansi-ai/dsh-transport-bridge` 或保留 id 但语义改为传输注入）
- 改 `src/desktop-shell/preload.ts`（新增多路流通道）
- 改 `src/desktop-host/bridge.ts`（新增流注册/转发 IPC 通道）
- 重写 `src/desktop-host/carrier-relay.ts` → 删除/改 `downlink-stream.ts`

**renderer 侧 `__DSH_TRANSPORT__`**（对齐 worker preview 的 `connectWorkerHost`，物理通道换 preload）：
```js
globalThis.__DSH_TRANSPORT__ = {
  fetch(input, init) {
    // createWebConnectionRpc 已构造 POST {channel}/{endpoint} + client-request body
    // 直接转发 preload → host connection.createSharedFetchHandler('/api').fetch
    return bridgeFetch(input, init)
  },
  openStream(endpoint, payload, signal) {
    // 逻辑流载波：$events / session.control 等 → host typertGateway.wireStream.open
    return bridgeOpenStream(endpoint, payload, signal)
  },
  loadBundle: undefined,   // 桌面沿用既有 bundle 装载面
  ownsHost: true,
}
```
- 必须在 connection 插件 `apply()` 前注入 → 通过在 HTML boot 脚本（`dsh-ui-protocol.ts` 的 `bootManifestScript`）里、`__DSH_BOOT__` 之前 inner 一段 `<script>` 设置全局。

**preload 新增多路流通道**（替代旧单一 `onFrame`）：
- `openStream(streamId, endpoint, payload): () => void`（发 `dsh:stream-open`）
- `onStreamFrame(cb(streamId, frame))`（收 `dsh:stream-frame`）
- `onStreamClose(cb(streamId, reason))`（收 `dsh:stream-close`）
- 保留 `request`（unary 信封透传，现服务 `__DSH_TRANSPORT__.fetch`）。

**host bridge 新增流管理**：
- `ipcMain.handle('dsh:stream-open', ...)`：登记 streamId → 订阅 `connection.createSharedFetchHandler`/`typertGateway.wireStream.open`，逐帧 `webContents.send('dsh:stream-frame', {streamId, frame})`；流结束/窗口销毁发 `dsh:stream-close`。
- unary `dsh:rpc` fallback：从 `callApi(apiProxy)` 改为调用 host `connectionFetch.fetch(request)`（覆盖业务端点 + `$events/result`）。
- `dsh:respond`：改为 `$events/result` unary 回传（`connection.rpc.call('/api','$events/result',...)` 语义由官方 client 处理，host 侧对接 `createSharedFetchHandler`）。

**下行中继**：删除 `carrier-relay.ts` 的 mux/host 双流 pump，由 renderer `openStream('$events')` 主动拉取（host `wireStream.open` 逐帧推）。

### 专项② 适配 runtime/manifest 装配 + store 静态注册 + connection 入图谱

**文件**：
- 改 `src/desktop-host/boot.ts`：§1 移除 `api-gateway`(host-apiproxy)，新增装配 `connection`(host `@deepseek-ai/dsh-client-connection`) + `typertGateway`(`@deepseek-ai/dsh-api-gateway`) + `api-remotes`(`@deepseek-ai/dsh-api-remotes`) + `typert`(`@deepseek-ai/dsh-typert-registry`)；§3 移除 `api-remotes = disabled`（现需启用供 `$events` 源）；删除对 `host-apiproxy` 的 disabled 覆盖。
- 改 `src/desktop-host/manifest.ts`：`getIpcCarrierPatchEntries()` 不再禁用 `connection`（现在需要官方 host connection），仅禁用 `client-runtime`（已不存在）→ 改为组装新条目。
- 改 `src/desktop-host/boot-graph.ts`：
  - `CLIENT_CONNECTION_ID` 从 `PRELOAD_ONLY_IDS` 移除，正常进入扫描图谱（`CLIENT_EXCLUDE_IDS` 不再 skip it）。
  - `PARSER_PRELOAD_IDS`：`@deepseek-ai/dsh-client-runtime` → `@deepseek-ai/dsh-client-modules`。
  - `IPC_CONNECTION_ID` 语义改为「transport-bridge 传输注入」，保留图谱（在 connection 前 materialize）。
- 依赖：显式 `@deepseek-ai/dsh-client-store`（当前未落 node_modules，需加入 package.json dependencies，供 seed/静态注册与 M6 `defineStore` 解析）。

### 专项③ 补 `__DSH_BOOT_READY__` 就绪门控

**文件**：`src/desktop-shell/dsh-ui-protocol.ts`（`bootManifestScript`）
- 注入 `<script>globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers(); ...resolve()</script>`，在 `__DSH_BOOT__` 图谱 + 注入表生效后 resolve。
- 官方 `AppWebEntry.run()` 首行 `await globalThis.__DSH_BOOT_READY__?.promise` → 桌面注入尾 resolve（对齐官方 `READY_MARKUP`）。

### 专项④ M6 自研插件契约重对

**文件**：`src/desktop-shell/web/desktop-layout-client.js`（`defineStore` 处）等 M6 插件
- 凡 `require('@deepseek-ai/dsh-client-runtime/client')` 取 `defineStore` 处 → 改 `require('@deepseek-ai/dsh-client-store')`（签名不变）。
- 复核点：`ctx.slots.register({name,children,store})`、`ctx.layout`(LayoutController/attachPanels)、sidebar owner props `{collapsed,width}`、`renderSlot`、`SlotCore` —— 均已确认 **0.1.2 与 0.1.1 相同**，无需改。
- `boot-graph.ts` 中 `@lansi-ai/dsh-*` 插件的 `external`/`inject` 依赖若引用 `client-runtime` → 改对应新包（`ui-renderer`/`ui-session`/`locale`/`api-workspace-controller`/`ui-workspace`）。

---

## 4. 工程落地顺序（分批 commit）

| 批次 | 内容 | 验证 |
| --- | --- | --- |
| B0（已做） | package.json → 0.1.2-alpha.3 + npm install；移除不兼容第三方插件 | `npm install` 成功 |
| B1 | 专项①：preload 多路流 + bridge 流管理 + `__DSH_TRANSPORT__` 注入 + 删 carrier-relay | typecheck |
| B2 | 专项②：boot 装配 + manifest + boot-graph + store 依赖 | typecheck |
| B3 | 专项③：`__DSH_BOOT_READY__` 门控 | typecheck |
| B4 | 专项④：M6 插件 `defineStore` 源迁移 + external 对齐 | typecheck |
| B5 | 全量 typecheck + lint 零告警 + 看板 MD/HTML 双落盘 + 提交 | 门禁 |

---

## 5. 风险与验证

- **风险 R1（高）**：跨 host/renderer 传输链重写，需实机验证官方 UI 对话端到端；建议 B1 后先 `npm run dev` 冒烟（`DSH_VERBOSE=1`）。
- **风险 R2（中）**：`dsh-client-store` 当前未落 node_modules，静态注册/M6 `defineStore` 解析依赖显式加入；加入后复验是否触发 peer 冲突。
- **风险 R3（中）**：多窗口每窗口独立 carrier-relay 需改为每窗口独立流表（`webContents` 关联 streamId）。
- **风险 R4（中）**：`__DSH_TRANSPORT__` 注入时机须先于 connection `apply()`——用 HTML boot 脚本内嵌保证。
- **风险 R5（低）**：`--serve` 兼容模式下第三方 webServer 路由仍需 `dsh-host-webserver`（此包在 npm 仍存在），`boot.ts` 的 serve 分支需核对。

## 6. 未纳入（登记看板）

- `@lnyanhongyan/dsh-opencode-usage` 第三方插件（peer 锁 rc.7）——与 0.1.2 不兼容，本轮移除，待其升版后重装。
- `dsh-cordis-host-runner` 未装载（既有 dogfood 遗留），与 0.1.2 无关，留 M5。