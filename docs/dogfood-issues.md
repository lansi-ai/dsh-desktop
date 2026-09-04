# Dogfood 问题清单（M3-b4 · 跨会话移交台账）

> **用途**：dogfood 期间发现的问题在此登记，新会话（新窗口）只需提示「按 dogfood-issues.md #N 处理」，AI 直接从「现象 + 第一现场 + 排障判据」起跑，免重新摸排。
> **状态流转**：`open → fixing → fixed → verified`；verified 后在条目标注对应坑号（pitfalls.md）归档。
> **配套**（2026-08-27 · D-17）：dogfood 小 bug 的坑档/看板落盘可按日批次合并，但**本台账必须即时登记**——它是跨会话唯一移交锚点。

## 新问题登记模板（4 行即可）

```markdown
### #N · <一句话现象>
- 环境：dev（npm run dev）/ 打包版（release/...exe）/ 两者
- 第一现场：终端关键日志行（[dsh-bridge] / [dsh-boot] / [renderer-ERROR] 标签）或 DevTools Console 红错文本
- 状态：open
```

登记纪律：**修 bug 前先登记**（哪怕一句话），修完改状态并补坑号；「第一现场」字段优先贴终端原文而非转述。

## 问题台账

### #1 · 点「新会话」无反应 + 旧会话 `skill.list` 报 `not attached`

- 环境：dev（npm run dev）

- 第一现场：无网络请求（请求未离开 renderer）；`session.list` 正常含该会话

- 状态：**verified**（2026-08-27）→ 坑 11

- 修复：`session-rewarm.ts` 启动期重挂载（冷会话走 `session.create {sessionId, cwd}`）；附带 `commands/list` 404 → typertGateway fallback（坑 12）

### #2 · 设置页「Agent 预设」入口可见，点进去纯空白

- 环境：dev（npm run dev）

- 第一现场：无 RPC 失败日志；加探针后 `[dsh-boot] Agent 预设服务未装载（agentPresets undefined）`

- 状态：**verified**（2026-08-27）→ 坑 16

- 修复：boot.ts §4 `agent-presets` 并入 insert 数组（非 insert 补丁对空根配置是静默 no-op）；main.ts 常驻启动期预设扫描探针（三态必显）

### #3 · 主题联动后任务栏图标不换（标题栏/托盘正常）

- 环境：dev（npm run dev）

- 第一现场：标题栏与托盘图标已随主题切换黑白双版，任务栏图标无变化；`[dsh-theme]` 日志正常

- 状态：**fixing**（2026-08-27）

- 初判根因：dev 模式下 `app.setAppUserModelId('deepseek-harness.desktop')` 生效，但系统里不存在携带该 AUMID 的快捷方式（打包版才由 NSIS 安装），Windows 任务栏回退显示宿主 exe（electron.exe）的 Electron 图标，忽略窗口图标

### #4 · 启动期 `[dsh-theme]` / `[session-rewarm]` 报 `api 调用失败: HTTP 404`

- 环境：打包版（`npm run start`，dist/desktop-shell/main.js）

- 第一现场：

  ```
  [dsh-theme] 读取 ui-theme 偏好失败，保持默认跟随 OS: Error: api 调用失败: HTTP 404
      at unpackServerResponse (dist/desktop-shell/main.js:265)
      at callApi (dist/desktop-shell/main.js:287)
      at async readThemePreference (dist/desktop-host/theme-sync.js:32)
      ...
  [session-rewarm] 预热中断（不影响启动）: api 调用失败: HTTP 404
  ```

- 状态：**verified**（2026-09-01）→ 坑 24

- 修复：根因非启动时序，而是自研启动 unary 未对齐 0.1.2 官方 /api wire 契约：① 端点须斜杠 `domain/method`（`settings.describe` 点分被判 false → 404），② payload 须恰好一个 `args` 字段 `{args}`（裸 params 被拒 arguments-invalid），③ `args` 内字段名匹配端点签名参数（`session.list`→`_request`、`session.create`→`request`）。`callApi` 统一入口做点分→斜杠 + 裸 params 幂等补包 `{args}`；session-rewarm 按签名参数名传参。theme 与 rewarm 共用修复，启动日志已净。

### #5 · 终端启动噪音：`/plugins/events` 404 + `syncInspectManifest` 404 + `console-message` deprecation + CSP 警告

- 环境：打包版（`npm run start`，dist/desktop-shell/main.js）+ dev

