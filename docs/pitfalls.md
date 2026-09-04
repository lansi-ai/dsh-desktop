# 实战踩坑记录（Pitfalls · 2026-08-26 攻坚第 2 批）

> 本文件记录 M1 攻坚「官方 UI 完成日常对话全流程」过程中实际踩到的坑与解法。
> 目的：**可复用的排障手册**，避免后续会话重复踩坑。
> 每个坑都标注：现象 → 根因 → 修复 → 复盘要点。

## 坑 0 · TRAE 沙箱拦截 Electron 启动（环境，非代码）

- **现象**：`npm run dev` 启动即报
  `TRAE Sandbox Error: Not allow operate files: ...\SogouPY\LOG\IME\electron_*.log`，且 `Start-Process` 拉独立 PowerShell 报 `0x800700e8 (ERROR_NO_TOKEN)`。
  同类实例（2026-09-01，版本号显示任务验证启动时）：报 `Not allow operate files: ...\Tencent\WeType\MM_TIP_*.xlog, ...\spool\drivers\color\sRGB Color Space Profile.icm`——**微信输入法（WeType）写自家 `.xlog` + Chromium 读系统色彩配置也各自触发同一拦截**。
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

## 结论

攻坚第 2 批（官方 UI 完成日常对话全流程）在剔除 client-connection 抢占 connection、修 RPC 入口、扩自动扫描图谱、换 Electron 目录选择器、补 settings 注册后**实机验收通过**：官方 UI 成功渲染 + 工作区选择 + 日常对话全流程打通。
