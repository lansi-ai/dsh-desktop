# 实战踩坑记录（Pitfalls · 2026-08-26 攻坚第 2 批）

> 本文件记录 M1 攻坚「官方 UI 完成日常对话全流程」过程中实际踩到的坑与解法。
> 目的：**可复用的排障手册**，避免后续会话重复踩坑。
> 每个坑都标注：现象 → 根因 → 修复 → 复盘要点。

## 坑 0 · TRAE 沙箱拦截 Electron 启动（环境，非代码）

- **现象**：`npm run dev` 启动即报
  `TRAE Sandbox Error: Not allow operate files: ...\SogouPY\LOG\IME\electron_*.log`，且 `Start-Process` 拉独立 PowerShell 报 `0x800700e8 (ERROR_NO_TOKEN)`。
  同类实例（2026-09-01，版本号显示任务验证启动时）：报 `Not allow operate files: ...\Tencent\WeType\MM_TIP_*.xlog, ...\spool\drivers\color\sRGB Color Space Profile.icm`——**微信输入法（WeType）写自家 `.xlog` + Chromium 读系统色彩配置也各自触发同一拦截**。第三形态（2026-09-09，见坑 42）：拦**运行时数据目录** `E:\Projects\DSHPath` 的 `.credentials.yaml.lock` / `search-query.sqlite-shm`，表现为主进程先打印完装配日志再退出、报 `loader entries failed to apply`——**错误头像代码坑，根因在输出尾部**。
- **根因**：搜狗/微信输入法注入到 Electron 进程，启动时写自家 IME 日志，被 TRAE 沙箱拦截；Chromium 渲染时读取 Windows 系统色彩配置（`sRGB Color Space Profile.icm`）同样被拦（非输入法场景也可能触发）；沙箱内 `Start-Process` 无创建新 GUI 进程的 Windows 令牌。
- **解法**：Electron 是 GUI 应用，必须在**系统 PowerShell（沙箱外）**运行 `npm run dev`；日志经终端输出或重定向 `npm run dev *> app.log 2>&1` 后读取。构建/编译（`npm run build`）在沙箱内正常，仅**运行时**被拦。
- **复盘**：沙箱内无法代跑 Electron GUI，只能让用户外部运行并贴日志；诊断数据靠加临时日志 + 用户回传。拦截文件可能来自多套输入法（搜狗/微信）或系统色彩配置，任一触发即启动退出——先看报错尾部第一个被拦路径判定来源。

## 坑 1 · 官方驱动「全量激活图谱条目」导致 client-connection 抢占 connection

- **现象**：`404 dsh-ui://app/api/host.describe` + `[web-runtime] connection lost, retry #2 (dsh-client-connection/client.js)`。
- **根因**：官方 web boot 驱动（`index-*.js` 的 BootRunner）对图谱**每个条目**执行 `loader.create()` 全量激活；`immediately` 仅控制 prefetch 时机，**与激活无关**。所以「client-connection 入图但不置 immediately 即可不激活」是**伪命题**——入图必被激活，其 apply 抢先提供 Web 传输 connection。
- **解法**：`@deepseek-ai/dsh-client-connection` **不入图谱**，改为图谱外**预载注册**（`PRELOAD_ONLY_IDS` + `registerPreloadOnly`，注入脚本带出 preload script），仅注册 factory 供 `ipc-connection` require 继承基类；connection 服务由 `@lansi-ai/dsh-ipc-connection` 独占。
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

## 坑 9 · Cordis Service 子类构造器未转发 ctx → `Cannot read properties of undefined (reading 'reflect')`

- **现象**：启动报 `[dsh-desktop] ctx.desktop 聚合服务注入失败: TypeError: ... (reading 'reflect')`，栈指向 cordis 库 `new Service`（基类 constructor 内 `self.ctx.reflect.provide(name, self, ...)`）；而同为 prepare 阶段注入的 `compat-webserver` 却正常。
- **根因**：`desktop-api.ts` 实例化写成了
  `new (DesktopCoreService as any)(options?.auditLogPath)(ctx, 'desktop')`
  —— JS 实际解析为 `(new DesktopCoreService(auditLogPath))(ctx, 'desktop')`：子类只收到自定义参数，以**无参 `super()`** 调基类；Cordis `Service` 基类 `constructor(ctx, name)` 中 `this.ctx === undefined`，执行 `this.ctx.reflect.provide` 立即抛 TypeError。尾部 `(ctx, 'desktop')` 是对返回实例的误调用，毫无注册效果。
- **解法**：子类构造器签名对齐基类并把 ctx/name 显式转发：
  `constructor(ctx, name?, auditLogPath?) { super(ctx, name); ... }`，
  调用点改为 `new (DesktopCoreService as any)(ctx, 'desktop', options?.auditLogPath)`（与 compat-webserver.ts 已验证模式一致）。
- **复盘**：
  - Cordis `Service` 的注册动作发生在**基类构造内**（`ctx.reflect.provide`），`extends Service` 的子类**必须**把 `(ctx, name)` 作为前两个参数转发给 `super`；自定义参数一律排在之后。"先 new 再对实例补调用"是错误范式。
  - `(expr)(argsA)(argsB)` 两段实参拼起来"看起来像"正确签名，再叠加 `as any` 绕过类型检查，极具迷惑性；凡是 `extends Service` 的调用点，先确认 `super()` 是否真拿到了 ctx。
  - 排障捷径：在同一代码库搜同构用法（本次即 diff compat-webserver.ts 与 desktop-api.ts 的实例化行），最快锁定差异。

## 坑 10 · 插件列表不显示：inventory 等价面缺 `pluginInventory/list` + 第三方清单两线不同源

- **现象**：官方 UI 设置页「插件列表」Tab（`dsh-client-ui-settings-plugin-inventory`）读不到插件，主进程日志 `[dsh-bridge] RPC 未命中 unary 表，fallback apiProxy: pluginInventory/list`（随后 apiProxy 404）；且即使 `dynamicCordisRunner/inventory` 有数据，第三方插件也不在列表。
- **根因**（两层问题叠加）：
  1. **registerMethod 只覆盖了一个 remote endpoint**：`cordis-inventory.ts` 只注册了 `dynamicCordisRunner/inventory`（ui-cordis 插件面板用），而设置页「插件列表」Tab 走的是另一个官方 remote `pluginInventory/list`（`dsh-host-plugin-inventory` 包的 descriptor），未注册 → fallback apiProxy → apiProxy 无该 domain → 404 → 面板报「暂时无法读取插件」。评判"等价面是否齐"要看**消费方调用的每个 endpoint**，不能只看自己注册了哪个。
  2. **第三方清单两线不同源**：HTML 注入线（`dsh-ui-protocol.ts` 私有 `THIRD_PARTY_BUNDLES`）与 inventory 线（`buildCordisInventory()` 调 `generateBootGraph()` 未传 extraBundles）各持一份；即使 endpoint 命中，inventory 行也不含第三方插件。
- **解法**：
  - 收敛第三方清单为唯一源码：`boot-graph.ts` 导出 `THIRD_PARTY_CLIENT_IDS` + 安全解析 `buildThirdPartyBundles()`（单包解析失败 try-catch 跳过，不拖垮启动），`dsh-ui-protocol.ts` 与 `cordis-inventory.ts` 共用；`buildCordisInventory()` 改调 `generateBootGraph(undefined, buildThirdPartyBundles())`。
  - 补齐 `pluginInventory/list` 等价面：新增 `buildPluginInventorySnapshot()`（对齐官方 `PluginInventorySnapshot.entries` 契约：`entryId/moduleName/enabled/fiberPhase`，`fiberPhase: 'active'`），在 `registerCordisInventoryCompat()` 一并注册。
  - 实机验证通过：设置页「插件列表」显示 44 个插件（含 `@lnyanhongyan/dsh-opencode-usage`）。
- **复盘**：
  - 排障从 renderer 的**实际日志**定位 endpoint（本例 `pluginInventory/list`），不要停留在"我以为的入口"（`dynamicCordisRunner/inventory`）。
  - 官方 typert remote 每个包的 descriptor 是权威契约来源（`dsh-api-remotes/lib/client.js` 的 `TYPERT_REMOTE*` 表），实现等价面前先查它确认结果 schema（`{entries:[...]}` 而非数组）。
  - "能加载 ≠ 在清单里"：装载与清单两条路径必须共用同一配置来源。
  - pitfalls 落档时机 = **实机验证通过后**，仅"数据正确"而未确认 UI 闭环不得提前记录（教训：首轮只修到 inventory 数据就写字，被实机打回）。

## 坑 11 · 冷会话在清单中但未挂载：点「新会话」无反应（blank 复用跳过 session.create）

- **现象**（M3-b4 dogfood 发现）：点击「新会话」无任何反应，无网络请求；进入旧会话后 `skill.list` 报 `session "session-xxx" not found (not attached)`；`session.list` 正常返回含该会话。
- **根因**：上游 `session.list` 会把持久化冷会话列入清单（`summarizeCold`），客户端 `connectWorkspace`（dsh-client-runtime client.js:9857）**优先复用清单中的 blank session 直接返回，跳过 `session.create`**；但冷会话在 Host 侧无 live agent，仅 `agentFor` 解析器路径（session.prompt 等）会懒恢复，`ctx.agents.get()` 直读的方法（skill.list/cancel 等）全部 `not attached`。死锁点：客户端以为会话可用（在清单里），Host 认为不存在（没挂载），且**没有任何一方会主动触发重挂载**。
- **解法**：Host 启动后主动预热——`session-rewarm.ts` 遍历 `session.list`，对每个带 cwd 的非 subagent 会话调 `session.create { sessionId, cwd }`（走上游 `ensureSession → checkPersistedIdentity → agents.resume` 官方重挂载语义）；单会话失败仅告警不阻断启动。main.ts 抽取统一 `callApi` 入口供桥 fallback 与预热共用。
- **复盘**：
  - 「清单可见 ≠ 可交互」：冷/热会话双态是上游显式设计，桌面端零端口载体必须补上「启动期重挂载」这一环（上游 HTTP 部署同样存在此窗口，但其 web-startup 可能有预热，桌面 profile 自装配需自行兜底）。
  - 排障判据：`[dsh-bridge] 未命中 unary 表 fallback apiProxy: session.create` 日志**该出现而未出现** = 请求根本没离开 renderer，从客户端运行时（fixture/复用/守卫分支）找断点，而不是查主进程。

## 坑 12 · Typert remote 端点 404：apiProxy 不认领 `commands/list`（零端口缺 gateway 拦截链）

