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

