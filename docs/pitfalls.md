# 实战踩坑记录（Pitfalls · 2026-08-26 攻坚第 2 批）

> 本文件记录 M1 攻坚「官方 UI 完成日常对话全流程」过程中实际踩到的坑与解法。
> 目的：**可复用的排障手册**，避免后续会话重复踩坑。
> 每个坑都标注：现象 → 根因 → 修复 → 复盘要点。

## 坑 0 · TRAE 沙箱拦截 Electron 启动（环境，非代码）

- **现象**：`npm run dev` 启动即报
  `TRAE Sandbox Error: Not allow operate files: ...\SogouPY\LOG\IME\electron_*.log`，且 `Start-Process` 拉独立 PowerShell 报 `0x800700e8 (ERROR_NO_TOKEN)`。
- **根因**：搜狗输入法注入到 Electron 进程，启动时写自家 IME 日志，被 TRAE 沙箱拦截；沙箱内 `Start-Process` 无创建新 GUI 进程的 Windows 令牌。
- **解法**：Electron 是 GUI 应用，必须在**系统 PowerShell（沙箱外）**运行 `npm run dev`；日志经终端输出或重定向 `npm run dev *> app.log 2>&1` 后读取。
- **复盘**：沙箱内无法代跑 Electron GUI，只能让用户外部运行并贴日志；诊断数据靠加临时日志 + 用户回传。

## 坑 1 · 官方驱动「全量激活图谱条目」导致 client-connection 抢占 connection

- **现象**：`404 dsh-ui://app/api/host.describe` + `[web-runtime] connection lost, retry #2 (dsh-client-connection/client.js)`。
- **根因**：官方 web boot 驱动（`index-*.js` 的 BootRunner）对图谱**每个条目**执行 `loader.create()` 全量激活；`immediately` 仅控制 prefetch 时机，**与激活无关**。所以「client-connection 入图但不置 immediately 即可不激活」是**伪命题**——入图必被激活，其 apply 抢先提供 Web 传输 connection。
- **解法**：`@deepseek-ai/dsh-client-connection` **不入图谱**，改为图谱外**预载注册**（`PRELOAD_ONLY_IDS` + `registerPreloadOnly`，注入脚本带出 preload script），仅注册 factory 供 `ipc-connection` require 继承基类；connection 服务由 `@dsh-desktop/ipc-connection` 独占。
- **复盘**：官方 `dsh.client` 的 inject 是**模块加载依赖**（完整包名），与 Cordis 插件 apply 内的**服务注入**（服务名）是两层，不能混为一谈；剔除图谱前必须确认官方驱动激活语义。

## 坑 2 · host `apiProxy` 没有 `.handleRpc`（RPC 入口接错）

- **现象**：`[dsh-bridge] 收到 RPC 请求: host.describe` 后无任何成功/失败日志，UI 卡 loading。
- **根因**：官方 host-apiproxy 的 `ctx.apiProxy`（`ApiProxyService`）只暴露业务 domain（`.sessions/.host/.events/.respond`），**没有 `.handleRpc`**。main.ts 原代码调不存在的 `.handleRpc` → undefined → 静默走 fallback 抛错，且 bridge 的 `makeRpcError` 不打印。
- **解法**：host 侧正确的 RPC 入口是官方 **`toFetchHandler(api)`**。把 client-request envelope 经 `/api/<method>` 虚拟路由（不真正走网络）分发给 `api[domain][method]`，解包 `server-response` 的 `result.value`。
- **复盘**：接河上游服务前先读它的真实接口，不要凭名字猜 `.handleRpc`；host 侧复用官方 `toFetchHandler` 是协议对齐的关键。

## 坑 3 · `new Request('/api/...')` 相对 URL 抛错

- **现象**：`host.describe` 无应答 → 沙箱内实证 `Request FAIL: Failed to parse URL from /api/host.describe`。
- **根因**：官方 `toFetchHandler` 内部 `new URL(req.url)` 需要绝对 URL；相对路径构造 `Request` 直接抛错，promise reject 被 bridge catch 静默。
- **解法**：用虚拟 base `new Request('http://local/api/...')`，官方只读 `pathname`（`slice(5)` → `method`），虚拟 host 不影响路由匹配。
- **复盘**：跨层调用官方工具时，其内部对 URL 的绝对性假设要提前排查。

## 坑 4 · `rpcIdSchema` 用 `.uuid()` 过严拦截

- **现象**：bridge 收到请求但卡住，`校验通过` 阶段日志缺失（早期未加日志时）。
- **根因**：`rpcIdSchema = z.string().uuid()`，而 renderer 端 `ipc-connection` 的 `randomUuid()` 回退分支产出 `` `${Date.now()}-${Math.random()}` `` —— 非 UUID 格式，被 schema 拒绝。
- **解法**：放宽 `rpcIdSchema` 为 `z.string().min(1)`。官方 `RpcId` 本就是 branded string，不强制 UUID 格式。
- **复盘**：zod 边界校验别比上游契约更严，否则合法但非标准的值会被误拦。

## 坑 5 · 图谱缺 client UI 插件 → `mountApp` 永远等待（空白）

