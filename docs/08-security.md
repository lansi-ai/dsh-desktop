# 08 · 安全与信任模型

> 桌面应用 = 更强的本地能力 + 更大的攻击面。目标：**默认最小权限、一切可审计、与官方审批模型同构**。

## 1. 威胁模型（简表）

| 威胁 | 场景 | 对策 |
| --- | --- | --- |
| 供应链 | 恶意 client/host 插件经 bundle 装载 | 插件来源=官方 npm 包 + 本机信任的包（用户显式 `dsh plugin add`）；后续可加签名校验（P2） |
| renderer 逃逸 | UI 漏洞 → 提权到 Node/磁盘 | `contextIsolation` + `sandbox` + 无 `nodeIntegration` + preload 白名单 |
| 本地越权 | 插件/工具读取越权路径 | 官方 fs 沙箱（fs-observation-policy、sandbox-policy）+ 桌面能力各自的审批门槛 |
| 剪贴板 | 恶意写剪贴板（钓鱼） | 写操作必须 approval；读按白名单上下文（composer 聚焦时） |
| 协议注入 | `dsh://` 参数注入 | 参数严格 schema 校验（`zod`），白名单 action（open/ask），不拼接路径 |
| 通知滥用 | 刷通知/伪造完成 | 通知内容来自受控事件；托盘/通知点击只做定位不做执行 |
| 网络 | 桌面能力外发 | 唯一外发=用户启用的模型 API 与 web 能力（官方 `ctx.web` 的 provider 选择）；端口不外开 |

## 2. 默认姿势（Defaults）

| 项 | 默认 | 说明 |
| --- | --- | --- |
| HTTP 端口 | **不开** | portless 是红线（`--serve` 显式开启且仅 loopback） |
| renderer 沙箱 | on | `sandbox:true, contextIsolation:true`；preload 只暴露 `desktopBridge` 白名单对象 |
| 剪贴板写 | 审批 | 复用 approval 管道（waterfall 短路即可否决） |
| 桌面工具 | 全关 | `desktop_*` 模型工具默认不注册（settings 开关） |
| 遥测 | 关 | 本地统计可选，无匿名外发 |
| 外链打开 | 白名单 | `shell.openExternal` 仅 http(s) 且弹确认（复用官方 Web 的 trustedHosts 思路） |
| 自动更新 | stable 通道 | 更新包校验 SHA256；失败不动当前版本 |

## 3. renderer 隔离细则

- `webPreferences`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webSecurity: true`, `allowRunningInsecureContent: false`, `enableRemoteModule: false`
- preload 仅注入：
  - `window.desktopBridge`（第 06 章 §3 的最小面）——不做通用 `ipcRenderer` 泄漏
  - 无 `process`/`require`/`Buffer` 泄漏；desktop 域经主进程→`ctx.desktop` 服务双层校验
- 子窗口（会话/Spotlight/兼容窗口）继承同样的 webPreferences；不共享不必要的 preload 能力
- CSP：
  - 主面 `dsh-ui://`：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'`
    （自绘面无同源 fetch，全部走 `desktopBridge` IPC——`connect-src 'none'` 可收紧）
  - 兼容窗口 `dsh-legacy://`：按官方 dist 需求最小放开；其「同源 fetch」经桥拦截，走**路径白名单**（仅已在
    desktopRoutes 注册的路由，如 `/rules/*`、`/terminal/run`）再落宿主，杜绝任意路径穿透

## 4. 插件信任边界（对齐官方立场）

- 官方明确：**动态 cordis 包 ≈ bash 访问**（见 `dsh-cordis-host-runner` README 的 Trust stance）。
  桌面插件同此标准：**装载插件 = 信任其代码**，权限面由 approval/fs-sandbox 兜底，而非运行时隔离。
- 分发校验（P2）：对装载的插件包做「来源声明 + 可配置签名校验」——先记录在案，不阻塞 M1。

## 5. 敏感操作清单与审批映射

| 操作 | 审批要求 | 实现 |
| --- | --- | --- |
| 剪贴板写入 | 必需 | `desktop-host-clipboard` 调 approval 服务（waterfall） |
| 文件删除/越工作区写 | 官方 fs 策略已有 | 沿用 `tool-fs` 的 `fs-observation-policy` + approval |
| 打开外部 URL | 确认弹窗 | shell.openExternal 白名单 + 用户确认（可记忆「本次会话」） |
| `dsh://` 参数处理 | schema 校验 | desktop-host-protocol 内 zod 校验，拒绝即忽略 |
| **兼容层 HTTP 面**（`/rules/*` 类旧插件路由） | 路径白名单 | desktopRoutes 仅放行已注册路径；未注册一律 404；方法/体积上限对齐插件常见用法 |
| 安装/回滚更新 | 用户动作 | 更新永不静默自动执行 |
| 开机自启注册 | 用户显式开启 | 设置窗口开关（默认关） |

## 6. 审计

- 所有桌面动作（§5 之外也包括托盘/热键/通知点击）→ `desktop/action` 事件 → 结构化日志（时间/动作/会话ID/来源窗口）
- 敏感动作同时写独立审计面（`$DSH_HOME/desktop/audit.jsonl`，P2 提供查询工具）
- 日志不含：凭据、完整 prompt/回复内容（仅事件类型与 id 关联）——对齐官方「日志不记录敏感信息」原则

## 7. 代码签名与发布安全（M5）

- Windows：代码签名证书（先 OV 后 EV）；SmartScreen 引导页说明校验步骤
- 发布资产：`SHA256SUMS`；安装器校验栏「校验后再安装」引导
- 更新通道：更新描述符 HTTPS + 签名（先 SHA256 后强签名）；降级防护：不允许回退到低于当前已知漏洞版本
- macOS notarization、Linux 包签名（视首发平台优先级 M5 决定）

## 8. 安全评审清单（实现每个里程碑时执行）

- [ ] renderer 无 Node 泄漏（audit preload 面）
- [ ] 端口零监听验证（`netstat -ano` 无 308x 属我们的进程）
- [ ] IPC 方法白名单与服务端校验（不可 invoke 任意方法名）
- [ ] CSP 生效（`dsh-ui://` 响应头测试）
- [ ] 剪贴板/文件/外链审批链路 e2e
- [ ] 插件卸载后无残留（托盘/热键/路由清理，effect 测试）
- [ ] `dsh://` fuzz（畸形参数不崩溃不执行）