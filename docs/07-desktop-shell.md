# 07 · 桌面外壳设计（Electron shell）

## 1. 定位与边界

shell/ 是**应用装配层**，角色等同官方 `apps/cli`：只做「组合」与「平台胶水」，不含业务逻辑。
- 业务（会话/工具/审批/存储）全部在 Cordis Host 内——shell 永不直接操作会话数据。
- Electron 原生能力经 `ctx.desktop` 服务的 host 插件暴露——shell 只写「把 Electron API 变成服务实现」的胶水。

## 2. 主进程装配时序（伪代码级）

```
main()
 1 app.requestSingleInstanceLock()            // 单实例；二次启动 → 转发 dsh:// 参数
 2 解析启动参数（--profile 别名 desktop-app-provided / --serve / --dev / --user-data-dir）
 3 bootstrap = await import('@lansi-ai/dsh-shell-runtime')   // 复用 dsh-app-boot 的 boot()
 4 ctx = boot('dsh-desktop', desktopConfigPath, {
      prepare(currentCtx) {                     // 官方预留的 prepare 钩子
        currentCtx.provide('desktopRuntime', …) // 供给 __DSH_BOOT__ 等价物、IPC 桥宿主端、bundle 服务
        currentCtx.provide('desktopStartup', { host, portless:true, … })
      },
      bareModuleBaseUrl: packagedNodeModules,   // 离线：包树随应用
    })
 5 assertEntriesLoaded/Activated（官方）→ 失败页（boot 页可见，同官方理念）
 6 创建窗口：loadURL('dsh-ui://index.html')
    - webPreferences: { contextIsolation:true, sandbox:true, preload, nodeIntegration:false,
                        webSecurity:true, allowRunningInsecureContent:false }
 7 Tray / 全局热键 / 协议注册（desktop-* host 插件在 boot 中已就绪，此步只是窗口就绪后 attach）
 8 app.on('before-quit') → flush → 优雅关停 Host（sessions dispose → 持久化落盘）→ exit
 9 Host 异常退出（uncaughtException / crash）→ desktop-host-restart 接管：记录 → relaunch
```

## 3. IPC 桥协议（信封）

对齐官方四象限（见 `04-architecture.md §5.1`），本 shell 的实现细节：

| 方向 | 通道 | 载荷 |
| --- | --- | --- |
| 上行 client-request | `ipcRenderer.invoke('dsh:rpc', { method, body })` | 全形 `ClientRequest`；主进程 → `apiProxy` 语义处理器 |
| 上行 client-response | `ipcRenderer.invoke('dsh:respond', { rpcId, body })` | 回填服务端帧 |
| 下行 server-request | `webContents.send('dsh:frame', fullForm)` | session/event、approval/question requested、host/agent-error… |
| 下行握手 | 启动后 `webContents.send('dsh:ready', { describe })` | 对齐 `host.describe`；renderer 重建=reconnect 语义 |

- 大帧保护：`session.history` 分页、`events.mux` 走已经存在的流语义；单帧超限时拆块（复用官方分页对齐消息边界设计）
- 调试：任何一侧可开 envelope tap（官方 `subscribeEnvelopes` 槽位）

## 4. 窗口管理

| 窗口类型 | 数量 | 内容 | 生命周期 |
| --- | --- | --- | --- |
| 主窗口 | 1 | 官方 UI 完整面（会话列表 + 当前会话 + 轨迹 tab + 设置） | 关闭 = 隐藏驻留（R-05）；显式「退出」才 quit |
| 会话窗口（P1） | 0..N | 同一 shell 的独立窗口，仅渲染指定会话 | 会话关闭/窗口关闭即销毁；状态随会话持久化 |
| Spotlight 快速问答（P1） | 0..1 | 无边框小窗，复用官方 composer | 热键唤起；Esc 关闭 |
| 更新确认 | 0..1 | 模态 | updater 就绪时 |