- 第一现场：（0.1.2 升级后）启动即刷 4 类噪音：

  ```
  [dsh-ui-protocol] 404 dsh-ui://app/plugins/events (ENOENT: ...plugins/events)
  [dsh-bridge] RPC 失败 (dynamicCordisRunner/syncInspectManifest): Error: api 调用失败: HTTP 404
  [renderer-ERROR] [cordis-client-runner] syncing inspect providers failed: ... HTTP 404
  (electron) 'console-message' arguments are deprecated ...
  [renderer-WARN] Electron Security Warning (Insecure Content-Security-Policy) ...
  ```

- 状态：**verified**（2026-09-01）→ 坑 25

- 修复：

  - `/plugins/events` 404 = `dsh-client-hmr` 客户端半仍入渲染图谱，轮询桌面不存在的 dev SSE 通道 → 加入 `CLIENT_EXCLUDE_IDS`

  - `syncInspectManifest` 404 (renderer) = `dsh-cordis-client-runner`（动态双半插件子系统）对端 host runner 已禁用，激活即 404 → 连同其面板 `dsh-client-ui-cordis` 一并移出图谱（用户决策「整体排除」；插件清单仍经 cordis-inventory 兼容面在设置页查看）

  - `console-message` deprecation = 主进程/窗口管理器用了旧多参回调 → 改现代 `Event<WebContentsConsoleMessageEventParams>` 单对象签名

  - CSP 安全警告 = 官方 dist 无 CSP 的 dev 提示（打包不出现）→ 转发层按 "Electron Security Warning" 消息过滤

  - 宿主侧 `boot.ts` §3 本就禁用 client-hmr/cordis-client-runner/cordis-host-runner，此修复补齐渲染端排除。

### #6 · 会话头部「Session 日志」导出报 `Export failed: HTTP 403 forbidden`

- 环境：dev + 打包版（0.1.2 载波形态）

- 第一现场：官方导出弹窗错误 `Export failed: HTTP 403 forbidden`；协议层日志 `[dsh-ui-protocol] 403 dsh-ui://app/api/session.export?... (越界)` 同源出现（HEAD 探测请求）；无 RPC 失败日志

- 状态：**fixed**（2026-09-02）

- 根因：官方 `dsh-session-log-export` client 半用**浏览器原生 fetch**（非 `__DSH_TRANSPORT__`）请求同源 `dsh-ui://app/api/session.export`（HEAD 探测 + anchor 下载）。请求落 `dsh-ui://` 协议层 → `matchesCompatRoute('/api/...')` 命中官方 host 半 `dsh-client-connection` 装配时注册在 webServer 等价面的 `/api` **前缀**路由 → 该路由首行 Host/Origin 信任围栏（`isTrustedApiRequest`，`trustedHosts=[]`）判 false → 403 'forbidden'。桌面零端口下浏览器层 GET/HEAD `/api/*` 无人认领（POST unary 走 IPC 载波）

- 修复（两层）：

  - ① 协议层 connection fetch 桥：非 POST 且 `/api/` 前缀的请求转发到 host `connection.createSharedFetchHandler('/api')`（`src/desktop-host/connection-fetch-bridge.ts` + `main.ts` 载波桥接处安装 + `dsh-ui-protocol.ts` 转发），不经 compat 信任围栏（桌面信任模型 = preload 白名单 + IPC 载波）。修复后 403 → 404，暴露第二层缺口

  - ② host 树补装 `session-log-download` 行（`boot.ts` §1，对齐官方 web-app cordis.patch.yml insert）：桌面 overlay 补丁栈系手工策展，官方 web-app 补丁的该行从未插入 → `/api/session.export` 精确 fetch 路由从未注册 → 共享处理器查表 404。inject \['commands','connection'] 与导出依赖（sessionQuery/sessionPersistence/attachments）均已在前

### #7 · renderer 全部 RPC/流报 `No handler registered`（应用活着但载波桥已拆）

- 环境：dev（npm run dev · M4-a4 首启窗口首次实机验证）

- 第一现场：`启动失败: AppError: 快捷键注册失败: Alt+Shift+Q`（desktop-shortcuts.ts）→ 随后主进程刷 `Error occurred in handler for 'dsh:rpc': No handler registered`（dsh:stream-open 同）+ `[renderer] [session-controller] control stream failed`；主窗口渲染正常但载波全断

- 状态：**fixed**（2026-09-02 · 真因两层 + 一处加固）