- **现象**：所有 RPC 全通、`connection.start` 被调用、`host.describe` 就绪判定成立，但 UI **纯 loading/空白**。
- **根因**：官方 web boot 的 `mountApp(ctx)` 依赖 `ctx.inject(["uiRenderer"])`；若图谱未装 client UI 插件，`uiRenderer` 服务不存在，`mountApp` **永远 await**（无激活报错，只是不下发）。我们最小激活集只含连接/API 面（6 个），缺全部 `ui-*`（约 33 个）。
- **解法**：**自动扫描方案** —— boot-graph 复刻官方 `ClientModuleRegistry`（`scanClientPackages`/`orderByModuleGraph`），从 `node_modules/@deepseek-ai` 自动发现全部 `dsh.client.platform==='web'` 包（42 个，含 33 个 ui-*），带官方 inject/external/immediately + 拓扑排序，替代手拼。
- **复盘**：官方 UI 渲染依赖完整 client roster，不是「最小连接集」；手拼 33 个条目极易漏，**复用官方扫描内核**是最稳路径。

## 坑 6 · host `pickDirectory` 崩溃（koffi 在 Electron 不兼容）

- **现象**：选择工作区后报 `FATAL ERROR: Error::New napi_get_last_error_info`（native 栈 trace），进程崩溃。
- **根因链**：
  - 基础包 `@deepseek-ai/dsh-host-directory-picker` 是**抽象基类**（无 `capability()` 实现），直接用会抛 `handler failure`。
  - 官方 `-auto` 版 `dsh-host-directory-picker-auto` 依赖 `webServer`+`loader`（零端口禁用了 webserver），无法激活。
  - `-native` 版用 koffi（Win32 FFI），在 Electron 主进程读取对话框路径时 `napi_fatal_error`，原生崩溃。
- **解法**：prepare 钩子里定义本地 **`ElectronDirectoryPicker extends DirectoryPicker`**（基类构造 `super(ctx)` 即 `ctx.provide('directoryPicker')`，是**真正的 Service 注册**），`capability()` 返回 `kind:'native'`，`pick(signal)` 用 **Electron 原生 `dialog.showOpenDialog`** 返回 `string|null`（对齐官方契约），稳定无 koffi。
- **复盘**：
  - `hostCtx['x'] = obj` 这种普通对象赋值**不满足 Cordis 服务注册**（inject 需真实 Service 实例），必须 `extends Service`。
  - 官方 `pick(signal)` 契约返回 `string|null`，不是 `{path}`；外层 host-apiproxy 再包 `{path: ...}`。
  - 同类「受宿主环境限制」的官方插件（依赖 webServer/native 库），优先用 Electron 原生能力替代。

## 坑 7 · `ui-onboarding` settings namespace 未注册拦截进入

- **现象**：点击内测声明「继续」报 `Error: settings namespace "ui-onboarding" is not registered`，被拦截进不去。
- **根因**：注册 `ui-onboarding` namespace 的插件是 `@deepseek-ai/dsh-client-ui-settings-general` 的** host 面**（`lib/index.js` 的 apply，`settings.register("ui-onboarding", schema)`），而 host 补丁未装配该条目；client 面经 `settings.mutate` 打到 host settings，找不到 namespace 报错。
- **解法**：host 补丁新增 `{ id: 'ui-settings-general', name: '@deepseek-ai/dsh-client-ui-settings-general' }`。
- **复盘**：双面插件（`dsh.client`）的 **node 面注册服务**、**client 面渲染 UI** 是两条独立装配路径；host 补丁缺 node 面会导致 client 经 remote 调用 host 服务时缺依赖。

## 坑 8 · 非 2xx 的 `unpackServerResponse` 直接 `res.json()` 会抛 `SyntaxError`

- **现象**：`dynamicCordisRunner/inventory` 等返回 `404 "not found"` 时，报 `Unexpected token 'o', "not found" is not valid JSON`。
- **根因**：`handleUnary` 对未命中路由返回纯文本 `not found`（status 404）；解包函数未判断 `res.ok` 就 `res.json()`，对非 JSON 文本抛 `SyntaxError`。
- **解法**：解包前先 `if (!res.ok) throw new Error(...)`，避免对错误响应做 JSON 解析。
- **复盘**：任何跨层解包先判 HTTP 状态；「not found」纯文本不能被当 JSON。

## 通用排障方法论

1. **沙箱无法代跑 GUI** → 让用户外部跑，**加精确断点日志** + 用户回传，避免盲试。
2. **每次只加一行能区分分支的日志**（handler=set/null、校验通过、fetch status/body），用日志组合定位停点。
3. **接上游服务先读真实接口**（`.handleRpc`、`new URL` 绝对性、`pick` 返回 string 等），别凭命名猜。
4. **zod 边界别比上游契约更严**（rpcId 示例）。
5. **Cordis 服务注入必须 `extends Service`**，普通对象赋值无效。
6. **官方双面插件要分清 node 面（注册服务）与 client 面（渲染）**，装配两条线都要覆盖。

## 结论

攻坚第 2 批（官方 UI 完成日常对话全流程）在剔除 client-connection 抢占 connection、修 RPC 入口、扩自动扫描图谱、换 Electron 目录选择器、补 settings 注册后**实机验收通过**：官方 UI 成功渲染 + 工作区选择 + 日常对话全流程打通。