- **现象**：新会话可创建，但输入 `/` 无命令列表，终端 `[dsh-bridge] RPC 失败 (commands/list): api 调用失败: HTTP 404`。
- **根因**：`commands/list`、`commands/execute`、`fileReferences/list`、`goals/*`、`dynamicCordisRunner/*` 等是 **Typert remote** 端点（`@deepseek-ai/dsh-commands` 等），不走 apiProxy 的 domain 方法表；上游 HTTP 部署由 `typert-gateway`（`TypertGatewayService`）经 `connection.rpc.intercept('/api', ...)` 认领分发。桌面零端口下客户端 connection 被替换为 IPC 载波，`ctx.connection` 这条拦截链不存在，apiProxy 对这些端点返回 404。
- **解法**：main.ts `callApi` 在 apiProxy 返回 404 时 fallback 到 `hostCtx.get('typertGateway').invokeRpc(method, params)`（协议逐字对齐上游：payload 为 `{args}`、返回 `{ok, value|error}`）。
- **复盘**：
  - **Cordis service 注册名 ≠ cordis 条目 id**：`TypertGatewayService` 构造器 `super(ctx, "typertGateway")`（camelCase 服务名），而 boot-graph 里条目 id 是 `typert-gateway`（kebab-case）——`ctx.get()` 必须用服务名；首轮用错名拿到 undefined，fallback 静默失效，二轮才定位。
  - 上游分发有三条通道：apiProxy domain 方法（session.*）、Typert gateway（commands/*、goals/*）、connection 直拦截——等价面必须逐条核对 `dsh-api-remotes/lib/client.js` 的 descriptor 表确认归属，不能假设全走 `/api` 一种语义。
  - `dsh-cordis-host-runner`（`dynamicCordisRunner/*` 的宿主）依赖 `tools` 服务链，桌面 MVP 未装载，其 404→service-unavailable 属已知限制，登记后续补。

## 坑 16 · overlay 补丁不带 insert 键 = 静默 no-op：dsh-agent-presets 从未装载（设置页 Agent 预设纯空白）

- **现象**（M3-b4 dogfood 发现）：设置页「Agent 预设」导航入口可见，点进去内容区**纯空白**——无报错、无 loading、无任何文案；终端无 `[dsh-bridge]` 相关 RPC 失败日志（请求成功返回了空数据面或组件直接 return null）。
- **根因**：cordis-plugin-include 的 `applyEntryPatches`（lib/index.js）对**非 insert 补丁**（`{id, name, config}` 形态）只做「按 id 覆盖已存在条目」；条目不存在时 `warn("patch: entry %C not found")` 后**静默跳过**，绝不插入新条目。桌面根配置是空 `[]`（所有条目全靠 insert 进树），boot.ts §4 的 `agent-presets` 条目（携带 name/config 但**不带 insert 键**）因此从 desktop-patch.yml 迁移起就是 no-op——`dsh-agent-presets` 插件从未装载，`ctx.get('agentPresets')` 为 undefined。而官方 UI 侧（dsh-client-ui-agent-preset）对「空 roster」与「服务未装载」两种态**均渲染 null 不报错**（空 roster 是上游认定的合法部署态），把装配层断点完全吞掉。apiProxy 的 agentPret handler 虽会报 "this deployment composes no agent presets"，但只在显式调用时触发，页面空态先短路。
- **解法**：
  - 把 `agent-presets` 条目并入 §4 的 `insert` 数组（与 storage 三件套同列），经 insert 真正进插件树；
  - main.ts bootstrap 加启动期诊断探针（第 3.5 步）：Host 就绪后 `ctx.get('agentPresets')`（camelCase 服务名）实扫一次 `list()`，服务缺失 / 扫描为空 / 抛错三种异常 `console.error` 必显——空白类问题以后终端即第一现场。
- **复盘**：
  - **「补 name 即装载」是伪心智模型**：include 补丁的 id-覆盖与 insert 是两条不相交路径，空根配置下非 insert 补丁 100% 无效；写补丁时先问「这个条目经哪条路径进树」。R8 当年「agent 预设点验通过」实系误判（很可能只验了页面可进未验内容）。
  - **页面「合法空态」是装配 bug 的最佳掩体**：上游把「无预设」设计为合法部署（return null），桌面端任何装配断点都会被折叠成同一种纯空白；对这类静默空态面，必须在宿主侧加「扫描结果必显」探针对冲。
  - 排障判据：**服务装载类断点不要从 renderer 找**——空 roster / 未装载 / 渲染异常三者在页面侧同形，直接在主进程 `ctx.get(服务名)` 一测即分叉。

## 坑 17 · 注入脚本模板字符串嵌套反引号 = TS 编译错误（titlebar 自绘注入面）

- **现象**：`src/desktop-host/titlebar.ts` 的注入脚本（`executeJavaScript` 字符串）内使用模板字符串内插（如 `${BORDER}`）且脚本体里再写反引号，`tsc` 直接报语法错误，编译失败。
- **根因**：注入脚本是「字符串里的代码」，存在两层解析——外层 TS 模板字符串的 `` ` ``/`${}` 先被主进程编译器消费；脚本体内再出现反引号或 `${` 会被当成外层模板的终止符/内插表达式，产生嵌套冲突。写入的是 renderer 侧代码，但解析错误发生在主进程编译期。
- **解法**：注入脚本内的常量（颜色、尺寸等）不使用内插，直接写字面量（如 `rgba(0,0,0,0.10)`）拼进脚本字符串；确需内插时外层改普通字符串拼接或对 `${` 转义（`\${`）。
- **复盘**：「字符串即代码」的注入面（`executeJavaScript` / `insertCSS` / bundle factory 源码）写模板字符串前先问**两层解析归属**——哪些 `${}` 归主进程编译期、哪些归 renderer 运行期；编译期报错是最好的保险，同理推断：若嵌套冲突侥幸过编，错误会延迟到 renderer 运行期才炸，更难定位。

## 坑 18 · 同文件多处编辑并发覆盖：CLIENT_EXCLUDE_IDS 排除项静默丢失（实机双注册冲突）

- **现象**：M6-P3 侧栏壳实机验证报 `failed to apply loader entry (@deepseek-ai/dsh-client-ui-sidebar): single slot "sidebar" already has a registration (registered by B5)`——官方 ui-sidebar 未被排除仍激活，与新壳双注册冲突。dist 产物反查：`boot-graph.js` 有 desktop-sidebar 注册但 **CLIENT_EXCLUDE_IDS 无 ui-sidebar**，而源码当时的两次编辑都「报告成功」。
- **根因**：对**同一文件**的多处 SearchReplace 编辑在同一批次并发执行时相互覆盖——各编辑基于同一初始快照独立写回，后写者覆盖先写者，且先写者的「成功」报告是假象。本会话累计发生 5 次（active-context.html ×3、active-context.md ×1、boot-graph.ts ×1），全部为静默失败：typecheck/lint 不报（语法合法），仅运行期或产物核验才暴露。
- **解法**：同一文件的多处编辑**严格串行执行**，每处编辑后立即 Read 复核目标区域；多编辑任务收尾用构建产物（dist）grep 反查源码状态（产物有/没有某符号 = 源码编辑是否真落盘）。
- **复盘**：编辑工具的并发写覆盖是「静默失败」类别——所有常规质量门禁（typecheck/lint/测试）都测的是「代码逻辑对不对」，测不出「编辑是否真的落盘」；**落盘核验（Read 反查 + 产物 grep）是独立且必须的第三类自检**。批量编辑任务的时间收益远低于一次静默丢失的排查成本。

## 坑 19 · 官方运行时动态样式覆盖同特异性规则：#root 内缩「规则在却不生效」（右底边距失效 + 底部溢出 32px）

- **现象**（M3-c3/M6-P3 实机验证）：主区右/底 15px 边距完全失效，底部设置行与输入框被窗口裁切（溢出量 ≈32px）；而 `#root{position:fixed;top:32px;...}` 在插件 CSS 与 HTML 骨架**两处都存在**且注入顺序占优，却「不生效」。
- **根因**：官方 UI **运行时动态注入**的样式表（JS append 到 head 末尾，晚于插件 style 与 head 内骨架 `<style>`）以**同特异性**覆盖 `#root` 的 position → fixed 被改为 relative/默认。指纹特征：`top:32px` 在 relative 下作为偏移仍「生效」（内容整体下移 32px，疑似标题栏让位正常），但 `bottom/right` 失效 → 内容 = 100% 高 + 32px 偏移 = 底部恰好溢出约 32px。截图里「内容下移 + 底部截断」组合就是该指纹。
- **解法**：规则强化为 `html body>#root{position:fixed!important;top:32px!important;...width:auto!important;height:auto!important}`（后代前缀提特异性 + important 双保险）；插件 `injectStyles()` 与 `LAYOUT_SKELETON_CSS` 两处同步。
- **复盘**：①**「规则存在 ≠ 规则生效」**——CSS 层叠胜负 = 注入时机 × 特异性 × important，宿主页面的官方样式要假定会以动态 style 随时追加，自绘样式一律 important 化或提特异性；②截图证据要精读：「内容整体下移 + 底部恰好溢出等量」是 position 被降级的指纹，不是「边距没写」。

## 坑 20 · 不要用 CSS 覆盖官方 #root 的定位/缩放（破坏官方案例自适应，窗口放大布局不变）

- **现象**（M3-c5 实机）：窗口放大后布局**不跟随**，内容被压缩在左上、右侧/下缘大片空白；DevTools 实测 `#root` 尺寸锁死（876×960，不随窗口）+ 布局 frame 宽度 `frameW=0`（ResizeObserver 读不到真实宽 → 永不重算列宽）。
- **根因**：官方 `html,body,#root{height:100%}` 让 `#root` **原生自适应窗口缩放**（这是官方案例设计好的）。早期为做「托盘边距/圆角」，用 `position:fixed`+`inset` 强制定位 `#root`，反而**覆盖掉了它官方的 `height:100%` 自适应逻辑** → `#root` 尺寸不再随窗口重算 → 布局 frame 收不到新宽度 → 放大不变。后续又试「`#dsh-root` 套壳 B-0」（再包一层接管缩放）——**过度**，用户纠正「官方根容器没问题，不需要动」。
- **解法**：**回归官方 `#root` 原生自适应**——不碰它的定位，只做视觉垫层：`html body>#root{box-sizing:border-box!important;padding:calc(var(--dsd-titlebar-h) + 8px) var(--dsd-frame-gap) var(--dsd-frame-gap) var(--dsd-frame-gap)!important;margin:0!important}` + 内层卡片 `#root>div:first-child{border-radius:12px;overflow:hidden}`。托盘边距用 `padding`（不改变文档流/定位），圆角用内层选择器——**官方 `#root` 照常缩放，布局跟随**。
- **复盘**：
  - **官方「挂载骨架」是提前设计好的自适应机制，不要用 CSS 强制定位去覆盖它**——尤其 `position/fixed/height`。要加边距/圆角这类视觉，优先用 `padding`/内层选择器/`box-sizing`，**不改变官方容器的定位与尺寸逻辑**。
  - **「放大布局不跟随」的判据**：`#root` 尺寸恒定（不随窗口重算）+ 内容被压左上 + 四周空白 = 官方 `#root` 的自适应被我们覆盖破坏了；应回退到「官方自适应 + 视觉垫层」，而非再包一层。
  - **「适配器/不改官方」不等于「不能碰官方元素」**——可以给官方 `#root` 加视觉（padding/圆角），但**不能改它的定位/缩放/结构**；改定位=破坏它设计好的行为，改结构=侵入。边界是「只加不破坏」。

## 坑 21 · 外观服务注入无单位 CSS 变量：`var(--dsd-*)` 解析非法 → 高度退化 auto（标题栏/按钮变小）

- **现象**（2026-08-28 布局/titlebar 调整）：把 `--dsd-titlebar-h` 设为 50 后，标题栏与窗控三钮反而**比原来还小**（`height` 变成内容高）；且窗口放大时 titlebar 变大、侧栏/对话区高度不变。
- **根因**：`desktop-appearance.ts` 的 `resolveVars()` 用 `String(cfg.titlebarH ?? 50)` 注入，`--dsd-titlebar-h` 被写成 **`50`（无单位）**。CSS 里 `height: var(--dsd-titlebar-h, 50px)`：var 已定义（值为非法的 `50`），所以 **`50px` 兜底不会触发**；`height: 50` 是非法长度 → 属性回退初始值 `auto`（按内容高）→ 标题栏/按钮被内容高度撑小。同理 `--dsd-card-radius`（`12` 无单位 → 圆角失效）、`--dsd-frame-gap`（`15` 无单位 → 边距失效）。骨架 `:root` 的 `50px` 被外观 `html:root{--dsd-titlebar-h:50}`（无单位、特异性更高）覆盖。
- **解法**：`resolveVars()` 对长度类变量加单位——`const px = (v) => typeof v === 'number' ? `${v}px` : String(v)`，`cardRadius/frameGap/titlebarH` 一律走 `px()`（产出 `50px`/`12px`/`15px`）。
- **复盘**：① **`var(--x, fallback)` 的 fallback 只在变量「未定义」时生效；变量「已定义但值非法」（如无单位长度）时 fallback 不触发**，属性直接取非法值 → 回退初始值。排查"CSS 变量长度不生效"先检查注入的变量值**是否带单位**。② "窗口放大后 titlebar 变大 / 内容区不伸缩"直观像 grid 布局问题，根因常是某个 `height: var()` 解析失败退回 auto；**先用 DevTools 看 computed height** 再改布局结构，避免误判（本会话先怀疑 grid 排列，实为变量无单位）。

## 坑 22 · `apiProxy` 整体对象 vs `apiProxy.events` 传参混淆致 `TypeError: options.events.mux is not a function`

- **现象**：应用启动即崩溃，终端报 `TypeError: options.events.mux is not a function`，堆栈指向 `theme-sync.js:79 installThemeSync`。
- **根因**：`main.ts` 调用 `installThemeSync` 时传 `events: apiProxy as unknown as DownlinkEventStream['events']`——把完整 `apiProxy` 对象（结构 `{ events: { mux, host }, ... }`）直接强转成 `events` 参数。`theme-sync.ts` 内部调 `options.events.mux(...)` 实际变成 `apiProxy.mux(...)`，而 `apiProxy.mux` 是 undefined（正确路径为 `apiProxy.events.mux`）。强转 `as unknown as` 绕过了 TS 类型检查，编译不报但运行时炸。
- **解法**：`main.ts` 改为 `events: apiProxy.events`，直接传递 `{ mux, host }` 结构；去掉 `as unknown as` 强转（TypeScript 能自动校验结构匹配）。
- **复盘**：① 跨模块传递嵌套结构时，**先在脑中（或写在注释里）确认「我传的是哪一层」**——`apiProxy.events`（层 1）vs `apiProxy`（层 0），差一层就全错。② `as unknown as T` 双强转 = 把类型系统当瞎子用；如果必须用，先写清楚目标类型 `T` 和源类型 `S` 的结构差异，确认字段存在。③ 主题同步（`theme-sync.ts`）从单路订阅改为双路（`mux + host`），因为 `settings/document-updated` 是 Host 级事件，可能通过 `host` 流传递而非 `mux` 流。排查事件"不触发"时，检查事件在哪条流（`carrier-relay.ts` 有明确注释：`mux = 会话事件流，host = 宿主流`）。

## 坑 23 · 标题栏跨槽位渲染品牌崩溃：`renderSlot('sidebar.brand.*')` 违反槽位所有权（左上角 DeepSeek 品牌消失）

- **现象**（M6-P2 自绘 titlebar）：把品牌区（logo + 品牌名）从 sidebar 迁到自绘标题栏后，**左上角 DeepSeek 鲸鱼 logo + harness 字样消失/空白**；标题栏其余部分（窗控/折叠）正常。
- **根因**：初版 titlebar 用 `renderSlot('sidebar.brand.mark', ...)` / `renderSlot('sidebar.brand.name', ...)` 渲染品牌——但 `renderSlot` 的 `SlotOwnershipError` 检查规定：**一个槽位组件只能渲染它自己在 children 声明里声明的子槽位**。`titlebar` 槽 children 未声明 `sidebar.brand.mark/name`（那是被排除的官方 `ui-sidebar` 声明的子槽位），跨槽位调用直接抛 `SlotOwnershipError` 崩溃 → 品牌区不渲染。品牌在「哪个槽位可用」由槽位所有权决定，与品牌组件是否已注册无关。
- **解法**：不再经槽位，改为**直接 require 官方品牌组件渲染**——`getOfficialBrand()` 内 `require('@deepseek-ai/dsh-client-ui-primitives')` 取 `FishLogo`（鲸鱼 logo）+ `BrandWordmark`（DeepSeek 字标），渲染到标题栏品牌区；`BrandWordmark` 用 `includeMark:false`（mark 已单独渲染，避免重复）。该模块必被 loader 注册（被激活的官方 `dsh-client-ui-brand-official` bundle 引用它），`require` 即可解析。解析失败回退内置占位（深色圆角块 + 品牌名），不崩标题栏。
- **复盘**：① **自有插件接管某槽位后，若想展示不属于自己 children 声明的官方子槽位内容，应「直接集成官方组件」，不要用 `renderSlot` 跨槽位**——槽位所有权是渲染面红线，`renderSlot` 只能渲染本槽自己声明的子槽位（坑 23）。② 官方品牌组件来自 `@deepseek-ai/dsh-client-ui-primitives`（被 `ui-brand-official` 消费，注册 `sidebar.brand.*` / `conversation.hero.brand.mark` 三个槽位，见其 `client.js`），跨槽位/跨插件复用官方品牌元素直接 require 该包最省事。③ 排查自绘插件渲染空白：先看是否有 `SlotOwnershipError`/`StaleAuthorizationError` 被 catch 吞掉——跨槽位调用常以「组件崩溃 → 区域空白」呈现，非报错红字。

## 坑 24 · 启动期 unary 报 404 / arguments-invalid：自研调用未对齐官方 /api wire 契约（非启动时序）

- **现象**（0.1.2 升级后，自研启动 unary——theme-sync 读 settings、session-rewarm 重挂载冷会话）：按顺序冒出三段不同错误——① `api 调用失败: HTTP 404`（settings.describe / session.create）；修掉后变 ② `Remote payload must contain exactly one plain-object args field`；再修掉后变 ③ `args fields do not match the descriptor: missing "_request"`。**每改一处就推进到下一段报错→说明是 wire 契约多层不对齐，不是启动时序竞态**；renderer 官方 client 天生满足全部三层，所以桌面 UI 正常、仅自研启动调用全挂。
- **根因**（三层，按现象①→③对应）：
  1. **端点分隔符**：官方 `dsh-api-gateway` 的 `/api` interceptor 认领判定 `claimsEndpoint(endpoint)` 只认**斜杠两段 `domain/method`**（`settings/describe`）；点分单段 `settings.describe` `split("/")` 长度 1 → 判 false → HTTP 404。
  2. **payload 信封**：认领通过后，typert `remoteRequest` 要求 payload **恰好一个 plain-object `args` 字段**（`{ args: {...} }`）；裸 `params` 传过去（0 字段）被拒 → `Remote payload must contain exactly one plain-object args field`。
  3. **签名参数名**：`args` 内字段名必须匹配端点签名参数（如 `session.list(request=_request)`、`session.create(request)`）；缺 `_request` → `missing "_request"`。
- **解法**：main.ts `callApi` 统一入口做两层 wire 规范化——① 点分→斜杠（`method.includes('/') ? method : method.replace(/\./g, '/')`）；② 裸 `params` 幂等补包为 `{ args: params }`（renderer 已发 args 包则放行）。端点签名参数名在各调用方对齐：session-rewarm 改 `session.list → { _request: {} }`、`session.create → { request: { sessionId, cwd } }`。theme-sync 的 `settings.describe` 参数可选、裸 `{}` 即可。
- **复盘**：① 自研 hand-rolled 调用走官方传输，**必须刻对齐官方 wire 契约**（端点分隔符 + payload 信封 + 签名参数名），不能假设"升级前能用=升级后一样"——0.1.2 是破坏性重构。② **持续 404 ⟺ 时序竞态的归因是陷阱**：时序竞态应是「间歇性、窗口加载后自愈」；**必然、持续、逐层推进的报错通常是 wire 形态不对**，优先查分隔符/信封/参数名三层，而不是加盲目重试掩盖。③ 统一入口（callApi）承载分隔符+信封规范化，调用方只对齐签名参数名，责权清晰。

## 坑 25 · Web 端专用 client 半点名入渲染图谱：宿主已禁用对端仍产生 404 噪音（/plugins/events + dynamicCordisRunner/syncInspectManifest）

- **现象**（0.1.2 升级后，`npm run start` 启动即刷 4 类噪音）：
  ```
  [dsh-ui-protocol] 404 dsh-ui://app/plugins/events (ENOENT: ...plugins/events)
  [dsh-bridge] RPC 失败 (dynamicCordisRunner/syncInspectManifest): api 调用失败: HTTP 404
  [renderer-ERROR] [cordis-client-runner] syncing inspect providers failed: ... HTTP 404
  (electron) 'console-message' arguments are deprecated ...
  [renderer-WARN] Electron Security Warning (Insecure Content-Security-Policy) ...
  ```
- **根因**：桌面**宿主侧**（boot.ts §3）已禁用 `client-hmr`/`cordis-client-runner`/`cordis-host-runner`，但**渲染侧图谱**（boot-graph.ts `scanClientPackages` 自动扫描全部 `dsh.client.platform==='web'` 包）仍把它们收进 entries 并激活——
  ① `dsh-client-hmr` 客户端 apply 订阅 dev SSE `/plugins/events`（`EVENTS_ENDPOINT`），桌面零端口无该宿主服务 → 经 dsh-ui:// 协议落到 `resolveRelative` 读不存在的文件 → ENOENT 404（且可能重连轮询反复刷）；
  ② `dsh-cordis-client-runner` 激活即 `ctx.remote.dynamicCordisRunner.syncInspectManifest(providers)`，对端 host runner 禁用 → 404 → `throw` → renderer `[cordis-client-runner] syncing inspect providers failed`。
  ③ `console-message` 旧多参回调是 Electron 已标 deprecated 的 API 签名。
  ④ CSP 警告 = 官方 dist `index.html` 无 `Content-Security-Policy` meta，Electron dev 下提示（打包后不出现）。
- **解法**：
  - boot-graph.ts `CLIENT_EXCLUDE_IDS` 加入 `@deepseek-ai/dsh-client-hmr`、`@deepseek-ai/dsh-cordis-client-runner`、`@deepseek-ai/dsh-client-ui-cordis`（面板依赖 runner 的 `dynamicCordisRunner` 面服务，排除 runner 要连面板一起，否则 `ctx.dynamicCordisRunner` 为 undefined 崩 `runner.getSnapshot()`）。插件清单仍经 `cordis-inventory.ts` 兼容面（`pluginInventory/list`）在设置页查看，不受影响。
  - main.ts + window-manager.ts 的 `webContents.on('console-message')` 改现代单对象签名 `(event) => { event.level/message/lineNumber/sourceId }`（旧多参回调 deprecated）。
  - 转发层按 `event.message.includes('Electron Security Warning')` 滤掉 CSP 已知无害警告（dev-only）。
- **复盘**：
  - **「宿主已禁用 ≠ 渲染端不会跑」**：零端口/桌面 profile 里，host 补丁禁用某 Web 基础设施，**必须同时把它的 client 半点从渲染图谱的自动扫描中排除**，否则对端缺席的客户端激活会持续 404 刷屏。宿主禁用与 CLIENT_EXCLUDE_IDS 是**两条正交装配线**，都要关这扇门。
  - **排除一个注入型插件要连其消费方一起**：若某插件被其他插件的 `dsh.client.inject` 当服务依赖（如 ui-cordis 用 runner 的 `dynamicCordisRunner` 面），单独排除提供方会崩消费方；判断标准=对方 `apply()` 是否**直接 `ctx[服务]` / `ctx.get()` 该服务**（`inject` 仅是拓扑顺序提示，不等于服务存在）。
  - **官方 dist 无 CSP 的 Security Warning**：Electron 明确「打包后不出现」，属 dev 专属提示；不要在官方 dist 上硬加 CSP 破坏动态模块系统（需 unsafe-eval），转发层过滤该已知消息即可。

## 坑 26 · ui-* 双面包装配不全：host 半漏装（settings namespace 未注册）+ theme/change 消费者丢失（切外观无效果/深色显示错误）

- **现象**（0.1.2 升级后链式三连，2026-09-01）：
  ① 设置页切外观报 `settings namespace "ui-theme" is not registered`（`[dsh-bridge] RPC 失败 (settings/mutate)`）；
  ② 补装后不再报错，但点击切换界面零变化；
  ③ 再补后主卡（官方 UI）正常切深，titlebar 行 + 侧栏列仍是浅色（侧栏会话文字发灰难读）。
- **根因**（三层独立缺口，逐层暴露）：
  ① `ui-theme` namespace 由官方 `dsh-client-ui-theme` 的 **host 半** `apply()` 注册（`settings.register('ui-theme', ThemeSettingsSchema)`）。boot.ts §1 只补了 `ui-settings-general`（ui-onboarding），漏装同类 4 个双面包 host 半：`ui-theme`/`locale`/`ui-chat`/`ui-conversation`（官方 web-app cordis.patch.yml L177-199 全有）。client 半经 settings.mutate 写偏好 → host `dsh-settings` 注册表查无此 ns → 拒绝。
  ② 官方 theme 链路是**发布/应用分离**：`ui-theme` client 半只做 settings 读写 + 发布 `theme/change` 事件；把主题应用到 DOM（根 `color-scheme`、body `data-ds-dark-theme`、`--dsh-content-font-size`、token 变量、theme-color meta）的是**官方 `ui-layout` 的 ThemePresenter**（订阅 `theme/change`）。M6-P1 自研布局接管 root 槽位排除 `dsh-client-ui-layout` 时，ThemePresenter 被连带丢掉 → 事件发布后无消费者。
  ③ titlebar 行/侧栏列本身透明，透出宿主托盘底色 `--dsd-tray-bg`（硬编码浅色）；自绘 CSS 另有多处硬编码黑色系 + 侧栏根声明 `color-scheme: light dark`（改随 OS 偏好而非应用主题）。
- **解法**：
  ① boot.ts §1 补装 4 个 host 半条目（`ui-theme`/`locale`/`ui-chat`/`ui-conversation`；排查口径=全库 grep `settings.register(`）。
  ② `desktop-layout-client.js` 增设等价 `ThemePresenter`（初始 `ctx.theme.getTheme()` + `ctx.on('theme/change')` 实时应用 + dispose 回撤），`inject: ['slots','theme']` 原已声明。
  ③ 托盘底色与自绘硬编码色全改 CSS `light-dark()` 双值（`--dsd-tray-bg: light-dark(rgb(242 243 245),rgb(28 28 30))`，boot-graph 骨架 + desktop-appearance 两处同源；titlebar/sidebar hover/边框/标签色同步）；删除侧栏根 `color-scheme: light dark` 声明，继承 presenter 写在根元素的主题方案。
- **复盘**：
  - **「双面包」插件两条装配线都要点名**：官方 ui-* 多为 node+client 双半；client 半由渲染图谱自动扫描，**host 半必须在 boot.ts 显式 insert**——升级/迁移时对照官方 cordis.patch.yml 的 insert 段逐行核对，不能只补报错的那一个（同口径一次性补齐同类）。
  - **排除官方插件 = 排除它的全部职责**：接管 root 槽位排除 ui-layout 前，要盘点它承载的所有 effect（root 注册 + ThemePresenter + …），被排除的职责须在自研件中等价补齐；「事件有人发」不等于「有人消费」。
  - **壳层配色不要硬编码单值**：自绘 CSS 一律用 `light-dark()` 双值或官方 token；并避免元素级 `color-scheme` 声明劫持主题跟随（会改随 OS 偏好）。

## 坑 27 · 自绘设置 section 硬编码深色 + grid 子项 min-content 撑破（外观页浅色不可读 + 卡片横向溢出面板）

- **现象**（2026-09-04，用户截图）：设置页「外观」在浅色配色主题下标题/说明/卡片边框几乎不可见（发白）；图标包卡片不落在 640px 容器内，图标排成一长条冲出面板右边界，包内图标越多（上传的 custom 包）溢出越严重。无任何控制台报错——纯渲染问题。
- **根因**（三处独立）：
  ① 样式全部**内联硬编码深色值**（`color:#f8fafc`、`rgba(255,255,255,0.08)`、`rgba(0,0,0,0.25)`），未取官方 token，明暗主题完全不跟随。
  ② **grid 子项默认 `min-width:auto` = min-content**：外层 `repeat(auto-fill,minmax(180px,1fr))` 的卡片未设 `min-width:0`，而卡片内层是 `repeat(4,1fr)` 预览网格、每格带 `white-space:nowrap` 的文件名标签（`maxWidth:72px`）→ 卡片 min-content ≈338px 反顶轨道宽度，3 条轨道合计 ≈1034px 撑破 ≈564px 的内容区（`auto-fill` 只保证「轨道不小于 min」，不封顶）。
  ③ section 自带 `padding:16px 24px` + `maxWidth:640px`，与自研设置外壳 `.dss-options` 已有的 `padding:0 24px 24px` 叠加 → 双重缩进、与其它 section 不一致。
- **解法**（`desktop-theme-client.js` V2 重构）：
  ① 样式改为注入式 `<style data-plugin="@lansi-ai/dsh-desktop-theme">` + 官方 token 取色（`--dsw-alias-label-primary/secondary/tertiary`、`--dsw-alias-border-l2/l3/l4`、`--dsw-alias-bg-layer-1`、`--dsw-alias-fill-tsp-secondary`、`--dsw-alias-brand-primary`、`--dsw-alias-bg-multi-select`、`--dsw-alias-state-success/error-primary`），明暗自动。
  ② 三层防溢出：卡片 `min-width:0`、内层预览网格 `repeat(4,minmax(0,1fr))`、预览格固定 24×24 **不带文本标签**（文件名移到 `title` 悬浮）；版式同时精简为「代表图标 4 枚 + 包名 + 图标数 + 选中态」。
  ③ 删除 section 自带 padding/maxWidth，宽度约束交回外壳（根节点 `width:100%;min-width:0`）。
- **复盘**：
  - **自绘 UI 禁内联硬编码色值**：一律注入带 `data-plugin` 的样式表 + 官方 `--dsw-*` token（或 `light-dark()` 双值），否则浅色主题必不可读；这与坑 26 的「壳层配色不硬编码单值」同源，但 section 内容层同样适用。
  - **内容宽度不可控的 grid/flex 卡片必须显式 `min-width:0`**：`minmax(180px,1fr)` 不封顶，子项 min-content 会反向撑破轨道；`nowrap` 文本标签是撑破的头号来源——缩略图类网格应固定单元格尺寸 + 文本进 `title`。
  - **section 不重复承担外壳的间距职责**：设置外壳 `.dss-options` 已提供内边距与滚动容器，section 根节点只做自身布局。

## 坑 28 · 主题图标清单无单一真源：设置页退化成文件罗列，且 app/tray 槽位根本无法经上传补齐

- **现象**（2026-09-04，用户澄清需求）：「图标引用清单」只列激活包里**已有**的文件名，用户看不出系统/插件**需要**哪些图标、该叫什么、放哪；顶部「上传图标」恒把文件写进 `custom/icons/`，而 app/tray 四件套的约定位置是**包根**——上传永远补不齐应用/托盘图标。
- **根因**（两层）：
  ① 槽位知识分散在三处消费方源码（host `ICON_FILES` 包根约定、settings-shell 的 `settings-nav-<id>.svg`/`settings-trigger.svg`、titlebar 的 `titlebar-logo.svg`），设置页手上只有「包目录扫描结果」，语义天然错位——文件系统能回答「有什么」，回答不了「该有什么」。
  ② 上传 API 无参数（`upload()` 恒 `icons/<sanitize(原文件名)>`），既不知道目标槽位也不知道目标目录，格式/尺寸/回退更无从校验。
- **解法**：host 新增 `ICON_SLOTS` 注册表（**单一真源**：`id/label/group/file/format/size/fallback`，13 位 = 包根 app/tray × 明暗 4 + `icons/` UI 位 9）；`desktop.iconTheme.list` 下发 `slots`（`provided` 相对激活包 `existsSync` 判定）+ `uploadDir`；`desktop.iconTheme.upload({slotId})` 改槽位驱动：对话框按槽位格式单选 → 以规范名 `join(custom 包, slot.file)` 落盘（`mkdir(dirname(target))` 自动建子目录）→ **重扫主题表**（首传的 custom 包必须进表，否则协议层 `resolveThemeDir` 查不到 → 404）→ custom 正激活时 `onThemeChanged()`（宿主窗口/托盘）+ 下行 `theme.icon-change`（各窗口 UI）双刷新。设置页只渲染 host 下发的清单，不再自行派生文件名。
- **复盘**：
  - **「清单类」UI 的数据源必须是需求注册表，不是文件系统扫描**：有回退链的槽位（缺了也能跑）尤其危险——静默回退会把缺口永久藏住，用户以为生效了。
  - **新增图标消费点必须同处登记 `ICON_SLOTS`**（宿主侧契约，注释已写明），否则设置页看不见该需求；同坑 26「排除即承接全部职责」一个味道：加消费点就要加台账。
  - **上传类 API 要携带语义目标**：无参 `upload()` 只能猜目录与命名；参数化到槽位后，命名/目录/格式校验/生效刷新收敛到 host 一处，renderer 零规则。
  - **上传目标应是用户正在操作的对象，不是硬编码兜底包**：恒落 `custom` 让「基于现有包换一两个图标」变成重搭整套资产。内置包 asar 只读的约束用「**同名克隆到用户目录**」化解——扫描时用户包覆盖内置，激活 ID 不变、内容就地可替换，用户视角仍是「传进了这个包」（回执 `cloned` 说明发生了什么）。
  - **新建即激活**：`create` 后直接 `activate(id)`，「建自己的包 → 往里传图标」是一条连续路径，不必回头再点一次卡片。
  - **清单类信息默认折叠 + 计数当展开信号**（`缺 N 项` / `全部已提供`）：次要细节不该挤占主路径，但要让用户一眼判断是否需要展开。
  - **分组标题要承载「归谁」，不是当装饰**：多个消费方的同类条目混在一张清单里，12px 灰字分组名压不住层次。正解=分组做成容器（边框+底色分层）+ 组头带**机器可读的归属标识**（插件 id chip，故注册表要有 `plugin` 字段而非把插件名塞进中文组名）+ 组内自身计数；且行首要放**条目实际渲染结果**的缩略图——描述「哪个图标位」不如直接让他看见那个位现在长什么样（未提供用虚线空格占位，缺口可视化）。
  - **相邻卡片边框的间距要大于线宽的视觉厚度**：两张 1px 描边卡只隔 6px 时，两条线会被读成"一条变粗的线"（用户原话「边框重合变粗」）。组间留白给到 16px 量级即可解；不建议用 `margin-top:-1px` 叠边合并——省了高度但引入与 gap 的耦合，改间距就破。

## 坑 29 · 主题图标两个隐形坑：0 字节占位被判「已提供」+ 图标库画布留白差异致视觉尺寸不一

- **现象**（2026-09-04 用户实机点验）：设置页导航「外观」显示的是**官方原生图标**而不是用户包里的图标，并且它比其它行的自定义图标明显大一档。全程无任何报错。
- **根因**（两件独立的事）：
  ① 内置 default 包 `icons/settings-nav-appearance.svg` 是 **0 字节空占位**（git 里由 `settings-nav-theme.svg` 重命名而来，本来就是空的）→ 协议层照样 200 → renderer 解析不出 `<svg>` → 按设计静默回退官方图标；而需求清单的 `provided` 只判 `existsSync` → 空文件被标成「已提供」，缺口完全被藏住。
  ② 尺寸差 = **画布留白规范不同**：官方 primitives 是 16 网格、字形近乎满幅（≈87%）、描边约 1px；用户上传的是 Material Symbols 24 网格（`viewBox="0 -960 960 960"`），字形只占画布约 79%、描边按比例缩到 ≈0.8px。两者都被 `renderSvg(url, 16)` 强制成同一个 16px 盒子 → 自定义图标看着「小一圈、更细」。
- **解法**：
  ① `provided` 判定改「存在**且** `statSync().size > 0`」；删掉内置空占位（顺带清 dist 里的陈旧空文件——`copy-web` 只覆盖不删除，删源资源不会自动从 dist 消失）。
  ② `renderSvg` 内联前做**光学归一**：离屏 `getBBox()` 测字形真实包围盒 → 把 viewBox 重设为「最长边 + 每侧 1/16 内边距」的正方形并居中（1/16 即官方 16 网格图标的留白比例）；测不到包围盒则保持原 viewBox 不裁切。结果进 `svgCache`，每个图标只测一次。
- **复盘**：
  - **文件存在 ≠ 内容有效**：任何「是否已提供」的判定都要带最小有效性检查（尺寸 > 0 / 能否解析）。有静默回退链的地方，缺口不会报错，只会以「看起来是别的东西」的形式出现——坑 28 藏的是「需要哪些」，这次藏的是「传了个空文件」。
  - **替换 UI 字形必须做光学归一**：不同图标库的画布留白是各家私事，**强制同盒子尺寸 ≠ 同视觉尺寸**；正解是按内容包围盒重设 viewBox（离屏 `getBBox()`），而不是给某个图标库调经验放大系数。
  - **构建产物只增量覆盖**：删源资源不会从 `dist/` 消失，验证资源类改动必须看 dist 的实际文件清单（坑 18「落盘反查」的资源侧变体）。

## 坑 30 · 图标槽位三条口径纪律：清单=启用条件、状态对成对启用、异步内联不能空帧

- **背景**（2026-09-04，用户问「窗控三钮不能设置吗」）：标题栏窗控与侧栏折叠图标是硬编码内联 path，主题包覆盖不到。接入 6 个新槽位（`titlebar-minimize/-maximize/-restore/-close/-collapse-left/-collapse-right`）时，同域三处会咬人的口径问题一起暴露。
- **三条**：
  ① **清单说「已提供」、界面却不生效**：`useThemeLogo` 的启用条件是 `current !== 'default'`，而需求清单 `provided` 只看激活包里有没有那个文件——把 default 克隆到本地定制 logo 时，清单显示已提供、界面上仍是官方鲸鱼。→ 统一为「**激活包含该文件就用**」。
  ② **状态对图标只给一半**：maximize↔restore、collapse-left↔collapse-right 是同一按钮的两枚状态图，各自独立判定会出现「点一下换风格、再点一下回内置」。→ 消费方按 pair **成对启用**，缺一整套回退内置。
  ③ **异步内联 SVG 用在首帧就要正确的控件上**：`renderSvg` 是 fetch+parse 的 Promise，窗控按钮空一帧非常显眼。→ 初值走 `peekSvg` 同步取缓存，未命中**先画内置图形**、后台加载完再换（永不空帧）；跨主题切换的破缓存用**模块级 `controlBust`** 而不是每次 `Date.now()`，否则同会话内缓存永不命中。
- **复盘**：
  - **一份需求清单只能有一个真源，且启用条件必须同口径**：`ICON_SLOTS` 既管清单展示又管上传落盘，消费方的启用判断若另加条件（如「非 default 才生效」），清单就成了假信号——这是坑 29「存在≠有效」的反向版本（**有效≠被启用**）。
  - **成对/成组资源在消费方判齐**：「哪两枚属于同一个按钮」是用图插件的知识，注册表只声明单槽；判齐放在消费方，`fallback` 文案负责告知用户「需成对提供」。
  - **hover 反色规则要按渲染方式分流**：`svg path { stroke:#fff }` 会连主题内联稿一起强加白描边（填充型/彩色图标在红底上糊成一团）。内置=svg 自带类名、主题=span 包 svg，用 `svg.dsh-desktop-titlebar-icon` 收窄旧规则 + hover 改 `color:#fff` 走 `currentColor`。

## 坑 31 · 上游新版判据拿错源：npm dist-tags 滞后于 GitHub release，auto 静默漏检 3 天

- **现象**（2026-09-07，用户实查打脸）：`npm run upstream:auto` 报「无新版本（0.1.2-rc.1 已是最新）」，但上游 GitHub 已发布 `dsh-v0.1.3-alpha.1`（2026-09-04 19:34 北京时间）。每日 02:00 定时任务已连续 3 天静默漏检，工作区零改动、零报告。
- **根因**（两层）：
  1. `cmdCheck` 的新版判据取 `registry.npmjs.org/-/package/@deepseek-ai/dsh/dist-tags`（alpha/latest/next 三条），而上游发布顺序是**先打 GitHub tag/release、后发 npm**；`0.1.3-alpha.1` 在 npm `versions` 里根本不存在（`npm view @deepseek-ai/dsh@0.1.3-alpha.1` → E404），三条 tag 全指 0.1.2 系列，`compareVersions` 自然判不出更新。
  2. 连带缺口：`assess` 的 roster 存在性是 `aligned.has(p) ? packageExistsAt(p, ver) : packageExistsAny(p)`，而 roster 清单（取自 `boot.ts` + `desktop-patch.yml`）**不含主包 `@deepseek-ai/dsh`**，独立版本线包只查「包在不在」。结果目标版本整体未发行也能报「92 包全部存在」，判成 `review` 而非 `blocked`——把「根本装不了」误报成「可人工适配升级」。
- **解法**：权威源换成 GitHub releases（`/releases?per_page=30` → 过滤 `dsh-v*` 前缀得版本号 → `compareVersions` 降序），npm **降级为「是否可安装」的发行校验**（`packageExistsAt('@deepseek-ai/dsh', v)`）。check 输出三态：无新版 / 可安装候选 / **pending**（上游已 release、npm 未发行）。`cmdAuto` 遇 pending 显式停止（不改文件、不登记台账、打印 release notes 链接）；`cmdUpgrade` 加同口径前置校验，堵住手工 `upgrade <未发行版>`；`--tag alpha|latest|next` 随判据源作废删除。
- **复盘要点**：
  - **「上游出了新版」与「我能不能装」是两个正交问题**，判据源不能混用：git tag/release 是版本真源，registry 只是分发渠道（会滞后、会被镜像缓存掩盖）。
  - **存在性检查必须区分「包存在」与「该版本存在」，且要覆盖主版本包**，否则「目标版整体未发行」这种最严重的阻断也能全绿通过。
  - **自动化的「无变化」结论只能由权威源保证**，不能建立在下游代理指标上——代理指标缺数据时的表现恰好是「看起来一切正常」。

### 坑 32 · 自绘侧栏「新会话」崩：把 UI service 方法当 domain service 方法调

- **现象**：点侧栏「新会话」（宽列按钮 / rail 加号）触发 `Uncaught TypeError: ctx.workspaces.startSession is not a function`，报错路径 `dsh-ui://app/assets/index-*.b.js`。
- **根因**：自研 sidebar 壳 `src/desktop-shell/web/desktop-sidebar-client.js` 的 `sidebar` 槽位 `inject` 里写 `ctx.workspaces.startSession(...)`。`ctx.workspaces` 是 framework 的 **workspace domain service**（只挂 `list` viewer、`insertSessionBefore` 等数据方法），**没有** `startSession`；`startSession` 属官方 **UiWorkspaceService** 的 UI 动作（`connectWorkspace` + `sessions.open` 的「复用-or-新建」语义），官方 ui-sidebar 用 `ctx.get("uiWorkspace")` 取它再调用。
- **解法**：inject 回调改 `const workspaceNavigation = ctx.get('uiWorkspace'); return { startSession: (id) => workspaceNavigation.startSession(id), toggleSidebar: () => ctx.layout.toggleSidebar() }`；`exports.inject` 由 `['slots','layout','workspaces']` → `['slots','layout','uiWorkspace']`。
- **复盘要点**：
  - `ctx.get()` 的 key 是**服务注册名**（camelCase），不同 service 域方法集迥异——domain service（workspaces 管数据）与 UI service（uiWorkspace 管动作）别混着取方法。
  - 报错栈在压缩 bundle `index-*.b.js` 是**宿主把自研壳消息打进官方主 bundle 的行号**，不代表失败发生在官方源码。

## 通用排障方法论

1. **沙箱无法代跑 GUI** → 让用户外部跑，**加精确断点日志** + 用户回传，避免盲试。
2. **每次只加一行能区分分支的日志**（handler=set/null、校验通过、fetch status/body），用日志组合定位停点。
3. **接上游服务先读真实接口**（`.handleRpc`、`new URL` 绝对性、`pick` 返回 string 等），别凭命名猜。
4. **zod 边界别比上游契约更严**（rpcId 示例）。
5. **Cordis 服务注入必须 `extends Service`**，普通对象赋值无效。
6. **官方双面插件要分清 node 面（注册服务）与 client 面（渲染）**，装配两条线都要覆盖。
7. **高频日志走 verbose 门控**（`DSH_VERBOSE=1`），失败必显——刷屏的成功日志会淹没唯一重要的那条错误。
8. **`ctx.get()` 用 service 注册名（camelCase）**，不是 cordis 条目 id（kebab-case），两者常差一个命名风格。
9. **「清单可见 ≠ 可交互」**：冷会话需显式重挂载（session.create 带 sessionId），清单项不保证 live agent。
10. **overlay 补丁写法先问路径**：非 insert 补丁只覆盖已存在条目，空根配置下必是 no-op；新条目必须走 insert（坑 16）。
11. **上游「合法空态」= 装配断点掩体**：页面把空数据当正常态静默渲染 null 时，宿主侧要加「扫描结果必显」探针对冲（坑 16）。
12. **注入脚本先分两层解析归属**：`executeJavaScript`/bundle 源码里的模板字符串，主进程编译期消费一层、renderer 运行期消费一层；嵌套反引号/`${}` 必炸编译，常量直接写字面量（坑 17）。
13. **同文件多处编辑必须串行 + 落盘反查**：并发编辑同一文件会相互覆盖且「成功」报告不可信；每处编辑后 Read 复核，收尾用 dist 产物 grep 反查源码状态——typecheck/lint 测不出「编辑未落盘」（坑 18）。
14. **自绘样式对宿主页一律 important 化/提特异性**：官方 UI 运行时会动态追加样式表覆盖同特异性规则；「规则存在 ≠ 生效」，内容整体下移 N px + 底部等量溢出 = position 被降级的指纹（坑 19）。
15. **`renderSlot` 只能渲染本槽声明的子槽位（槽位所有权）**：跨槽位渲染官方子槽位直接抛 `SlotOwnershipError` 崩溃；要展示非本槽 children 里的官方元素（如品牌 logo），**直接 require 官方组件渲染**，不用 `renderSlot` 走槽位（坑 23）。
16. **官方传输的 wire 契约要逐层对齐**：走官方 connection/typert 时，端点须用「斜杠 `domain/method`」、payload 须是「恰好一个 plain-object `args` 字段 `{args}`」、`args` 内字段名须匹配端点签名参数（`_request`/`request` 等）；持续 404 / `arguments-invalid` 优先查这三层 wire 形态，**不要先归因「启动时序」加盲目重试**（坑 24）。
17. **宿主禁用 ≠ 渲染端不会跑（两条正交装配线）**：host 补丁禁用的 Web 基础设施（如 client-hmr / cordis-runner），其 client 半点仍会被渲染图谱自动扫描激活，对端缺席 → 持续 404 噪音；必须同时把它加进 `CLIENT_EXCLUDE_IDS`。排除一个被他人当服务依赖的插件要连消费方一起排除（判断=对方是否 `ctx.get` 该服务，`inject` 只是顺序提示）（坑 25）。
18. **双面包插件两条装配线都要点名 + 排除即承接全部职责**：官方 ui-* 的 host 半须在 boot.ts 显式 insert（对照官方 cordis.patch.yml 逐行核对，同口径一次补齐）；排除官方插件（如 ui-layout）前盘点其全部 effect，被排除职责（如 ThemePresenter）须在自研件中等价补齐——「事件有人发 ≠ 有人消费」。壳层配色用 `light-dark()` 双值/官方 token，不硬编码单值（坑 26）。
19. **自绘界面两层纪律（配色 + 尺寸）**：颜色一律官方 `--dsw-*` token 或 `light-dark()`，禁止内联硬编码单值（浅色主题必不可读）；内容宽度不可控的 grid/flex 子项必须显式 `min-width:0` + 内层轨道 `minmax(0,1fr)`，`minmax(Npx,1fr)` 不封顶、子项 min-content 会反向撑破容器（`nowrap` 文本标签是头号元凶）（坑 27）。
20. **「清单/概览」类 UI 的数据源必须是需求注册表，不是文件系统或目录扫描**：扫描只回答「有什么」，答不出「该有什么」；带静默回退链的槽位（缺了也能跑）缺口会被永久藏住。清单、上传、校验三处共用同一份注册表（真源一处，renderer 只渲染），新增消费点即新增登记项（坑 28）。
21. **「有没有」判定要带最小有效性检查，替换字形要做光学归一**：`existsSync` 不等于可用——0 字节/解析不出的文件在静默回退链下表现为「显示成了别的东西」而非报错；跨来源的图标必须按内容包围盒（离屏 `getBBox()`）重设 viewBox 才能视觉等大，同盒子尺寸不等于同视觉尺寸。资源类改动收尾看 `dist/` 实际文件清单（copy 只覆盖不删除）（坑 29）。
22. **清单展示、上传落盘、消费方启用三处必须同一口径同一真源**：注册表说「已提供」而界面不生效=假信号（消费方别自己加 `!== 'default'` 这类条件）；成组/成对的资源在消费方判齐再启用，注册表只声明单槽；首帧就要正确的控件不许用异步渲染填空——先画兜底图形、缓存命中走同步 peek（坑 30）。
23. **版本跟踪先定权威源，再定发行校验**：判「上游有没有新版」用 git tag/release（版本真源），判「我能不能装」用 registry 该版本是否存在（分发渠道会滞后）；两者混用会让「渠道还没发」表现为「上游没发」这种最坏形态的静默漏检。「无新版」结论要能用第二源交叉对账（release 清单 vs registry versions）（坑 31）。
24. **压缩后源码的方法名不可 grep，用原文对账**：官方 node_modules `lib/*.js` 发布时方法名被压缩（如 `startSession` 显示为 `ln`），grep 可读结果会骗你又骗日志栈；读时用 Read/原文，方法名以 source map / 调用链上下文为准。`ctx.get()` 的 key 是 service 注册名，**domain service（workspaces 管数据）与 UI service（uiWorkspace 管动作）方法集不同**，UI 动作必须从 `uiWorkspace` 取，别在 domain 上硬调（坑 32）。
25. **依赖安装「退出码 0」不等于环境就绪**：靠 postinstall 拉二进制的包（electron / playwright / esbuild / better-sqlite3 等）npm 会吞掉其失败，缺口延后到运行期由 CLI 自愈补装才暴露——报错点与失败点分离。install 后先 `Test-Path` 落地物（`electron/dist/electron.exe`、`path.txt`）再谈运行；多 worktree 同 commit 时优先复用主工作区重资产（拷 `dist` 或 junction `node_modules`），不要默认全量重来（坑 34）。
26. **分阶段替换 UI 的「可后置」判据 = 是否唯一交互入口，不是视觉复杂度**：把某个槽位实现成 `return null` 是合法渲染、静态门禁全绿，却可能锁死整条下游链（本例 picker ⇒ 无 session ⇒ 官方输入框判 `inert` 置灰）。唯一入口类控件必须与服务接管同批落地；验收要顺依赖链看到最终用户动作，别只看本槽位是否渲染（坑 35）。
27. **用 `vm` 沙箱单测浏览器 bundle 时，`deepStrictEqual` 对跨 realm 对象必误报**：`node:assert/strict` 的 `deepEqual` 会把 vm realm 的对象与宿主 realm 的字面量判「same structure but not reference-equal」，连空数组 `[]` 都不放过（Array/对象原型主 realm 不同）。解法：断言别用 deepEqual 比较跨 realm 数组/对象——改投影为基本值逐字段 `assert.equal(arr.length, n)` + `arr[i].field === x`。仅当 bundle 导出的是**基本值**时方可整体深比（W2 派生层单测教训，`test/workspace-tree.test.cjs`）。
28. **沙箱内跑 Electron（启动/打包）先看输出尾部，不要先看错误头**：拦截是环境坑但会以业务错误形态出现（`loader entries failed to apply` / 打包中途卡死），真正的根因永远在最后一行 `TRAE Sandbox Error: hit restricted` 的「被拒路径」里。被拒路径落在工作区外（数据目录 `$DSH_HOME`、IME 日志、系统色彩配置、`AppData` 缓存）→ 直接授权沙箱外运行或加白名单放行，**改代码是空转**（坑 0 / 38 / 42）。
29. **判断「某个 agent 预设实际看到什么」要按注册表作用域推，不能按预设声明推**：`dsh-tools` / `dsh-system-prompt` 一律「全局层（宿主平面 root 注册）+ scope 链（预设/子 agent）」**并集**解析，预设自有声明只能影子遮蔽**同名项**，全局层里的**其它**项照样进请求；宿主 roster 抄官方时必须连官方 profile 的 `disabled` 关停表一起抄（坑 53）。计量证据双读：本地 `contextBreakdown`（system/tools/message 估算）+ 模型侧真实 `tokenUsage`（uncached + cacheRead），两者差一个量级就是泄漏信号；`$DSH_HOME/storages/session_projcache/sessions/*.json` 是免解压的第一现场。
30. **「用户可自定义的资源目录」必须能区分「随包资源」与「用户自己的」**：只按 `existsSync` 跳过已存在文件的"迁移"其实是一次性种子，随包资源更新永远到不了存量安装；解法 = 修订号 + 写入哈希（一致才覆盖，改过就保留），并明确「内置资源 vs 激活包」的真源归属（坑 54）。验证资源类改动是否生效，直接读**运行期真源目录**（如 `$DSH_HOME/icons`）的文件与哈希，不要只看仓库里的资源文件已更新。
31. **服务缺席要查「有没有 insert 行」，不是「有没有 disabled 行」**：非 insert 补丁只按 id 覆盖已存在条目，`{ id, disabled: true }` 写在一条从未插入的行上是**空操作**（坑 55）。诊断顺序 = 报错里的服务名 → `rg -uu` 找提供它的官方包（看 `static inject` / `provide`）→ 回本仓 roster 核对 **insert** 清单 + 客户端图谱排除表；agent 预设/list 类 `inject` 是硬契约，缺一个服务即整块挂不上（`N row(s) did not activate`），恢复时「宿主提供行 + 客户端半 + 宿主 UI 槽位」必须同批回填。

## 结论

攻坚第 2 批（官方 UI 完成日常对话全流程）在剔除 client-connection 抢占 connection、修 RPC 入口、扩自动扫描图谱、换 Electron 目录选择器、补 settings 注册后**实机验收通过**：官方 UI 成功渲染 + 工作区选择 + 日常对话全流程打通。

---

## 坑 33：启动闪屏首帧主题不跟随应用（深色系统 + 应用浅色 → 裸屏黑色）

- **现象**：应用内设为浅色主题、系统为深色时，启动闪屏（裸屏启动页）仍是黑色，与主窗口/应用主题不一致。
- **根因**：闪屏 `createStartupSplash()` 在主进程早期（main.ts 0.6 步）创建，此时 `nativeTheme.themeSource` 仍是默认 `'system'`（跟随 OS），闪屏 HTML 按 `nativeTheme.shouldUseDarkColors`（系统明暗）渲染。应用主题偏好 `ui-theme.preference` 由 `src/desktop-host/theme-sync.ts` 等 host 装配后经 `settings.describe`（RPC）才同步到 `themeSource`；其 `ready` 语义只保证「建**主**窗口」前同步，不覆盖更早创建的闪屏。且闪屏是静态 data-URL HTML，晚同步到达前视图早已渲染，后续不重绘。
- **解法**：
  1. `src/desktop-shell/theme-pref-init.ts`（新增 `applyPersistedThemeSource`）：闪屏创建前用 Node fs + `yaml` 同步读 `$DSH_HOME/settings.yaml` 的 `ui-theme.preference`，提前设 `nativeTheme.themeSource`；ENOENT / 非法值静默回退默认。
  2. `main.ts` 0.55 步：`ensureDataHome()`（已设 DSH_HOME）之后、`createStartupSplash()` 之前调用。
  3. 兜底：`splash.ts` 配色改 `:root` CSS 变量承载 + 监听 `nativeTheme 'updated'` 实时重绘（OS 切换、主题运行中变更时刷新）。
- **复盘要点**：判定「跟随主题」必须区分两类信号——「建主窗口首帧前才同步」（theme-sync ready）与「host 装配前就渲染的极早期视图」（闪屏）。数据早于 host 装配、且项目已有 `yaml` runtime 依赖时，直接同步读持久化文件最可靠，勿依赖晚同步 + RPC 的反馈链路。

---

## 坑 34：worktree 里 `npm install` 报成功但 electron 二进制缺失，`npm start` 才触发 365 MB 补装

- **现象**：新建 worktree（`desktop/dsh-workspaces`，`feat/workspaces`）后执行 `npm install`，输出 `added 967 packages in 1m` **无报错**；随后 `npm run dev` 在 `[build] 已复制 22 个静态文件…` 之后突然打印 `Downloading Electron binary...`。检查发现 `node_modules/electron/` 下**没有 `dist/`**、`path.txt` 为空文件，而主工作区同版本（44.0.0）两者齐备。
- **根因**：两层叠加。
  1. electron 的二进制**不经 npm 分发**——包体只含 `install.js`，实际 `dist/` + `path.txt` 由 `postinstall` 经 `@electron/get` 落地。本次 install 的 postinstall 未成功完成（沙箱环境下对受限路径的写入会被拦），而 npm 对 postinstall 异常仍可整体返回成功 → **「install 成功」≠「环境就绪」**。
  2. `electron/cli.js` 启动时若发现 `path.txt` 不存在，会**自动拉起 `install.js` 补装**并打印那行 `Downloading Electron binary...`。这条自愈链把安装期的缺口一路延后到运行期才暴露，表现为「凭空多出一趟大文件拉取」，且日志与真正的失败点（早先的 postinstall）完全脱节。
- **解法**：**不重下，复用主工作区现成产物**（两树同 commit、`package.json`/`package-lock.json` 逐字一致、electron 版本同为 44.0.0，复用无风险）：

  ```powershell
  robocopy '<主>/node_modules/electron/dist' '<worktree>/node_modules/electron/dist' /E /NFL /NDL /NJH /NJS /NP
  Set-Content '<worktree>/node_modules/electron/path.txt' -Value 'electron.exe' -Encoding ASCII -NoNewline
  node node_modules\electron\cli.js --version   # → v44.0.0，不再触发补装
  ```

  拷后**双向核对规模**（73 文件 / 365.9 MB，文件数与总字节数均一致）再验证运行。
- **复盘要点**：
  1. 凡「二进制不走 npm 分发、靠 postinstall 拉取」的依赖（electron / playwright / puppeteer / esbuild / better-sqlite3 / node-gyp 系），install 后必须**显式 `Test-Path` 落地物**，不能只看 npm 退出码与 `added N packages`。
  2. 多 worktree 同 commit 时应**优先复用重资产**：轻则拷单个 `dist`，重则整体 junction `node_modules` 到主工作区（省 GB 级重复）；别默认全量重来。分支一旦改依赖，junction 需退回独立安装。
  3. 这类缺口的**报错点在运行期、不在安装期**——见到运行期才出现的「正在下载/正在编译」，先回查安装期是否静默降级，而非就地等它下完。
  4. 本地其实已有 `electron-v44.0.0-win32-x64.zip` 缓存（`%LOCALAPPDATA%\electron\Cache`），说明这趟即便走原路也只是解压 365 MB；**缓存存在不是理由，直接拷现成 `dist` 更快且零副作用**。

---

## 坑 35：W1「空壳」把应用整体锁死——picker 是唯一交互入口，不属可后置的视觉件

- **现象**：`feat/workspaces` 装载后**全应用不可用**：侧栏只有「工作区 / 暂无会话」两行；对话区「选择工作区 ▾」点了无反应；输入框占位「选择一个工作区开始」且**敲不进任何字符**；「新会话」按钮点击无效果。同版本基线的 `main` 分支一切正常 ⇒ 坐实为 W1 引入的回归。**全程无任何报错**，typecheck / lint / build 全绿。
- **根因**：W1 把 `WorkspacePicker` 按「可后置的视觉件」实现成 `return null`，但它其实是选/加工作区的**唯一入口**，锁死一条三级连锁：
  1. 无入口 ⇒ 无法创建/选中工作区 ⇒ 无 `current session`；
  2. 官方 `ui-conversation` 据此判 `const inert = sessionId === void 0 || hero && chipTitle === void 0`（`lib/client.js:14436`）⇒ 输入框 `disabled: true` + 占位 `placeholder.workspace`——**这正是"打不进字"的直接出处**，而非输入框自身有 bug；
  3. 「新会话」走 `uiWorkspace.startSession()`，其 target 解析链（显式 id → 当前会话所属 → 最近活跃）全部落空 ⇒ 只能 `sessions.clear()` 空转。
  官方源码里「添加工作区只有一条路」+「`addIsTheOnlyEntry` 时 open 即直接抬系统目录选择器」这两条设计约束，本已明示该槽位的承重性质。
- **解法**：按官方 `WorkspacePickFlow` 等价实现**共享内核**（`Menu`/`Modal`/`Button`/图标直接 `require` 官方 primitives），Browser 与 Picker 两壳仅以 `addOnly` / `side` / `onPick` 分化——侧栏 `addOnly + startSession(workspaceId)`，对话区完整菜单 + `onPick` 交回 owner。语义收在一处防两壳漂移。补 21 项行为断言锁死该链（菜单抑制条件、工作区列表、`::add-workspace` 固定项、收养 create→onPick、失败弹层两出口、**无占洞者时不得出现假「添加」入口**、侧栏 addOnly）。
- **复盘要点**：
  1. 分阶段自绘（「先换壳不换内容」）的**可后置判据不是"视觉复杂度高低"，而是"是否承载唯一交互路径"**。凡某条业务链的唯一入口，必须与服务接管同批落地，否则整链锁死。
  2. 排除官方 UI 件后，验收要看**下游依赖链是否仍成立**（本例输入框 disabled 由 `sessionId` 决定，而 `sessionId` 由被排除件的 picker 决定），只看"本槽位渲染成功"会得出完全错误的结论。
  3. `return null` 是**合法渲染结果**，静态门禁一律放过——这类静默锁死只有实机或行为级测试能发现。空壳阶段尤其需要行为断言兜底。
  4. 定位手法：症状在 A（输入框）、病因在 B（picker）、判据在 C（`inert` 表达式）。读官方源码里把控件置灰的那个布尔表达式，比在症状组件里翻找快得多。

## 坑 36：部署器把 session-query 索引设为 `openAt "never"` → 内容搜索每次按键都打 `RPC 失败 (session/search)`

- **现象**：接入 W4 内容搜索后，搜索框每敲一个词，主机侧日志就抛一条 `RPC 失败 (session/search): ...SessionQueryError: session search is disabled: this deployment configures the session-query index with openAt "never"`（栈落在 `unpackServerResponse → callApi → bridge.js`）。输入仍出本地名匹配且弹「内容搜索暂不可用」警告——功能降级本身对，但每次按键都重发注定失败的 RPC，噪声持续刷屏。
- **根因**：宿主按部署配置把会话内容检索索引关闭（`openAt "never"`），`session.search` 一经调用必失败。渲染侧 `searchSessions` 的 `.catch` 已把它当作「不可用」降级，但**失败发生在 RPC 载波层**（主机侧在拒绝时自行打日志），早于组件 catch——依赖「每次失败 → catch 设 error」就必然每个输入事件都触发一次主机侧报错。
- **解法**：给 `searchSessions` 加**探测即锁定**：首次调用捕获到 `/disabled|openAt/` 类错误后置 `remoteSearchDisabled = true`，后续调用直接短路抛同义错误、**不再向 Host 发 RPC**。本地名称命中与「不可用」警告的降级路径原样保留（`SearchResults` 对 error 态只消费本地 items）。锁定值放 `apply()` 作用域（装载一次、跨重挂载持久）。build 后 `dist/` 同步生效。
- **复盘要点**：
  1. 命令行/桥接层自带的失败日志与组件级降级是**两条独立路径**：组件 catch 只止住「未捕获异常」，止不住 infra 层的 per-request 打印。要消除噪声须**少发请求**，而非多 catch。
  2. 「被功能开关关闭的能力」是**稳定的持续状态**，应在首次探测后 latch，不要每次用户操作都去重复试探；判据用错误文案匹配是当前唯一可用信号，锁定态宁可误锁（少发请求）不可漏锁（刷屏）。
  3. 该部署下内容搜索**本就不该可用**，正确结局=本地名匹配 + 明确「仅名称匹配」提示，而不是假调用或持久报错。可后置判据再次验证：连「花哨能力」的失败也要有体面出口。

## 坑 37：纯 Node 环境下 require `boot.js` 因 `electron.app` 为 undefined 而崩；verify 脚本与 `CliOptions`/载波行失配（均既有缺陷，开启搜索索引时暴露）

- **现象**：改动 `src/desktop-host/boot.ts` 后跑 `node scripts/verify-serve-mode.cjs`，报 `TypeError: Cannot read properties of undefined (reading 'isPackaged') at runtimeRoot (dist/desktop-host/boot.js)`，模块加载即失败。
- **根因**：`boot.ts` 顶层 `const RUNTIME_ROOT = app.isPackaged ? …` 在**纯 Node**（verify 脚本 `require('dist/desktop-host/boot.js')`，无 Electron 运行时）下 `electron.app` 为 `undefined`。M4-a1 引入该常量后 verify-serve-mode 一直失配、从未通过——是**既有测试基建缺陷**，与本轮开启搜索索引无关，但改 boot.ts 会触发。
- **解法**：
  1. `RUNTIME_ROOT` 改为惰性 `runtimeRoot()`，且在 `app === undefined` 时回退开发路径（Electron 运行时 `app.isPackaged` 恒可用）。
  2. 修复 verify 脚本与现状的两处失配：① `parseArgv` 在 M4 新增 `--hidden/--select-data-dir` 后恒返回四字段 `{ serve, servePort, hidden, selectDataDir }`，旧断言只期望两字段；② 0.1.2 升级后传输层行已变——`connection`→`host-connection`（激活，IPC 载波背板，不再 disabled）、`client-runtime` 已删、`client-hmr/cordis-client-runner/cordis-host-runner` 仍 disabled。
- **复盘要点**：
  1. 顶层 `import { app } from 'electron'` 的对象只在 Electron 主进程才有值；**可被纯 Node require 的模块**（尤其被 `scripts/*.cjs` 测试/校验脚本加载的）不能在建模块时触碰 `app`/`BrowserWindow` 等 Electron 专属 API，须惰性取或判空。
  2. 校验脚本的期望值要**随契约源头同步**：`parseArgv` 返回结构变了，`verify-serve-mode.cjs` 的 `deepEqual` 断言也要跟着改，否则每次 CI/冒烟都误报。
  3. 这类「既有但从未跑过」的脚本，凡改动其依赖模块就会把潜伏失配引爆——改 boot.ts 前先跑一次该脚本探底，比事后逐一修快。

## 坑 38：TRAE 沙箱拦截 electron-builder 图标工具——打包卡死在 icon 转换（环境坑，非代码坑）

- **现象**：worktree 内 `npm run dist` 编译全过（tsc ✅、electron zip 下载解压 ✅），卡在图标转换报 `TRAE Sandbox Error: hit restricted`，被拒路径 `AppData\...\Windows\Recent\CustomDestinations\*.temp` 与 `AppData\Local\electron-builder\Cache\icons@1.1.0`。
- **根因**：electron-builder 转 PNG→.ico 的内置工具要写 AppData 下两个系统路径（Recent\CustomDestinations 临时文件 + electron-builder 图标缓存），TRAE 沙箱默认只放行工作区。与坑 0（沙箱拦 Electron 启动）同族：**GUI/工具链进程天然要碰工作区外文件**。
- **解法**：Settings → Permission & Approval → Custom Configuration 放行 `C:\Users\Administrator\AppData\Local\electron-builder\`（缓存目录，放行后后续打包全免拦）；或当次授权「沙箱外运行」。
- **复盘要点**：打包类命令（electron-builder/electron 均如此）在沙箱内首次跑失败时，先看报错是否 `TRAE Sandbox Error`——环境坑不用改代码，改配置即可；配置一次全项目受益。

## 坑 39：`installer.nsh` 带**双 BOM** 潜伏一个里程碑——NSIS 报 `Invalid command: "?;"` 才引爆

- **现象**：NSIS 打包报 `Invalid command: "?;"  !include: error in script: "build/installer.nsh" on line 1`，第 1 行明明是注释。
- **根因**：文件头字节 `EF BB BF EF BB BF`——**双 BOM**。NSIS 吃掉第一个 BOM 当文件标记，第二个成了第 1 行正文，报「非法命令」。该双 BOM 自 M4-a4 提交（086c4c2）起就存在，但那次提交后**再没执行过 dist**，潜伏到今天。
- **解法**：读全文去首个 U+FEFF 后以「UTF-8 with BOM」单 BOM 重写（NSIS 对中文 .nsh 恰恰**要求**保留 BOM，见 electron-builder.yml 注释——坑在「双」不在「有」）。
- **复盘要点**：
  1. `.nsh/.ps1` 等 Windows 工具链消费的文件，BOM 是正确性而非风格问题；提交前可 `Format-Hex` 抽查头部。
  2. **提交≠验证过**：M4-a4 只验了运行时行为（卸载询问），没跑过完整 dist——「改了打包配置但没打包」的提交就是定时炸弹；凡动 `build/`、`electron-builder.yml`，收尾必须跑一次 `npm run dist`。

## 坑 40：worktree 里打包——`.git` 是指针文件，electron-builder 探测不到仓库致 latest.yml 生成崩溃

- **现象**：主工作区打包历来成功；在 worktree（`dsh-updater`）里 dist，安装包/便携包/签名全部产出后**最后一步崩**：`⨯ Cannot read properties of null (reading 'provider')` at `updateInfoBuilder.ts`，且前置警告 `Cannot detect repository by .git/config` × 3。
- **根因**：electron-builder 生成 `latest.yml` 时从 git 仓库探测 GitHub owner/repo；worktree 的 `.git` 是**文件**（指向主仓库的指针）而非目录，探测失败 → publish 配置解析为 null → 崩溃。配置里 `publish: provider: github` 未写 owner/repo，全靠 git 探测兜底，在 worktree 里断链。
- **解法**：`electron-builder.yml` 的 publish 段**显式写死** `owner: lansi-ai` / `repo: dsh-desktop`——两处环境（主区/worktree）都能打，不再依赖探测。
- **复盘要点**：「同一份代码换个目录结果不同」时，先 diff 环境差异（此处 `.git` 形态）；隐式探测（git/registry/env）类配置，发布产物要走通就得显式钉死，探测只配兜底。

## 坑 41：CI 用 `--publish never` + `gh release upload` 发布，`latest.yml` 的 path（连字符）与 GitHub 资产名（点号）脱节 → 自动更新 404

- **现象**：v0.1.1-alpha.4 经 CI（release-win/win-mac）上传到 GitHub Releases 后，Release 资产名形如 `DSH.Forge-0.1.1-alpha.4-setup.exe`（**点号**），而 `latest.yml`/`latest-mac.yml` 的 `path` 字段是 `DSH-Forge-0.1.1-alpha.4-setup.exe`（**连字符**）。electron-updater 按 `path` 拼下载 URL，命中的资产名不匹配 → 更新下载 404，M4-b 三通道自动更新静默失效。
- **根因**：electron-builder 磁盘产物由 `nsis.artifactName: ${productName}-${version}-setup.${ext}` 生成，`productName="DSH Forge"`（含空格）；它**自己 publish** 时会做空格的规范化（空→`-`）并保证 `latest.yml` 的 path 与上传资产名一致。但 CI 用了 `--publish never` + `gh release upload` 绕过这套协调：`gh upload` 按磁盘字面名上传，GitHub 把文件名里空格规范成**点号**存储，于是 path（连字符）与资产名（点号）错位。
- **解法**：本轮已对已发布 Release 用 `PATCH /repos/{o}/{r}/releases/assets/{id}` 逐资产把 `DSH.Forge-` 改成 `DSH-Forge-`，与 `latest.yml` 的 path 对齐（blockmap 一并改），并匿名 `HEAD` 验证 `releases/download/{tag}/DSH-Forge-*.setup.exe` 及其 `.blockmap` 返回 200。**根治**：今后 release workflow 在上传步骤加一步——读 `latest.yml` 的 `path` 字段，把待上传产物重命名为与该 path 完全一致的落盘名再 `gh release upload`。**已落地（2026-09-09）**：新增 `scripts/align-release-assets.cjs`（读 `latest*.yml` 的 path/url 声明，把磁盘产物与同名 `.blockmap` 改为逐字一致名，并兜底去掉未声明产物如便携包的空格），win/mac 两个 workflow 上传前各插一步调用；本地发版 `npm run release -- <version> --local` 亦复用该步。
- **复盘要点**：
  1. 凡 CI 手动上传 electron-builder 产物（非 `--publish always`），必须核对 `latest.yml` 的 `path` 与实际上传资产名逐字节一致，否则平台自动更新是"假功能"。
  2. 验证手段：下载 `latest.yml` 读 `path`，再匿名 `HEAD https://github.com/{o}/{r}/releases/download/{tag}/{path}` 应 200；**验证不可带 Authorization header**（公开下载端点带 token 反被 401，曾误判）。
  3. artifactName 里的 `${productName}` 含空格，是这场错位的源头——要么 workflow 显式重命名对齐 path，要么后续把 artifactName 改为无歧义 `${name}-...`（等于 package.json name）。

## 坑 42：沙箱拦「数据目录」写入 → 宿主报 `loader entries failed to apply`（环境坑，伪装成代码坑）

- **现象**：沙箱内 `npm start` 启动，闪屏与插件清单日志全部正常打印（52 个插件、Host 就绪、载波/窗口装配一路 ✔），随后进程退出码 1，报
  `AggregateError: loader entries failed to apply`（`at EntryGroup.update ... cordis-plugin-loader`，`[errors]: [Array]` 细节被 console 折叠成 Array 不可读）；**只有翻到输出最末尾**才看到真正的根因
  `TRAE Sandbox Error: hit restricted / Not allow operate files: C:\Users\Administrator\AppData\LocalLow\Tencent\WeType\MM_TIP_*.xlog, C:\Windows\system32\spool\drivers\color\sRGB Color Space Profile.icm, E:\Projects\DSHPath\.credentials.yaml.lock, E:\Projects\DSHPath\search\session-query.sqlite-shm`。
- **根因**：沙箱默认只放行工作区（`E:\Projects\DSH\desktop`），而**运行时数据目录在工作区外**（`E:\Projects\DSHPath` = `$DSH_HOME`）：`desktop-credentials` 的 watch 要写 `.credentials.yaml.lock`、session-query 搜索索引要写 `*.sqlite-shm`，双双被拒 → 对应 host 插件 `apply` 抛错 → Cordis loader 聚合为 `loader entries failed to apply`。即「业务错误壳（loader 装载失败）包着环境错误（沙箱拦截）」，与坑 0（拦 IME 日志/系统色彩配置）、坑 38（拦 electron-builder 缓存）同族。
- **解法**：改为**沙箱外运行**（命令授权「在沙箱外运行」）后同一份代码零改动即正常启动（窗口 2 就绪、`dsh-ui://app/index.html` 加载完成、会话预热 13/13）；长期方案 = Settings → Permission & Approval → Custom Configuration 放行数据目录 `E:\Projects\DSHPath\`（一次放行，凭据 watch 与搜索索引都不再被拦）。启动命令口径：`dist/` 已是最新 → `npm start`；源码有改动 → `npm run dev`（build + electron）。
- **复盘要点**：
  1. **报错分层看**：Cordis 的 `loader entries failed to apply` / `AggregateError` 是**聚合错误壳**，细节被折叠，直接据此查插件代码必空转；先看进程输出**尾部**是否 `TRAE Sandbox Error`，被拒路径决定「环境坑 or 代码坑」。
  2. **数据目录在工作区外 = 沙箱内必失败**：凭据 watch（`.lock`）、sqlite 索引（`-shm`）这类运行期落盘是启动必经路径，凡涉及它们一律沙箱外跑，别改代码。
  3. 启动日志里「前半段全绿、后半段退出」的形态，往往是启动链路后段某个插件 apply 失败被聚合，**不要按「启动时序」猜测**，优先定位第一个真实异常。

## 坑 43：同一文件并发编辑互相覆盖（工具使用坑，伪装成「代码没生效」）

- **现象**：一轮里对**同一个文件**发起多条编辑，工具回执全部显示成功（还带 diff），但 `tsc` 报 `Cannot find name 'resolveUserDataRoot'`、`Property 'dataDir' does not exist on type 'CliOptions'`、`'migrateLegacyUserDataSync' is declared but its value is never read` 这类「导入缺失 / 字段不存在 / 声明未使用」错误；回读文件发现只有**部分**改动落地。
- **根因**：编辑工具是「读快照 → 替换 → 写回」。同一文件的两条编辑并发执行时，第二条拿到的快照不含第一条的结果，写回即把第一条回滚掉。
- **解法**：**同一文件的多个改动串行执行**（一条消息只发该文件的一条编辑），不同文件可并行；改完以 `typecheck` 与 grep 复核为准，**不以工具回执的 diff 为准**。
- **复盘要点**：
  1. 回执 diff 只证明「这次替换算出了结果」，不证明「文件最终态包含它」——同文件并发写会互相吞。
  2. 批量改代码后先跑 `typecheck`；错误集中在「导入缺失 / 字段不存在」时，优先怀疑编辑被覆盖，而不是类型真写错了。
  3. 改名/跨文件重构（import + 使用点 + 配置三处齐动）最容易踩：一文件一消息，改完 grep 关键符号复核。

## 坑 44：沙箱拦 git 凭据库 → push 报 fatal 但实际已成功（环境坑，伪失败）

- **现象**：沙箱内 `git push` 退出码 1，输出 `fatal: unable to write credential store: Permission denied` + `Everything up-to-date` + `TRAE Sandbox Error: hit restricted / Not allow operate files: C:\Users\Administrator\.git-credentials.lock`；而 `rtk git status` 显示 `main...origin/main` 且**无 ahead 计数**，看起来像「没推上去」。
- **根因**：推送本身用已缓存凭据成功完成，随后 git 想把凭据写回 `~/.git-credentials`（需 `~/.git-credentials.lock`）被沙箱拦截——**失败发生在数据传输之后**，只影响「下次是否还要输凭据」，不影响本次推送。
- **解法**：不要据 fatal 判定失败，用远端真值核对：`git rev-parse main` 与 `git ls-remote origin refs/heads/main` 的 SHA 一致即成功（本例两边均为 `f1d6aa2d…`）。要消除报错则放行 `C:\Users\Administrator\.git-credentials.lock`（或整个 `~/.git-credentials*`）。
- **复盘要点**：
  1. 「fatal + 退出码非 0」不等于操作未发生——**先看失败发生在哪一步**（凭据持久化 vs 数据传输）。
  2. 远端状态用 `git ls-remote` 判，别信本地 remote-tracking ref（它可能已被本地更新）。
  3. 与坑 42 同族：沙箱拦的是工作区外的运行期写入，这类报错一律先看输出尾部 `TRAE Sandbox Error` 指向哪个路径。

## 坑 45：打包版根锚点 cordis.yml 落在 userData → agent-presets 健康检查向上找不到 node_modules，安装版无法聊天（dev/start 正常）

- **现象**：安装版（v0.1.1-alpha.5）发消息即失败，`npm run dev` / `npm run start` 一切正常。CLI/日志报 `agent-presets: preset 'standard' failed to mount: 23 rows name plugins that cannot be resolved`（23 行插件全部"无法解析"），客户端侧表现为 `session/prompt failed: connection: invalid server-response failure (gateway/internal)`。asar 内 26 个关键插件包经 `@electron/asar.listPackage` 验证**全部存在**——不是打包丢文件。
- **根因**：三层链条叠加：
  1. `dsh-app-boot` 的 `boot()` 将 `ctx.baseUrl` 设为 **configPath 所在目录**（`lib/index.js:1495`）；Cordis `Include` constructor 同样改写 `ctx.baseUrl = dirname(配置文件)`（`cordis-plugin-include/lib/index.js:138`）。
  2. `dsh-agent-presets` 的健康检查 `packageInstalled(name, base)`（`lib/invariant.js:247`）从 `harnessBase`（= `ctx.baseUrl`）**逐级向上查找 `node_modules/<pkg>/package.json`**，任一级命中即通过——纯磁盘 `existsSync`，与 import 解析无关。
  3. dsh-desktop 的根锚点 `createRootConfig()` 写在 `runtimeRoot()/cordis.yml`：开发模式 = 项目内 `.runtime\`（向上一级命中项目 `node_modules` ✓）；**打包模式 = `userData\.runtime\`（AppData 下，向上到盘符都没有 node_modules ✗）** → 23 行全部判死 → 预设 mount 失败 → 会话无法建立。`bareModuleBaseUrl`（指向 asar 内 node_modules）只救 `Include` 的 `internal.import` 裸包名解析——所以安装版宿主装配、插件 import 全部成功，唯独这个磁盘检查挂掉，极具迷惑性。
- **解法**：根锚点必须位于 asar 内——构建期由 `scripts/copy-web.cjs` 生成 `dist/cordis.yml`（内容 `[]`，随既有 `files: dist/**/*` 进 asar）；`boot.ts` 的 `createRootConfig()` 打包分支改用 `join(app.getAppPath(), 'dist', 'cordis.yml')`。此时 `ctx.baseUrl = <app.asar>/dist/`，向上第一级命中 `<app.asar>/node_modules`（Electron 主进程 fs 对 asar 路径的 `existsSync` 生效）。asar 只读无碍：`Include` 对已存在文件只读不写（`checkAccess` 失败仅标记 readonly）；`_writeFile` 只在编辑 API 被调用时触发。开发模式行为不变。
- **复盘要点**：
  1. 「同一份代码 dev 正常、打包版挂」的路径类差异，先画**每个 base/anchor 的解析链**（`ctx.baseUrl`、`__dirname`、`cwd`、`DSH_HOME`）在两种模式下的值，再对差异点。
  2. 上游包的"健康检查/不变量"用的是**字面磁盘查找**而非 import 解析——两条链路（import vs existsSync）可能基于不同 base，修好一条不代表另一条通。
  3. `userData`（AppData）是**孤岛目录**：任何依赖"向上找 node_modules"的上游逻辑都不能以它为锚；asar 内路径反而是 Electron patched fs 下合法的查找起点。

## 坑 46：自研布局接管 root 槽位漏补官方 `panelInfo` root hook → rightbar 槽位条目崩溃（`usePanelInfo is not a function`）

- **现象**：启动后 renderer 连续报 `TypeError: usePanelInfo is not a function (line 56, dsh-ui://app/assets/index-CIp0YSTs.js)`，紧接 `slot entry crashed in 'rightbar': TypeError: usePanelInfo is not a function (line 526, .../dsh-client-ui-renderer/client.js)`（SlotErrorBoundary 捕获并打印）；同一批次还伴随 agent-preset 的 `cannot get required service "sessions" in inactive context` 刷屏（后者为伴生噪音，见 dogfood #17）。全部 60 个 entry 均 ACTIVE、无任何 `pending/import failed` 报告，极具迷惑性。
- **根因**：0.1.5 上游引入 rightbar 契约——新包 `dsh-client-ui-sidebar-right`（`inject = ["slots","layout","locale","resources"]`）的 `RightbarRoot({ usePanelInfo, SessionProvider, renderSlot, ... })` 把 `usePanelInfo` 当**槽位 binding 注入的 props** 消费，其唯一来源是官方 `dsh-client-ui-layout` 的 `ctx.slots.provideRoot({ hooks: { panelInfo: { getSnapshot, subscribe } } })`（`ui-layout/lib/client.js:519`，与 `ctx.reflect.provide("layout", layout)` 是**同一次 apply 内的两件独立事**）。M6-P1 起自研 `@lansi-ai/dsh-desktop-layout` 接管 root 槽位并排除了官方 ui-layout，但只等价复刻了 `layout` 服务与槽位声明（titlebar/sidebar/conversation/rightbar/shell.overlay），**漏了 panelInfo root hook** → 消费端解构到 `undefined` → 调用即 TypeError → rightbar 条目崩溃。
- **解法**：自研 layout 的 `apply` 内补齐 `ctx.slots.provideRoot({ hooks: { panelInfo: { getSnapshot: () => panelInfoSnapshot, subscribe: () => () => {} } } })`，快照 `{ activePanelId: null }`（桌面直渲染 `conversation` 槽位、无官方 main keyed 面板机制，恒 null 语义 = 无面板占用会话区），并在 fiber disposer 里调用其返回值。
- **复盘要点**：
  1. 「接管官方插件」= 接管其**全部**导出面（服务 + root hooks + 槽位声明）。只做服务等价映射是漏项高发区——本次即"服务在了、hook 没在"。
  2. `assertEntriesActive` 只校验 **entry 级 fiber**：全部 active 也可能业务崩。别把"启动报告全绿"当成没问题，要结合 `unhandledrejection` 全文栈与槽位错误边界日志交叉定位。
  3. 排除上游旧包前，先扫**新引入包**的 `use*` props 来源（谁 provideRoot）——上游迭代常让新包消费旧包的 root hook，排除面需同步扩张。

## 坑 47：`dsh-ui://app/index.html` 无缓存头 → Chromium 启发式缓存致注入图谱陈旧（新增插件条目永不生效）

- **现象**：图谱结构发生变化（新增/移除 client 插件包）后重启，新条目**永不生效**：renderer 从不请求其 `client.js`，而 host 侧插件清单（cordis-inventory）已包含它。本次以临时诊断插件（图谱第 62 条）暴露——该 bundle 零请求、apply 零执行，一度误判为"插件代码有问题"。
- **根因**：`dsh-ui-protocol.ts` 的 index.html 响应只设了 `content-type`、**没有任何缓存头**，而入口 URL `dsh-ui://app/index.html` 恒定 → Chromium 对自定义协议在无缓存头时按启发式规则缓存该响应 → 页面反复使用首次生成的 `__DSH_BOOT__` 图谱。bundle 自身以 `?rev=<内容 hash>` 破缓存，所以**资源内容**总是最新、**图谱条目集合**却卡在旧版，两者错位极具迷惑性。
- **解法**：① index.html 响应补 `cache-control: no-store, must-revalidate`；② 入口 URL 携启动版本 query —— `main.ts` 与 `window-manager.ts` 的 `loadURL` 改为 `dsh-ui://app/index.html?v=${Date.now()}`（多窗口各自取新值），两条双保险。
- **复盘要点**：
  1. 自定义协议 + 运行时注入内容 ⇒ **必须显式声明缓存策略**，不要依赖协议默认行为。
  2. 「资源内容是最新的」与「清单/图谱是最新的」是两件事：带 hash 的 URL 只保证前者。
  3. 图谱类问题的首选排查动作是做**实际请求清单 vs 当前图谱条目**差集——一眼区分"没请求"（装载/缓存）与"请求了没生效"（代码）。

## 坑 48：自研布局只声明 `conversation` 而漏官方语义的 `main` 槽位 → 上游插件的注册被隐式降为 `session-maybe`，启动期 `sessions in inactive context` 刷屏

- **现象**：升级到 `dsh-v0.1.5-alpha.2` 后，启动期 renderer 连续抛 `Uncaught (in promise) Error: cannot get required service "sessions" in inactive context`（约 30 次，栈头恒为 `ui-agent-preset` client.js:1371 → `AgentPresetSeatController.apply` → `scope.sessions.list.subscribe` 回调）；同一批次还伴随 `usePanelInfo is not a function`（已单独修为坑 46）。**官方 web 版（`dsh web`，同一 `node_modules`、同一 Cordis 4.0.2）console 完全干净**——这一步直接证明问题出在桌面侧集成，而不是上游。
- **根因**：自研 `@lansi-ai/dsh-desktop-layout` 接管 root 槽位时，按桌面三列布局声明了 `conversation`（`single` + `session-maybe`），**却未声明官方语义的 `main`（keyed + root）**。而上游 `dsh-client-ui-conversation` 是这么切入的（`ui-conversation/lib/client.js:16823-16836`）：
  ```js
  slots.inject("main", function* () {
    yield slots.register({ name: "main", key: "conversation",
      children: { "main.conversation": { kind: "single", scope: "session-maybe" } } }, ConversationPanel);
    ...
  });
  ```
  缺少 layout 的 `main` 声明后，该槽位由这次注册隐式建立并带上 `session-maybe` scope → **未选中会话时槽位条目被卸载** → 其中 `ui-agent-preset` 注册的 hero chip / session header action 随会话状态反复卸载重建、其 `ctx.effect` 随之重跑 → 重跑落在 Cordis 的 fiber 激活窗口内，`scope.sessions` 解析即抛 `inactive context`。Cordis 侧机制：`_getImpl(name, strict)` 要求提供者 fiber `state === 2` 才认服务可用（`cordis/lib/index.js:765`），而 effect 清理是异步的，故窗口内访问必炸。
- **解法**：自研 layout 的 `slots.register({ name: 'root', children })` 补上 `'main': { kind: 'keyed', scope: 'root' }`，并把 AppFrame 中心列由 `renderSlot('conversation', {})` 改为 `renderSlot('main', {}, { entryKey: 'conversation' })`——与官方 ui-layout 的 MainPanel 语义一致。修复后启动日志只剩清单与「页面加载完成」，零报错。
- **定位手法（可迁移）**：
  1. 先跑 **官方 web 版**（`node --input-type=module -e "process.argv=[process.argv[0],'dsh','web'];const m=await import('./node_modules/@deepseek-ai/dsh/lib/bin.js');await m.runCli()"`，Node 22.16 下 `import.meta.main` 为 undefined 会静默不执行，必须显式调 `runCli()`）——确立"上游是否同样出错"的基线。
  2. 再做**单变量对照**：临时把某个自研件换回对应官方件，看报错是否消失。本次换回官方 `ui-layout` 后报错**完全消失**（换 `ui-workspace` / `ui-sidebar` 均无变化），一步锁定到 layout 的槽位声明。
- **连带症状（同一根因）**：`dsh-client-ui-sidebar-documentpreview`（0.1.5 的 `textpreview` 换代包）的 apply 也曾失败，报 `cannot get property "documentPreviews" without inject`——其 apply 内 `provide("documentPreviews")` 的异步 effect（Cordis 的 provide 本身即 effect）未落地即被同函数体同步访问。排查期曾据此把它临时排除，但补齐 `main` 槽位后该包**自行恢复**（槽位抖动消失，其 fiber 不再被扰动）。**结论：该包不入 `CLIENT_EXCLUDE_IDS`**（2026-09-10 复测：59 个插件装载、零报错）。
- **复盘要点**：
  1. 「接管官方插件的槽位」不止要对齐**服务**与 **root hooks**，还必须对齐**槽位名 + kind + scope**。上游插件用 `slots.inject(<槽位名>)` 等待父槽位，缺声明会让它**自建槽位并继承错误的 scope**，症状出现在下游而非本插件，极难反查。
  2. **scope 决定条目生命周期**：`session-maybe` 会在未选中会话时卸载条目，任何在其中注册 effect 的插件都会被反复重建；`root` 才是常驻。槽位 kind 同理（`single` 会被替换，`keyed` 按 key 常驻）。
  3. 别把结论推给上游——**先跑官方同版本做对照**。本次若不跑 `dsh web`，极易误判为"Cordis 固有竞态"而放弃。

## 坑 49：发版/提交命令的 stdout 与实际结果不符（命令疑似执行两遍，报错但操作已成功）

- **现象**：执行 `npm run release -- 0.1.1-alpha.7 --push`，输出**只有一行**错误 `✗ 目标版本 0.1.1-alpha.7 必须高于当前版本 0.1.1-alpha.7`，看起来彻底失败；但实际发版**完整成功**——`git log` 有 `chore(release): 版本号升至 0.1.1-alpha.7`、本地与远程 tag 均指向该 commit、远程 `main` 已同步、CI 双平台 workflow 已触发。同批次还出现：`git add … ; git commit …` 输出 `nothing to commit, working tree clean`，而该提交实际已存在。
- **根因**：现象与「**同一条命令被执行了两遍**」完全吻合——第一遍真正完成了 bump/commit/tag/push；第二遍读到的已是 bump 后的版本，于是 preflight 报"版本必须高于当前"。成因未定位（怀疑与命令包装层 `rtk` 代理或 PowerShell 管道组合有关），**注意这不是脚本 dry-run 的问题**：`scripts/release.cjs` 的 `--dry-run` 分支均有 `return`，经实测复核语义正确（零写入，版本与工作区均不变）。
- **解法（应对方式，非根因修复）**：发版、提交、推送这类关键操作**不要以 stdout / 退出码为准**，一律改用客观状态回验，例如：
  ```powershell
  git log --oneline -3
  git rev-parse v<version>            # 本地 tag 指向
  git ls-remote origin refs/heads/main # 远程 main 指向
  git status --porcelain               # 工作区是否干净
  ```
  本次即靠这组命令确认"报错但已成功"，避免了重复发版（重复发版会撞"版本必须高于当前"或产生空提交）。
- **复盘要点**：
  1. 与本仓坑 44（`git push` 报凭据错但推送已成功）**同族**：沙箱与命令包装层会篡改命令的**表面结果**，退出码与 stdout 都不可作为唯一判据。
  2. 关键操作后**先回验状态、再决定是否重试**；盲目重试可能造成空提交、版本号跳号或 tag 冲突。
  3. 报错信息要结合上下文读：`目标版本 X 必须高于当前版本 X`（两者相同）本身就是"已被前一遍改过"的强信号。

## 坑 50：安装版「检查更新」失败原因完全不可见 —— 渠道名不匹配 × github.com 不可达 × 零诊断面三因叠加

- **现象**：v0.1.1-alpha.6 安装版点设置 → 关于 → 「检查更新」提示「检查更新失败，请稍后重试」，且**无论切「正式」还是「预发布」都一样失败**。安装版从资源管理器启动无控制台，终端日志取不到；界面只显示硬编码文案，`status.error` 原文仅在 DevTools 可见 —— 排查耗了两轮对话才定位。
- **根因**（三个独立问题叠加，不是单一"网络不通"）：
  1. **渠道名与 tag 命名段不匹配（预发布渠道必然失败）**：`CHANNEL_FEED.rc = 'rc'` 原样传给 electron-updater；GitHub provider 判定某条 release 属哪个渠道是**从版本号的预发布段取名**（`v0.1.1-alpha.7` → `alpha`），与 GitHub 页面的 pre-release 复选框无关。仓库全部 tag 都是 `-alpha.N`、无 `-rc.N` → 匹配循环走完 `tag` 仍为 null → **在请求任何 yml 之前**即抛 `No published versions on GitHub`（`electron-updater/out/providers/GitHubProvider.js:110-112`）。「正式」传 null，退化为用**当前安装版本自身**的预发布段（`alpha`）匹配，命中 alpha.7 后走 `alpha.yml` 404 → 回退 `latest.yml` 的兜底链成功 —— 即「正式」能用属**歪打正着**。
  2. **本机到 `github.com` 不可达（本次真正主因，也是两渠道共同失败的原因）**：实测 `github.com:443` TCP 连接失败、`releases.atom` / `raw.githubusercontent.com` / `release-assets.githubusercontent.com` 全部超时，而 `api.github.com`（3s）与 `lansi-ai.github.io`（1s）正常 —— 属 **IP 级选择性阻断**。GitHub provider 第一步就取 `{repo}/releases.atom`（上游注释明确"不用 API 是为绕开限流"），此域不通则渠道匹配与 yml 请求都没机会执行。
  3. **失败原因零留痕（诊断面缺失）**：`auto-updater.ts` 的 error 分支只调 `log.error`（stdout/stderr），安装版无控制台即丢失；错误原文虽在 `state.error` 并经 `app-update:status` 下行，但 `desktop-about-client.js` 在 `phase === 'error'` 时只渲染硬编码文案，从不显示 `status.error`；且状态变更走 `sendDesktopEvent` 不落审计，`audit.jsonl` 里只有 `config.write` 的渠道切换记录。
  - 附带发现一处状态缺陷：`error` 字段**从不重置**（`checking` / `not-available` 均不清），一旦 UI 开始显示原文就会显示上一次的陈旧原因。
- **解法**（本次仅修第 3 条；第 1、2 条待决策）：
  - `setState` 增审计落盘：`AUDIT_PHASES` 白名单（checking / available / not-available / downloaded / error）+ 相位变化判定（`error` 每次必写），`downloading` 进度帧被拦截 —— 否则一次 138MB 下载会往 `audit.jsonl` 灌上百条。载荷含 `phase / currentVersion / channel / newVersion / error / errorStack`，文本字段按 2000 字符截断（`truncateForAudit`，防 `ERR_UPDATER_INVALID_RELEASE_FEED` 整段 `feedXml` 撑爆单条 JSONL）。**零 schema 变更**：`desktopEventSchema.payload` 与 `desktopActionEventSchema.payload` 本就是 `z.unknown().optional()`，未碰 `src/types/`。
  - 错误堆栈经局部变量 `lastErrorStack` 捕获、仅在 error 相位写入审计，**不进 `UpdaterState`**（不扩大下行状态面）。
  - 关于页 error 相位补一行等宽小字显示 `status.error` 原文（可见 200 字符 / `title` 上限 2000 字符），主文案保留不动（长错误串会破坏行布局）。
  - `checking` 事件顺手清 `error` 与堆栈，消除陈旧原因。
  - **未修**：① 渠道命名（方案 A 把 `rc` 映射为 `alpha`；方案 B 让发布真正产出 `-rc.N` tag + `rc.yml`）；② 更新源去 `github.com` 依赖。Gitee 侧已实测：`releases/download/{tag}/…` 匿名可读（302 → `foruda.gitee.com` 签名直链，1.4MB/s），但**无 `releases.atom`**（404）故必须改用 generic provider，且 generic **无 `alpha.yml`→`latest.yml` 兜底**；raw 小文件匿名可读、可作 `latest.yml` 固定宿主（免 Gitee Pages 实名）；单文件上限 100MB（另有 300MB 之说）与 132MB 产物**踩线**，是上传前的 go/no-go。
- **验证（2026-09-10 实机 · win-unpacked）**：审计精确落盘 `checking` / `error` 各 3 条（含 `channel`，**零 `downloading`**）；真因捕获为 **`net::ERR_CONNECTION_RESET`**，栈含 `SimpleURLLoaderWrapper`（实证走 Chromium 网络栈 → 系统代理生效，同时反证早期"开系统代理没用"的判断有误）；关于页成功显示该原文；`checking` 记录中无 `error` 字段（证明重置生效）。附带发现：阻断环境下手动检查**挂起约 24 秒**（12:49:33 → 12:49:57）期间 UI 仅「检查中…」，属独立 UX 缺口，已登记待办。本地打包验证另踩坑 51（`--dir` 不生成 `app-update.yml`）。
- **复盘要点**：
  1. 「同一个 UI 动作失败」要**分渠道维度与网络维度分别取证** —— 本次「两个渠道都失败」正是把它俩区分开的关键信号，别把独立故障当一个。
  2. electron-updater 的「渠道」是**从版本号预发布段推出的字符串**，不是 GitHub 的 pre-release 复选框；自建渠道体系必须让 **tag 命名 / `CHANNEL_FEED` / 发布产物文件名三者同源**。
  3. 打包应用的**终端日志等于没有日志**。面向用户的失败路径必须同时具备「可展示 + 可落盘」两条出口，否则诊断成本会外化成多轮往返。
  4. 加"显示错误原文"这类可观测性改动时，要顺手检查**错误字段本身是否会被重置** —— 陈旧值会被新 UI 放大成误导。
  5. 排障先测**分层可达性**（DNS → TCP → 具体端点）再看业务代码；本次判据是 `github.com:443` 不通而 `api.github.com` 通，一步排除"网络全断"误判。

## 坑 51：`electron-builder --dir` 不生成 `app-update.yml` —— 本地打包验证时 updater 必然 ENOENT

- **现象**：为验证"更新失败诊断面"，用 `npm run build ; npx electron-builder --win --dir` 只产 `release/win-unpacked` 目录（刻意避开 `npm run dist` 的同版本号旧包陷阱），启动后点「检查更新」（或等 20s 静默检查）即报：
  ```
  [dsh-updater] Error: ENOENT: no such file or directory,
    open 'E:\Projects\DSH\desktop\release\win-unpacked\resources\app-update.yml'
  ```
  同一份代码 `npm run dist` 打出的安装版内该文件存在、链路正常。
- **根因**：`app-update.yml` 不是"打包就有"的产物，而是 **`PublishManager` 在 `onAfterPack` 钩子里按 target 类型条件写入**的：
  - `app-builder-lib/out/publish/PublishManager.js` 的 `packager.onAfterPack` 中，Windows 分支有一道守卫：
    ```js
    else if (packager.platform === Platform.WINDOWS) {
      if (!event.targets.some(it => isSuitableWindowsTarget(it))) return
    }
    ```
  - 同文件 `isSuitableWindowsTarget(target)` **仅认 `nsis` / `nsis-*`**（以及开启 `electronUpdaterAware` 的 `appx`）。`--dir` 模式不含任何这类 target → `some(...)` 为 false → 提前 `return`，`app-update.yml` 从不写入。
  - 而 `electron-updater` 的 `AppUpdater` 在 `app.isPackaged` 为真时**首次检查必读该文件**，缺件即 `ENOENT`。注意这是"已打包但缺件"的新分支：`auto-updater.ts` 的 `isDisabled()` 守卫只覆盖 `!app.isPackaged`，不覆盖此情形（该守卫的注释本意正是"避免读取缺失的 app-update.yml 抛错"，覆盖面有缺口）。
- **解法**（不需重新打包）：
  ```powershell
  Copy-Item "$env:LOCALAPPDATA\Programs\dsh-forge\resources\app-update.yml" `
            'release\win-unpacked\resources\app-update.yml'
  ```
  文件内容即 publish 段序列化：
  ```yaml
  owner: lansi-ai
  repo: dsh-forge
  provider: github
  updaterCacheDirName: dsh-forge-updater
  ```
  ⚠️ **补完必须重启 app**：`AppUpdater` 对该文件的读取是 memoize 的，首次失败的读取会被缓存，不重启不会重读。
  选型取舍：`--dir` 只产 unpacked 目录（无安装包、不覆写 `release/SHA256SUMS`、不与 CI 已发布的同版本号包混淆，即 M4-a3「新旧混放同版本号」陷阱）；`npm run dist` 能顺带生成 `app-update.yml`，代价是产出同名安装包并覆写校验文件。本地验证推荐 **`--dir` + 手工补 yml** 的组合。
- **复盘要点**：
  1. `app.isPackaged === true` **不等于**自动更新可用：还需 `resources/app-update.yml` 存在，而它的生成取决于"发布配置 + 特定 target"，与"打包"本身无关。
  2. 用裁剪参数（`--dir` / 指定单一 target）做本地验证时，要主动核对 electron-builder 因 **target 守卫而跳过的全部产物**，别默认"打包成功 = 产物齐全"。
  3. 这类"环境缺件"失败**不是静默降级而是每次检查都抛错**，若无诊断面极易被误判成代码 bug —— 本次能一眼定位，正是因为坑 50 的审计与 UI 显示刚落地（P0 的直接收益）。

## 坑 51 附记：`isDisabled()` 的覆盖面缺口（未修，登记待决策）

`auto-updater.ts` 的禁用判据 `isDisabled() = !app.isPackaged || channel === 'off'` 未覆盖「已打包但 `app-update.yml` 缺失/损坏」这一态：真实安装版由 CI 的 nsis 构建保证该文件存在，但 `--dir` 构建、安装损坏、或将来改用 `--dir` 分发便携版时会稳定踩到。可选加固（本次未做）：初始化前探测 `resources/app-update.yml` 是否存在，缺件则降级为禁用句柄并在关于页/审计给出可读提示，而非让每次检查都抛 `ENOENT`。

## 坑 52：手动「检查更新」的结果没有任何用户可见反馈 —— 托盘入口更是全程无感

- **现象**：从**托盘菜单**点「检查更新…」，托盘项只显示「正在检查更新…」，随后**静默恢复**成「检查更新…」，客户端任何位置都不出现结果；用户在 15 秒内连点 3 次（以为没生效）。终端与审计其实都正常：`[dsh-updater] 正在检查更新…` → `[dsh-updater] 已是最新版本 (v0.1.1-alpha.7)`，审计 `app-update:status` 落 `checking` / `not-available` 各 3 条 —— **主进程链路健康，缺口全在用户可见面**。关于页开着时也只有底部状态行文案变成「已是最新版本」。
- **根因**（三处叠加）：
  1. `auto-updater.ts` 的 `notify()` **只在 `update-downloaded` 一个 handler 里被调用**；`update-not-available` 与 `error` 全程静默，不产生任何用户可见反馈。
  2. `desktop-tray.ts` 的更新菜单项只有「检查更新…」/「正在检查更新…」两态，**没有结果态**，检查结束即恢复原样。
  3. 主进程**不区分「手动检查」与「静默自检」**：`check()` 与 `initialize()` 的延迟自检走同一条路径，因此即便想补反馈也无法只对前者生效（而启动自检每次都弹提示会很吵）。
- **解法**：
  - `check()` 拆为 `checkInternal(manual)`：用户入口（关于页按钮 / 托盘菜单）走 `manual=true`；启动延迟自检、渠道切换联动、自动检查开关联动一律 `manual=false`。用 `lastCheckManual` 记录本次检查来源。
  - 手动检查的终态补可见反馈：`update-not-available` / `error` 经 `notifyResult()` 发系统通知，**仅当主窗口未聚焦**（窗口在前台时页内提示已足够，再弹是重复打扰）；通知体取错误**首行摘要**（≤160 字符），完整原文仍在关于页与 `audit.jsonl`。
  - `manual` 随 `app-update:status` 事件下行（payload 契约本就是 `z.unknown().optional()`，**无破坏性变更**）；关于页据此只对用户手动发起的检查弹一条 **6 秒结果提示**（成功绿 / 失败琥珀），定时器由 `useEffect` 清理。
  - 托盘菜单仍不加瞬态结果项（系统通知已覆盖该场景），保持菜单刷新逻辑简单。
  - 审计载荷同步补 `manual` 字段，事后可区分「用户点的」与「自动跑的」。
- **复盘要点**：
  1. **用户主动触发的操作，结果必须落在用户看得见的地方**。把结果只写进"下次打开某个页面才可能看到"的状态，等于没反馈。
  2. 一个服务方法被多种来源共用（页面按钮 / 托盘菜单 / 定时器）时，必须携带**来源语义**，否则"该出声的"与"该安静的"无法分流。
  3. 通知策略要按**焦点状态**去重：窗口在前台时页内提示已足够，再弹系统通知就是噪音；窗口在后台时通知才是唯一出口。
  4. 排查"没有反馈"类问题，先列 **入口 × 可见面** 矩阵 —— 缺口往往落在组合的交叉格里（本次是「托盘入口 × 未打开关于页」）。

## 坑 53：宿主平面 roster 未对齐官方 web profile 的关停表 → 极简模式照样带着整套工具目录，每轮白烧数千 token

- **现象**：同一台机器、同一个 `$DSH_HOME`、同一个模型（`deepseek-official/deepseek-v4-flash`），官方客户端极简模式一轮「本轮用量」≈ 400 tok，DSH Forge 桌面客户端极简模式一轮却报 **6,264 tok**（未缓存 240 + 缓存读取 6,016 + 输出 8，缓存命中 96.2%）。用户体感"都是极简模式，为什么我的客户端这么贵"。归档证据：`$DSH_HOME/storages/session_projcache/sessions/*.json` 里 `agentPreset = minimal` 而 `contextBreakdown.toolsTokens` 与真实 `tokenUsage` 相差一个量级；同一批会话中 `standard` 的 `toolsTokens = 6905`，而官方极简应为**一个持久 shell 工具（约 195 tok）**。
- **根因**（五层叠加）：
  1. `@deepseek-ai/dsh-base/cordis.patch.yml` 是**宿主平面**官方 roster，把模型可见能力全部注册在 root context：`tool-pwsh` / `tool-fs` / `tool-fs-search` / `tool-jobs` / `tool-skill` / `skill-filesystem` / `tool-goal` / `tool-todo` / `tool-ralph` / `tool-web` / `tool-subagent`(×4) / `tool-workflow` / `workflow-worker-thread` / `agent-instructions` / `plan-mode` / `compaction-basic` / `command-compact` / `tool-result-pruner`。
  2. 官方 web profile（`@deepseek-ai/dsh-web-app/cordis.patch.yml`）**逐行 `disabled: true` 把它们摘掉**，改由 agent 预设的 `agent.cordis.yml` 各自声明（四个 shipped 预设 standard / ptc / cordis / minimal 都自带完整工具行）。桌面 `boot.ts` + `desktop-patch.yml` 当初只对齐了 web **传输层**（webserver / web-runtime / modules / client-* ),这 23 行**一条没关**。
  3. 语义依据：`dsh-tools` 的 `view(scope)` = **全局层 + scope 链**（`ScopedLayers.chainLayers` + `this.layers.global.tools.entries()`）。预设注册只能影子遮蔽**同名**工具，**挡不住全局层里的其它工具**；全局层不带 scope，对所有 agent（含极简）可见。
  4. 极简预设把 persona 标 `complete: true` **只裁「提示词文本段落」**——`dsh-system-prompt` 里 `sections` 塌缩成 `[completeSection]`，但 `assembly.tools` 照旧 `orderTools()` 收集 → 工具目录不受 `complete` 影响，这正是它能穿透"极简"的机制缝隙。
  5. 同理 `agent-instructions`（`maxBytes: 65536`）也是全局注入，极简模式本不该带工作区指令文件。
- **解法**：
  - `boot.ts` 新增 **§3b**（`desktop-patch.yml` 同步为参考文档）：照官方 web profile 的关停表逐行 `{ id, disabled: true }`，共 24 行 = 官方 23 行 + 桌面遗留 `tool-str-replace-editor`（官方 base / web / 四个 shipped 预设均无此工具，属 rc.x 时代残留）。四个预设自带工具行，故能力零损失。
  - 删除仓库自带的裁剪预设 `resources/agent-presets/standard/`：`includeShippedRoot` 默认 `true`、shipped 根排在 `config.roots` **之前**、且「同名 id 前一个根赢」→ 这份与官方同名的副本**从未生效**（运行时一直是官方 standard），只会制造"以为在跑自有预设"的错觉。预设来源从此 = shipped 根 + `$DSH_HOME/.agent-presets`（用户根），与官方一致；桌面自有扩展根（`dist/resources/agent-presets`，默认空目录）保留，`scanRoot` ENOENT → `[]` 属官方合法部署态。
  - `main.ts` 3.5 步「扫描为空」报错文案由 `dist/resources/agent-presets` 改指 shipped 根，避免误导排查方向。
  - 新增 §7.3 拴合面行：上游升级时必须重跑官方两份 patch 的 diff，同步增删本清单（漏对齐不报错、只烧 token）。
- **复盘要点**：
  1. **抄官方 roster 必须连它所在 profile 的关停表一起抄**：官方结构是「base insert + 本 profile 的 disabled 覆盖」；只抄 insert 等于把官方已下线的能力全留在宿主平面。
  2. **注册表类服务的作用域可见性是「并集」不是「覆盖」**：预设声明只管自己，判"某预设实际看到什么"要按 `view(scope) = global + 链` 推，不能按"预设声明了哪些"推。
  3. **判据要双读**：本地 `contextBreakdown`（估算）vs 模型侧 `tokenUsage`（真实），差一个量级即泄漏信号；缓存命中率高只代表"便宜"，不代表"小"。
  4. **同名资源 id 的遮蔽是静默的**：`dsh-agent-presets` root 顺序（shipped → config.roots → user）+ "前一个根赢"会让仓库自带同名副本变死代码——"改了没生效"先查优先级，再查代码。
- **实机验证**：2026-09-10 用户确认通过（极简模式「本轮用量」回落、标准模式能力不回归）。

## 坑 54：全局图标目录「只增不改」——随包品牌资源（应用/托盘图标）更新永远到不了存量安装

- **现象**：应用图标与托盘图标由「透明底金标」改为「黑底圆角实底 + 金标」（用户指定），脚本、资源、宿主代码全部改完且 `npm run build` 通过，**本机启动后图标照旧**。运行期真源 `$DSH_HOME/icons`（本例 `E:\Projects\DSHPath\icons`）里 4 个文件仍在，ready 阶段的 `migratePackIconsToGlobal()` 只做「全局缺失才从包根复制」，已有文件一律跳过 → 新图标永远进不来。哈希对照更进一步：运行期这 4 个文件与 `HEAD` 里的随包资源**也不相同**（早期本地生成与提交时机错位），即「存量的来源已不可追溯」。
- **根因**：`migratePackIconsToGlobal()` 的唯一判据是 `existsSync`。全局目录被当成"用户真源"（动机正确：用户自己上传的图标不能被覆盖），但代码里**没有任何手段区分「随包资源」与「用户自定义」** → 任何随包品牌变更都被收敛成"第一次装上以后永不更新"。附带问题：该函数的源顺序是「激活包优先、其余包次之」，而品牌其实与激活包无关（D-23 之后全局图标与图标包解耦），非 default 包残留的历史 app/tray PNG 会被误当品牌源。
- **解法**：引入**品牌资产修订号**——`BRAND_REVISION`（形态每次变化递增）+ 全局目录内 `.brand-revision.json`（记录修订号 + 各文件写入时的 sha256）；`syncGlobalBrandAssets()` 取代 `migratePackIconsToGlobal()`：
  - 修订号一致 → 直接返回（常规启动零额外 IO）；
  - 修订号变化 → 逐文件判定：全局缺失，**或**内容等于上次随包写入的哈希（含无标记的存量安装）→ 覆盖为新版；内容已被用户改过 → 保留并在日志列出被保留的文件名；
  - 真源由「激活包根」改为**内置 web 目录**（`resolveDefaultIconPath` → `dist/desktop-shell/web/`），品牌与激活包彻底解耦；写入完成后落盘新修订号 + 哈希表（落盘失败只告警，下次启动重试）。
- **复盘要点**：
  1. **「用户可自定义的目录」+「随产品迭代的资源」共存时，必须有来源标记**（修订号 / 内容哈希），否则只能在"永不更新"与"每次覆盖用户自定义"两个坏选项里二选一。
  2. 判据只有 `existsSync` 的"迁移"函数，其真实语义是**一次性种子**，不能当"同步"用；文件名里写 migrate 也别信。
  3. **存量安装的现状文件可能不等于任何一次随包资源**（本地生成/提交时机错位）→ 设计刷新策略时按「未知来源 = 可刷新」处理，但要把刷新/保留的数量与文件名写进日志，事后可追溯。
  4. 资源类改动验效要**读运行期真源目录**（`$DSH_HOME/icons` 的文件 + 哈希），只看仓库里资源已更新等于没验证。
  5. 品牌类资源改动的效力边界要分清：任务栏/窗口/托盘/Dock 图标运行时读全局目录（重启即变），**桌面快捷方式与安装包图标**取自 electron-builder 的 `icon:` 源图（需重新打包/安装）。

## 坑 55：agent 预设的「静态 inject」是宿主 roster 的硬门禁 —— `cordis-host-runner` 从未插入，创造模式必然挂载失败

- **现象**：切到「创造模式」（agent 预设 `cordis`）报
  `preset "cordis" failed to mount: 1 row(s) did not activate: tool-cordis (@deepseek-ai/dsh-tool-cordis): waiting for dynamicCordisRunner, cordisInspect`，
  预设整块挂不上（该模式不可用），而 `standard`/`minimal` 等预设正常。
- **根因**（两层）：
  1. 预设最后一行 `tool-cordis` 静态 `inject: [dynamicCordisRunner, cordisInspect]`；这两个服务由官方 `@deepseek-ai/dsh-cordis-host-runner` 提供，而桌面 `boot.ts` **从未 insert 这一行** —— 记录的只有 §3 里一条 `{ id: 'cordis-host-runner', disabled: true }`。该条目其实是**空操作**：dsh-base 的 roster 里根本没有这一行（对照 `node_modules/@deepseek-ai/dsh-base/cordis.patch.yml`，`rg 'cordis-host-runner'` 零命中），非 insert 补丁只按 id 覆盖已存在条目。
  2. 配套的浏览器两半（`dsh-cordis-client-runner`、`dsh-client-ui-cordis`）被列入 `CLIENT_EXCLUDE_IDS`（2026-09-01 因宿主半缺席致 `syncInspectManifest` 404 刷屏而清噪）→ 即使宿主半回来，没有面板也无人能审批带浏览器半的包。
- **解法**（对齐官方 web profile：`dsh-web-app/cordis.patch.yml` 第 122 行 host insert + 客户端两半在 browser roster）：
  - `boot.ts` §1 insert `cordis-host-runner`（它自身只 `inject: ['tools']`，而 `tools` 服务行早已在 §1）；§3 删掉两条空操作禁用项。
  - `boot-graph.ts` 回填两个 client 半；`cordis-inventory.ts` 退役 `dynamicCordisRunner/inventory` 兼容注册（unary 表优先于 apiProxy，继续注册会遮蔽官方实现），只留自研设置页用的 `pluginInventory/list`。
  - 自绘侧栏补声明并渲染 `sidebar.footer.action`（`list`/`root`，官方 ui-sidebar 同款）→ ui-cordis 的面板入口有落点（缺声明会走「上游自建槽位」路径，坑 48 同款）。
  - 安全口径登记 `docs/08-security.md` §4：动态包 ≈ bash 访问，`node:vm` 非安全边界，带浏览器半的包需页面审批。
- **复盘要点**：
  1. **「禁用一条不存在的行」是空操作**：非 insert 补丁（`{ id, disabled }`）只覆盖已存在条目，若服务的**提供行从未插入**，写多少条 `disabled: true` 都只是文档；判「某服务为什么缺席」的正确顺序 = 报错里的服务名 → 找提供它的官方包 → 回 roster 查**有没有 insert 行**（不是查有没有 disabled 行）。
  2. **agent 预设的 `inject` 是宿主平面的硬契约**：预设行声明了服务就要求宿主提供，缺一个服务 = 整个预设 mount 失败（`N row(s) did not activate`），报错行点名「等待的服务」是最直接的定位线索；新增/裁剪宿主 roster 时要按「官方 profile 提供了什么」做全集对账（坑 53 的姊妹规则：那边是「多抄了会渗进所有预设」，这边是「少抄了预设挂不上」）。
  3. **清噪式的排除会留下运行期债**：当年为消 404 把 client 半整体移出图谱是对的（当时宿主半确实不存在），但必须把「谁依赖谁、恢复条件是什么」写进台账——本次即靠这条线索一次性把三处（host insert / client 回填 / 面板槽位）配齐；恢复时**三处必须同批**，只回填一半会出现「工具能跑但审批页不存在，带浏览器半的包永久挂起」这种更难查的态。
  4. **历史理由要复核**：文档里「零端口架构冲突」的说法经复核不成立（runner 是进程内 vm，不监听端口）。判断一条架构性禁用理由是否仍有效，看**该行实际占用了什么外部资源**（端口/路径/全局单例），不要只看当年的结论词。