- 根因（最终定位，初判「首启窗口 window-all-closed 竞态」系误判）：

  1. **快捷键失败致命化**：预置 `Alt+Shift+Q` 被系统其他应用占用（`globalShortcut.register` 返回 false）→ `installDesktopShortcuts` 抛 AppError → bootstrap catch → `app.quit()`。全局热键是增强能力，不该致命
  2. **退出被托盘拦截中止**：`before-quit` 拆完 IPC 桥 → Electron 关主窗口 → 托盘「关窗驻留」拦截 close（`quitting` 标志未置位）→ `preventDefault + hide` → 退出中止 → 应用残留成「活着但 IPC 桥已卸」的僵尸态，renderer 全部报 No handler registered

- 修复（三层）：

  1. `desktop-shortcuts.ts`：预置快捷键注册失败降级为告警继续（逐个 try/catch，成功者照常注册 + 审计 `shortcut.register-failed`），不再打断 bootstrap
  2. `main.ts` `before-quit` 第一动作 `markQuitting()`：解除托盘 close 拦截，保证任何 app.quit() 路径（启动失败/托盘退出/系统关机）清理后必能真正退出
  3. `main.ts` `bootstrapCompleted` 守卫：bootstrap 完成前忽略 `window-all-closed`（首启数据目录窗口销毁 → 闪屏/主窗口创建是正常时序；加固，防同类窗口数量竞态）

### #8 · 设置页「外观」浅色主题不可读 + 图标包卡片横向溢出面板

- 环境：dev（`npm run dev` · 浅色配色主题）

- 第一现场：无任何控制台/RPC 报错，纯渲染问题（用户截图：section 标题「外观/图标包」发白近不可见；图标包卡片排成一长条冲出面板右边界，上传图标最多的 custom 包溢出最严重）

- 状态：**fixed**（2026-09-04 · 待实机点验）→ 坑 27

- 根因（三处独立）：① 样式全内联硬编码深色值（`#f8fafc`/`rgba(255,255,255,.08)`），不随明暗；② grid 卡片缺 `min-width:0` → 卡内 4 列预览（带 `nowrap` 文件名标签）的 min-content ≈338px 反顶 `minmax(180px,1fr)` 轨道，3 列 ≈1034px 撑破 ≈564px 内容区；③ section 自带 `padding:16px 24px` 与外壳 `.dss-options` padding 叠加

- 修复（`desktop-theme-client.js` V2 重构，用户选定「精简卡片网格」版式）：样式表 token 化（`--dsw-*`，明暗自适应）+ 三层防溢出（卡片 `min-width:0` / 内层 `minmax(0,1fr)` / 缩略图去文本标签进 `title`）；每卡只留「代表图标 4 枚 + 包名 + 图标数 + 选中态」；图标文件名索引从每卡收敛为激活包下方一处折叠「图标引用清单」；删除「颜色主题」死占位块（配色切换在通用设置）；卡片改真 `<button>`（`aria-pressed` + `focus-visible`），上传/切换补 进行中/成功/失败 三态取色

### #9 · 「图标引用清单」语义错位：只列已有文件，看不出需要哪些/叫什么/放哪；上传永远补不齐 app/tray

- 环境：dev + 打包版（设置页 → 外观）

- 第一现场：无任何报错。清单列的是激活包目录里**已有**的文件名（含用户自己传的那些），而 `settings-trigger.svg` 这类**系统需要但包里缺**的位不出现在清单里（静默回退官方齿轮，用户无从得知）；顶部「上传图标」选完文件恒落 `userData/themes/custom/icons/<原名>`，而应用/托盘图标约定在**包根**（`app-icon-light.png` 等）——传了也不生效

- 状态：**fixed**（2026-09-04 · 待实机点验）→ 坑 28

- 修复（真源一处 + 槽位驱动）：host `desktop-theme.ts` 新增 `ICON_SLOTS` 注册表（13 位：包根 app/tray × 明暗 4 + `icons/` UI 位 9，含 `label/group/file/format/size/fallback`）；`desktop.iconTheme.list` 下发 `slots`（`provided` 相对激活包判定）+ `uploadDir`（可写包绝对路径，设置页原文展示落盘位置）；`desktop.iconTheme.upload({slotId})` 按槽位格式单选文件 → 以规范名写入 custom 包（自动建子目录）→ 重扫主题表（首传包需进表否则协议层 404）→ custom 激活时宿主图标 + 各窗口 UI 双刷新；设置页改「图标需求清单」（用途 / 规范名 / 格式·建议尺寸 / 缺失回退 / 已提供状态 + 行内「上传/替换」），删除顶部通用上传按钮，preload `DesktopIconTheme` 与 zod 契约同步