- 多窗口会话同步：各窗口共享同一 Host（一个 Cordis 树），会话投影（`session-projection`）保证状态一致；
  客户端侧 connection 载波各自独立实例（每窗口一载波，同一协议），载波注册表按 `sender.id` 路由应答
- 焦点跟随（P2）：agent 活动中切换窗口时通知/托盘动作可 `windows.focus(sessionId)`

## 5. 静态资源与协议注册

```
dsh-ui://index.html          → 官方 UI dist 根（resources/dist 内嵌 dist）
dsh-ui:///assets/*           → dist 静态
dsh-ui:///plugins/<id>/client.js?rev=  → 零端口 bundle 服务（desktop-host-compat 从已装载插件包读取 bundle 产物）
dsh://open?session=…         → shell 注册 OS 层协议；解析后经 desktop-host-protocol → 窗口聚焦/打开
```
- 分发模式：dist 与 app 二进制同包（resources/）；开发模式：直接指向上游 `apps/web/dist`
- `__DSH_BOOT__` 注入：主进程在 `dsh-ui://` 响应里注入 manifest（同官方 IndexTap 语义），或经 `BootSeams` 传入（M1 spike 二选一）

## 6. 打包、签名与更新（M5）

| 项 | 方案 |
| --- | --- |
| 跨平台打包 | electron-builder（Win NSIS + portable zip；mac dmg；Linux AppImage/deb/rpm），对齐社区桌面发布形态 |
| 内置运行时 | 将锁定的 dsh 依赖（含 pnpm 原生依赖）+ dist 打进 resources；**零外部 Node/pnpm 依赖** |
| 校验 | `SHA256SUMS` 资产 + 安装器校验；Windows 代码签名（EV 或 OV）、mac notarization |
| 更新 | 自建「更新描述符」（JSON：版本/资产/校验）→ 下载 → 校验 → 替换 → relaunch；回滚保留上一版快照 |
| 渠道 | `stable`（rc.8 等通过校验的 tag）/ `rc`（next）/ `off` |

## 7. 崩溃恢复与退出路径

- **优雅退出**：用户 Quit → `sessions` flush → Host dispose → exit 0；窗口关闭仅隐藏
- **宿主崩溃**：错误页 + 手动/自动 relaunch；会话视图事件溯源重建（历史=replay，官方语义）
- **杀进程**：JSONL append-only + sqlite 投影 cache 本就崩溃安全；重启收敛

## 8. 性能预算与工程约束

| 指标 | 目标 | 手段 |
| --- | --- | --- |
| 冷启动 → UI 可用 | ≤3s | 预加载 dist 缓存、延迟装载非 P0 插件 |
| 常驻内存 | ≤400MB | 单 Host、窗口按需、空闲窗口 `backgroundThrottling` |
| 唤起响应 | ≤300ms | 热键 → 已有窗口 show |
| 首次启动体验 | 无 Node 提示 | 全内嵌运行时 + 引导页（复用官方 versioned welcome） |

## 9. 与官方 Web 并存的运行模式

| 模式 | 触发 | 行为 |
| --- | --- | --- |
| 默认（portless） | 常态 | 零端口；桌面独占 UI |
| `--serve`（兼容） | 显式参数/设置 | 启动 webserver 挂 loopback（可配），供旧插件路由面与浏览器并存；与桌面共用数据 |
| headless 伴生 | 未来 | 桌面 + `--profile headless` 任务模式并行（同一数据目录） |

## 10. 待定明细（M1 spike 出结论后固化）

- [ ] `dsh-ui://` vs `file://` 终选（协议对 module/CORS/字体加载的行为差异实测）
- [ ] 零端口 bundle 服务方案终选：`dsh-ui://plugins/...` 协议直读 vs `BootSeams.loadBundle` 覆写
- [ ] 旧插件同源 `fetch` 拦截方案终选（`dsh-ui://` fetch hook vs preload `window.fetch` hook）→ 映射到 desktopRoutes
- [ ] Windows toast 通知在未打包 dev 模式下的行为差异处理
- [ ] 多窗口载波注册表的 rpcId 路由冲突测试矩阵