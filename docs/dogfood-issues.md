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

### 遗留观察（非阻断，M5 评估）
- `dynamicCordisRunner/*`（inspect providers 同步）service-unavailable：`dsh-cordis-host-runner` 未装载，依赖 `tools` 服务链（坑 12 附记）
- `[dsh-ui-protocol] 404 dsh-ui://app/plugins/events`：官方 UI 请求的静态资源不存在，暂无功能影响，观察即可