- 同日按用户反馈追加三点（原方案「固定落 custom 包」被否）：
  1. **上传目标 = 当前激活包**（不再是固定 custom）：内置包在打包版随 asar 只读 → 先整体 `cp` 克隆到 `userData/themes/<id>`（扫描时用户包覆盖内置，**激活 ID 不变**）再写槽位文件，回执 `cloned` 供 UI 说明；`USER_THEME_ID` 常量下线
  2. **新增 `desktop.iconTheme.create({id,name})`**：用户目录建空包（theme.json + icons/）**建完即激活**，「建自己的包 → 逐项传图标」成一条连续路径；ID 走协议路由同款白名单 `[a-z0-9_-]{1,32}`，重名拒绝
  3. **需求清单默认折叠**：改 `<details>`，summary 带缺失计数（`缺 N 项` / `全部已提供`）作展开信号；`uploadDir` 语义改为「激活包写入目录」（内置包显示其克隆目标）
  4. **分组改「分组卡」（用户反馈：分类不够显著、看不出图标归哪个插件用）**：槽位注册表新增 `plugin` 字段（取用方插件/模块标识，如 `@lansi-ai/dsh-desktop-settings-shell`、`desktop-host（main.ts / desktop-tray.ts）`），`group` 回归纯用途域；每组渲染成带边框容器——组头 = 用途域名（13/600）+ 插件标识 chip（等宽小字 + `fill-tsp-secondary` 底）+ 本组「缺 N / 共 M」计数（缺失走 warn 色），组体每行行首加**该槽位图标的实际缩略图**（未提供=虚线空格），一眼对上「哪个位、谁在用、现在长什么样」

### #10 · 设置页导航「外观」显示官方原生图标，且比其它自定义图标大一档

- 环境：dev（激活包 = `.runtime/user-data/themes/default`，即上传时被克隆出来的默认包）

- 第一现场：无任何报错。导航「外观」一行的图标形状与其它行不同（官方齿轮 vs 自定义 Material 调色板），且明显大一圈

- 状态：**fixed**（2026-09-04 · 待实机点验）→ 坑 29

- 根因（两件独立）：① 内置 `resources/themes/default/icons/settings-nav-appearance.svg` 是 **0 字节空占位**（由 `settings-nav-theme.svg` 重命名而来，本来就是空的）→ 协议层 200、renderer 解析不出 `<svg>` → 静默回退官方图标；而需求清单 `provided` 只判 `existsSync`，把空文件标成「已提供」，缺口被藏住；② 尺寸差是**画布留白规范不同**：官方 primitives 16 网格字形近乎满幅（≈87%、描边 1px），自定义为 Material Symbols 24 网格（`viewBox="0 -960 960 960"`，字形约 79%、描边缩到 ≈0.8px），两者被强制成同一 16px 盒子 → 看着小一档

- 修复：① `provided` 改「存在且 `size > 0`」+ 删内置空占位（并清 `dist` 里的陈旧空文件——`copy-web` 只覆盖不删除）；② `desktop-icon-client.js` 的 `renderSvg` 加**光学归一**：离屏 `getBBox()` 测字形真实包围盒 → viewBox 重设为「最长边 + 每侧 1/16 内边距」的正方形并居中（1/16 对齐官方留白比例），测不到包围盒则不裁切，结果进缓存只测一次

### #11 · 标题栏窗控/折叠图标无法主题化（硬编码内联 path）

- 环境：dev（用户实机点验外观功能时提出「最大化最小化关闭的图标不能设置吗」）

- 第一现场：非报错。需求清单里没有窗控槽位（`ICON_SLOTS` 只到 `titlebar-logo`），`desktop-titlebar-client.js` 里 `ICON_MINIMIZE / ICON_MAXIMIZE / ICON_RESTORE / ICON_CLOSE / ICON_CHEVRON_LEFT / RIGHT` 全是常量 path

- 状态：**fixed**（2026-09-04 · 待实机点验）→ 坑 30

- 修复（6 个新槽位 + 三条口径）：host `ICON_SLOTS` 补 `titlebar-minimize / -maximize / -restore / -close / -collapse-left / -collapse-right`（group=标题栏，plugin=@lansi-ai/dsh-desktop-titlebar）；titlebar 新增 `useThemeControls()` 按 `icons/<名>.svg` 是否存在启用，**状态对成对提供才启用**（maximize↔restore、collapse-left↔right，缺一整套回退内置）；`themeIcon` 加同步 `peekSvg`，未命中**先画内置 Fluent 图形**再换主题稿（不空帧），破缓存用模块级 `controlBust`；close 的 hover 反色改走 `color:#fff` + 旧 `svg path{stroke}` 收窄到 `svg.dsh-desktop-titlebar-icon`（避免给彩色/填充型主题稿硬加白描边）；顺带把 `useThemeLogo` 的 `current !== 'default'` 条件去掉，与清单 `provided` 同口径（否则克隆 default 定制 logo 时清单说已提供、界面却不生效）

