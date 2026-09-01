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

### #6 · 设置页切外观报 `settings namespace "ui-theme" is not registered`

- 环境：打包版（`npm run start`，dist/desktop-shell/main.js）

- 第一现场：

  ```
  14:25:56 [dsh-bridge] RPC 失败 (settings/mutate): Error: settings namespace "ui-theme" is not registered
      at unpackServerResponse (dist/desktop-shell/main.js:284)
      at async callApi (dist/desktop-shell/main.js:314)
      at async dist/desktop-host/bridge.js:137
  ```

- 状态：**verified**（2026-09-01，用户实机确认）→ 坑 26 ——boot.ts §1 补装 `ui-theme`/`locale`/`ui-chat`/`ui-conversation` 四个 host 半条目

- 根因：`ui-theme` namespace 由官方 `@deepseek-ai/dsh-client-ui-theme` 的 **host 半** `apply()` 注册（`settings.register('ui-theme', ...)`），boot.ts §1 host 装配清单漏装该条目（官方 web-app cordis.patch.yml L177-199 有；M4-d3 迁移时只补了 `ui-settings-general` 同类条目，漏掉同类其余 3 个）。排查同口径：`dsh-client-locale`（locale）、`dsh-client-ui-chat`（ui-chat）、`dsh-client-ui-conversation`（ui-conversation）同为「双面包缺 host 半」，一并补装。

### #7 · 设置页切外观不再报错，但界面无任何变化（写入成功、应用丢失）

- 环境：打包版（`npm run start`，dist/desktop-shell/main.js）

- 第一现场：`settings/mutate` RPC 成功（#6 修复后），偏好已持久化，但明暗切换零视觉反馈

- 状态：**verified**（2026-09-01，用户实机确认）→ 坑 26 ——`desktop-layout-client.js` 补 ThemePresenter 等价实现

- 根因：官方 `dsh-client-ui-theme` client 半只负责 settings 读写 + 发布 `theme/change` 事件；真正把主题应用到 DOM（根 `color-scheme`、body `data-ds-dark-theme` 属性、`--dsh-content-font-size` 字号轴、token 变量、theme-color meta）的是**官方** **`ui-layout`** **的 ThemePresenter**（订阅 `theme/change`）。M6-P1 自研布局接管 root 槽位排除 `dsh-client-ui-layout` 时，ThemePresenter 随之丢失（无消费者）→ 坑 26。修复：自研 `@lansi-ai/dsh-desktop-layout` 增设等价 `ThemePresenter`（初始 `ctx.theme.getTheme()` + 订阅 `theme/change`，dispose 回撤），`inject: ['slots','theme']` 原已声明 theme 依赖。

### #8 · 深色主题下 titlebar 与侧栏仍是浅色（主区已正常切深）

- 环境：打包版（`npm run start`）

- 第一现场：切深色后主卡（官方 UI）正常变深，titlebar 行 + 侧栏列保持白/浅灰；侧栏会话条目文字发灰难读

- 状态：**verified**（2026-09-01，用户实机确认）→ 坑 26

- 根因：titlebar 行与侧栏列本身透明，透出的是宿主托盘底色 `--dsd-tray-bg`（硬编码浅色 `rgb(242 243 245)`）；另自绘 titlebar/sidebar CSS 有多处硬编码黑色系 hover/边框，侧栏根还声明了 `color-scheme: light dark`（会改随 OS 偏好而非应用主题）。修复（CSS `light-dark()` 双值，Electron 44 全支持）：

  - `--dsd-tray-bg` 默认值改 `light-dark(rgb(242 243 245),rgb(28 28 30))`（boot-graph 骨架 + desktop-appearance 两处同源）；presenter 写根 `color-scheme` 后明暗自动跟随

  - titlebar 品牌区 hover/版本号底/折叠钮 hover → light-dark 双值（窗控 hover 原本已是）

  - sidebar 新会话按钮边框/hover、rail 标签色 → light-dark 双值；删除根 `color-scheme: light dark` 声明（继承 presenter 的根方案，保证 light-dark 与全局主题一致）