### #12 · 图标归属错位：应用/托盘图标与品牌 logo 被当成「图标包内容」

- 环境：dev（用户点验外观页时提出「应用与托盘图标和标题栏品牌 logo 不属于图标包中的内容，应该与图标包平级」）

- 第一现场：非报错。外观页把它们埋在「图标包 → 需求清单」的分组里，语义上等于宣称"应用图标属于某个图标包"；实际数据模型也确实如此（app/tray PNG 存包根、logo 存包内 `icons/`），**换包会连带换掉应用图标与品牌 logo**

- 状态：**fixed**（2026-09-04 · 待实机点验）→ 决策 D-23

- 修复（数据模型分层，不只是排版）：
  1. `ICON_SLOTS` 新增 `scope: 'global' | 'pack'`（由 `GLOBAL_SLOT_IDS` 派生）——global=应用/托盘四件套 + 标题栏品牌 logo，pack=界面图标（设置导航、窗控、折叠钮）
  2. 全局图标唯一落盘处 `userData/icons/`；`getActiveIconPath` **只认全局目录**（全局色版 → 全局另一色版 → 内置默认），不再读激活包；新增协议路由 `dsh-ui://app/icons/<file>`（`resolveGlobalIconPath` 内含白名单校验）
  3. `upload({slotId})` 按 scope 分流：global 写 `userData/icons/`，pack 写激活包（内置包仍先克隆）；对话框先弹、取消不做任何写操作；回执带 `scope` 供 UI 说人话
  4. **一次性迁移** `migratePackIconsToGlobal()`（ready 阶段、建窗前）：全局缺该文件时按「激活包优先、其余包次之」从包根复制过去，全局已有不覆盖；**品牌 logo 不迁**（旧口径 default 激活时本就不启用包内 logo，迁了会平白改变外观）
  5. `listThemeIcons` 不再枚举包根 PNG（包内容=界面图标，图标包卡片预览与「N 个图标」计数随之变准）；titlebar `useThemeLogo` 改走 `/icons/` 且不再依赖 `iconTheme.list()`
  6. 外观页改为**由上至下四项一级设置项**（用户定的层级与顺序）：**应用图标 → 托盘图标 → 品牌 logo → 图标包**；前三项的块标题与顺序直接取自注册表 global 槽位的 `group`（组名拆分：应用与托盘 → 应用图标 / 托盘图标，logo 从「标题栏」组独立为「品牌 logo」），界面图标需求清单降为「图标包」的二级明细（折叠）
  7. **一级块再精简 + 改横向排布**（用户第二轮反馈"太复杂、竖向浪费空间"）：块内只留「标题 + **横向槽位卡网格**」（`.dsa-slotGrid` = `repeat(auto-fill,minmax(200px,1fr))`），每卡 = 缩略图 + 用途 + 上传·替换；删掉插件标识 chip、说明段、落盘路径行、规范文件名，以及「✓ 已提供」文字标签 —— 状态改由**视觉本身**表达：有缩略图=已提供、虚线空格=未提供，按钮文案「替换/上传」同步。格式与建议尺寸不丢（写在上传对话框标题里）。新增 `SlotCards` 组件专供一级块，`SlotGroups`/`IconSlotRow` 回到单一形态专供图标包下的需求清单（保留组头插件标识与计数、行内规范名与回退说明——那里才需要"哪个位、叫什么"）；一级块之间加 1px 分隔线（`.dsa-section + .dsa-section`，同构块只靠留白会糊）
  8. **顺带修掉一个路径 bug**：`titlebar-logo` 槽位的 `file` 原为 `icons/titlebar-logo.svg`，改 global 后归属目录已是 `userData/icons/` —— 若不剥掉 `icons/` 前缀，上传会写出 `userData/icons/icons/titlebar-logo.svg`、清单也永远判缺失。现 global 槽位 `file` 一律只写文件名

- 副作用（已知且符合新语义）：内置 aurora/sunset 包的差异全在 app/tray PNG 与 logo 上，改造后切到这两个包**几乎无视觉变化**（只剩 `ui-overrides.json`）；包根遗留 PNG 不删（协议路由仍兼容，属用户资产）

