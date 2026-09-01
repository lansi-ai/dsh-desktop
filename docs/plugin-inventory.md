# dsh-desktop 完整插件清单（Plugin Inventory）

> 真源：`src/desktop-host/boot.ts`（Host 树 §1+§4 insert）与 `src/desktop-host/boot-graph.ts`（Client 图谱 desktopDecls + CLIENT_EXCLUDE_IDS）。本文为派生视图，架构变更时同步更新。
> 命名规范（D-19）：桌面插件统一 `@lansi-ai/dsh-*`（蓝思 scope + dsh 生态前缀）。
> 状态更新至：M3-c 完成态（2026-08-27，布局插件 + 标题栏插件化已装载，M3-c3 实机验证待做）。
> HTML 可视化版：`docs/architecture-plugins.html`。

图例：✅ 已装载 · ⛔ 已禁用 · 🚫 被排除（不入图谱）· 🟠 预载注册（不激活）

---

## 一、Host 侧 · Cordis 插件树（boot.ts overlay patches）

装载链：`bootDesktopHost()` → 官方 `boot('dsh-desktop', cordis.yml, patches, prepare)`，所有条目无改动装载。

### 1. LLM 与凭据（6 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-llm` | LLM 服务注册与路由（ctx.llm） | ✅ |
| `@deepseek-ai/dsh-llm-deepseek` | DeepSeek 官方模型 provider | ✅ |
| `@deepseek-ai/dsh-llm-pi-ai` | Pi AI provider（备用通道） | ✅ |
| `@deepseek-ai/dsh-llm-retry` | LLM 调用重试策略 | ✅ |
| `@deepseek-ai/dsh-agent-default-model` | 默认模型绑定（deepseek-official / v4-flash） | ✅ |
| `@deepseek-ai/dsh-credentials-local` | 凭据本地持久化（API Key 经环境注入） | ✅ |

### 2. 会话与持久化（10 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-session` | 会话生命周期（ctx.sessions，create/resume/prompt） | ✅ |
| `@deepseek-ai/dsh-session-persistence-jsonl` | 会话 JSONL 持久化（RUNTIME_ROOT/user-data/sessions） | ✅ |
| `@deepseek-ai/dsh-session-projection` | 会话投影（列表态摘要 summarizeCold） | ✅ |
| `@deepseek-ai/dsh-session-query-sqlite` | 会话查询索引（:memory:，按需打开） | ✅ |
| `@deepseek-ai/dsh-session-title` | 会话标题服务 | ✅ |
| `@deepseek-ai/dsh-session-title-first-prompt-llm` | 首条 prompt 生成标题 | ✅ |
| `@deepseek-ai/dsh-session-checkpoint-policy` | 会话检查点策略 | ✅ |
| `@deepseek-ai/dsh-session-telemetry-otel` | 遥测上报（默认 DISABLED） | ✅ |
| `@deepseek-ai/dsh-attachment-local` | 附件本地存储 | ✅ |
| `@deepseek-ai/dsh-workspace` | 工作区注册表（ctx.workspaceRegistry，apiProxy 依赖） | ✅ |

### 3. Agent 循环与指令（7 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-agent` | Agent 核心（ctx.agents，per-session live agent） | ✅ |
| `@deepseek-ai/dsh-agent-loop` | Agent 对话循环驱动 | ✅ |
| `@deepseek-ai/dsh-agent-instructions` | 指令/系统提示组装（64KB 上限） | ✅ |
| `@deepseek-ai/dsh-system-prompt` | 系统 persona（§2 覆盖为桌面版） | ✅ |
| `@deepseek-ai/dsh-plan-mode` | 计划模式 | ✅ |
| `@deepseek-ai/dsh-commands` | 斜杠命令注册表（commands/list） | ✅ |
| `@deepseek-ai/dsh-command-feedback` | 命令反馈通道 | ✅ |

### 4. 压缩与 Token 管理（6 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-compaction-basic` | 上下文压缩基础实现 | ✅ |
| `@deepseek-ai/dsh-command-compact` | /compact 命令 | ✅ |
| `@deepseek-ai/dsh-compaction-tool-result-pruner` | 工具结果裁剪（8192 阈值头尾截留） | ✅ |
| `@deepseek-ai/dsh-token-meter` | Token 计量 | ✅ |
| `@deepseek-ai/dsh-spill-local` | 大结果外溢本地存储 | ✅ |
| `@deepseek-ai/dsh-spill-policy` | 外溢策略（50KB 内联上限） | ✅ |

### 5. 沙箱与执行（9 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-sandbox-local` | 本地沙箱执行环境 | ✅ |
| `@deepseek-ai/dsh-sandbox-policy` | 沙箱策略（默认 workspace-write） | ✅ |
| `@deepseek-ai/dsh-bash-sandbox` | bash 沙箱（非 Windows） | ✅ |
| `@deepseek-ai/dsh-pwsh-sandbox` | PowerShell 沙箱（Windows） | ✅ |
| `@deepseek-ai/dsh-subprocess-local` | 子进程管理 | ✅ |
| `@deepseek-ai/dsh-shell-env` | Shell 环境探测 | ✅ |
| `@deepseek-ai/dsh-jobs-local` | 后台任务管理 | ✅ |
| `@deepseek-ai/dsh-fs-sandbox` | 文件系统沙箱边界 | ✅ |
| `@deepseek-ai/dsh-fs-observation-policy` | 文件观察策略 | ✅ |

### 6. 工具集（17 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-tools` | 工具注册表（ctx.tools） | ✅ |
| `@deepseek-ai/dsh-tool-bash` | bash 工具（非 Windows） | ✅ |
| `@deepseek-ai/dsh-tool-pwsh` | PowerShell 工具（Windows） | ✅ |
| `@deepseek-ai/dsh-tool-fs` | 文件读写/移动/删除 | ✅ |
| `@deepseek-ai/dsh-tool-fs-search` | 文件搜索（glob/正则） | ✅ |
| `@deepseek-ai/dsh-tool-str-replace-editor` | 字符串替换编辑器 | ✅ |
| `@deepseek-ai/dsh-tool-web` | 网页抓取/搜索工具 | ✅ |
| `@deepseek-ai/dsh-tool-todo` | 待办清单工具 | ✅ |
| `@deepseek-ai/dsh-tool-goal` | 目标管理工具 | ✅ |
| `@deepseek-ai/dsh-tool-jobs` | 后台任务工具 | ✅ |
| `@deepseek-ai/dsh-tool-skill` | 技能调用工具 | ✅ |
| `@deepseek-ai/dsh-tool-ralph` | 循环驱动工具（spawn 子代理） | ✅ |
| `@deepseek-ai/dsh-tool-workflow` | 工作流编排工具（JS 脚本 over ctx.workflowEngine） | ✅ |
| `@deepseek-ai/dsh-tool-subagent-control` | 子代理控制 | ✅ |
| `@deepseek-ai/dsh-tool-subagent-list-agents` | 子代理列表 | ✅ |
| `@deepseek-ai/dsh-tool-subagent`（×2 配置实例） | 子代理 spawn/fork 双形态 | ✅ |
| `@deepseek-ai/dsh-tool-subagent-report` | 子代理报告 | ✅ |

### 7. 子代理与工作流（5 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-subagent` | 子代理服务（ctx.subagents） | ✅ |
| `@deepseek-ai/dsh-subagent-spawn-in-process` | 进程内 spawn provider | ✅ |
| `@deepseek-ai/dsh-subagent-fork-in-process` | 进程内 fork provider | ✅ |
| `@deepseek-ai/dsh-workflow-worker-thread` | 工作流 worker 线程 | ✅ |
| `dsh-goal` + `dsh-goal-round-driver` + `dsh-command-goal` | 目标域三件套 | ✅ |

### 8. 技能与提示（5 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-skill` | 技能服务（skill.list 等） | ✅ |
| `@deepseek-ai/dsh-skill-filesystem` | 文件系统技能源 | ✅ |
| `@deepseek-ai/dsh-skill-badge` | 技能徽章 | ⛔ 已禁用 |
| `@deepseek-ai/dsh-user-questions` | 用户提问（question/requested 帧） | ✅ |
| `@deepseek-ai/dsh-repeat-tool-reminder` | 重复工具调用提醒（3/5/8 阈值） | ✅ |

### 9. API 载波与网关（5 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-host-apiproxy` | apiProxy（ctx.apiProxy：unary RPC 入口 + mux/host 事件流） | ✅ |
| `@deepseek-ai/dsh-api-gateway` | typertGateway（remote 端点兜底，坑 12） | ✅ |
| `@deepseek-ai/dsh-typert-registry` | Typert 注册表 | ✅ |
| `@deepseek-ai/dsh-typert-loader` | Typert 加载器 | ✅ |
| `@deepseek-ai/dsh-api-remotes` | 远端 API 声明（桌面零端口不需要） | ⛔ 已禁用 |

### 10. 配置与存储（5 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-settings-file` | settings 持久化（desktop/ui-theme 等 namespace） | ✅ |
| `@deepseek-ai/dsh-storage` | 存储服务（ctx.storage） | ✅ |
| `@deepseek-ai/dsh-storage-json` | JSON 后端（RUNTIME_ROOT/user-data/storages） | ✅ |
| `@deepseek-ai/dsh-storage-domain` | 存储域（ctx.storageDomain） | ✅ |
| `@deepseek-ai/dsh-agent-presets` | Agent 预设（坑 16：必经 §4 insert 装载） | ✅ |

### 11. 权限与审批（3 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-user-approval` | 审批服务（approval/requested 帧；剪贴板写经此） | ✅ |
| `@deepseek-ai/dsh-permission-presets` | 权限预设（read-only / workspace-write / danger） | ✅ |
| `@deepseek-ai/dsh-tool-call-timeout-policy` | 工具调用超时策略 | ✅ |

### 12. Web 与搜索（3 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-web` | Web 服务聚合（searchProvider: deepseek-official） | ✅ |
| `@deepseek-ai/dsh-web-search-deepseek` | DeepSeek 搜索 provider（DEEPSEEK_API_KEY） | ✅ |
| `@deepseek-ai/dsh-client-ui-settings-general` | ui-onboarding settings namespace（进入官方 UI 必需） | ✅ |

### 13. 基础设施与第三方（4 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/cordis-plugin-timer` | 定时器服务 | ✅ |
| `@deepseek-ai/cordis-plugin-hmr` | 热重载（桌面不需要） | ⛔ 已禁用 |
| `@lnyanhongyan/dsh-opencode-usage` | 第三方用量统计（host 半靠 webServer 等价面激活） | ✅ |
| webserver / web-runtime / web-startup / modules / client-hmr / cordis-host-runner / connection / client-runtime | 官方 Web 传输层与动态装载器（§3 禁用 = 零端口红线；host-runner 未装载致 `dynamicCordisRunner/*` 部分不可用，M5 评估） | ⛔ 已禁用 |

### 14. Host 进程内注入（prepare 钩子，非插件，5 项）

| 服务 | 作用 | 状态 |
|---|---|---|
| `cmdlineArgs` | provideCmdline 命令行参数服务 | ✅ 已注入 |
| `desktopStartup` | 运行模式元信息（portless/serve + port） | ✅ 已注入 |
| `directoryPicker` | ElectronDirectoryPicker（原生对话框替代 koffi FFI） | ✅ 已注入 |
| `desktop`（ctx.desktop） | 桌面聚合服务（审计总线 + 配置 + 下行事件） | ✅ 已注入 |
| `webServer`（等价面） | 内存路由注册表（compat，第三方插件 HTTP 原义） | ✅ 已注入 |

---

## 二、Client 侧 · 官方 Web 插件（boot-graph 自动扫描）

装载链：`scanClientPackages()` 扫描 `node_modules/@deepseek-ai` 下全部 `dsh.client.platform==='web'` → `__DSH_BOOT__` 图谱注入 index.html → 官方 BootRunner 全量激活 → 各插件经官方 Slots 组合出 UI。

### 1. 模块系统核心（4 个）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-client-modules` | 客户端模块系统 bootstrap（queue shim + createClientModuleSystem） | ✅ |
| `@deepseek-ai/dsh-client-runtime` | 客户端运行时（connection 消费方） | ✅ |
| `@deepseek-ai/dsh-client-connection` | 官方 Web 传输连接（AbstractApiClient 基类，D-9） | 🟠 预载注册 |
| `@deepseek-ai/dsh-client-locale` | 国际化 | ✅ |

### 2. 布局与导航（4 个）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-layout` | 官方整体布局骨架 | 🚫 被排除（桌面布局插件接管 root 槽位，D-18） |
| `@deepseek-ai/dsh-client-ui-sidebar` | 侧边栏壳：fold 折叠状态机 / 新会话按钮 / 5 子槽位声明 | 🚫 被排除（M6-P3 桌面侧栏壳接管，D-20；ui-workspace/ui-settings 经子槽位无改动继续工作） |
| `@deepseek-ai/dsh-client-ui-workspace` | 工作区切换与目录流 | ✅ |
| `@deepseek-ai/dsh-client-ui-brand-official` | 官方品牌标识 | ✅ |

### 3. 对话主区（8 个）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-conversation` | 对话主界面（消息流渲染） | ✅ |
| `@deepseek-ai/dsh-client-ui-renderer` | 消息渲染器（markdown/代码块） | ✅ |
| `@deepseek-ai/dsh-client-ui-input-trigger` | 输入框触发器 | ✅ |
| `@deepseek-ai/dsh-client-ui-attachment` | 附件上传 UI | ✅ |
| `@deepseek-ai/dsh-client-ui-reference` | 文件引用 UI | ✅ |
| `@deepseek-ai/dsh-client-ui-tool` | 工具调用展示（bash/fs/编辑器结果卡片） | ✅ |
| `@deepseek-ai/dsh-client-ui-user-questions` | 用户提问应答 UI | ✅ |
| `@deepseek-ai/dsh-client-ui-deliverables` | 产物文件尾注 + 可点击引用 | ✅ |

### 4. Agent 过程可视化（8 个）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-subagent` | 子代理过程展示 | ✅ |
| `@deepseek-ai/dsh-client-ui-plan` | 计划模式 UI | ✅ |
| `@deepseek-ai/dsh-client-ui-goal` | 目标管理 UI | ✅ |
| `@deepseek-ai/dsh-client-ui-jobs` | 后台任务 UI | ✅ |
| `@deepseek-ai/dsh-client-ui-skill` | 技能展示 | ✅ |
| `@deepseek-ai/dsh-client-ui-workflow-run` | 工作流运行节点 UI（durable workflow-run） | ✅ |
| `@deepseek-ai/dsh-client-ui-trajectory` | 轨迹/历史视图 | ✅ |
| `@deepseek-ai/dsh-client-ui-commands` | 斜杠命令 UI | ✅ |

### 5. 设置页（6 个）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-settings` | 设置页框架（settings.section 槽宿主） | ✅ |
| `@deepseek-ai/dsh-client-ui-settings-general` | 通用设置 section（General） | ✅ |
| `@deepseek-ai/dsh-client-ui-settings-models` | 模型设置 section | ✅ |
| `@deepseek-ai/dsh-client-ui-agent-preset` | Agent 预设选择器（数据源 = host agentPresets） | ✅ |
| `@deepseek-ai/dsh-client-ui-settings-plugins` | 插件面板（ui-cordis 联动） | ✅ |
| `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` | 插件清单 Tab（读 pluginInventory/list 等价面） | ✅ |

### 6. 其他 UI 域（6 个）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-theme` | 主题（ui-theme namespace；theme-sync 联动源） | ✅ |
| `@deepseek-ai/dsh-client-ui-slots` | 插槽系统（所有 UI 插件的组合底座） | ✅ |
| `@deepseek-ai/dsh-client-ui-model-selection` | 模型选择器 | ✅ |
| `@deepseek-ai/dsh-client-ui-permission-presets` | 权限预设 UI | ✅ |
| `@deepseek-ai/dsh-client-ui-cordis` | Cordis 插件面板（读 dynamicCordisRunner/inventory 等价面） | ✅ |
| `@deepseek-ai/dsh-client-ui-message-feedback` | 消息反馈（点赞/点踩） | ✅ |

### 7. 互斥与排除（2 个）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-directory-picker-native` | 目录选择 native 形态（与 prepare 注入的 Electron 版匹配） | ✅ |
| `@deepseek-ai/dsh-client-ui-directory-picker-browse` | 目录选择浏览器形态（single slot 冲突） | 🚫 被排除 |

---

## 三、桌面注入插件（@lansi-ai/dsh-*，boot-graph desktopDecls 显式声明）

### Client 半（renderer bundle，8 个）

| 插件 | 文件 | 作用 | 状态 |
|---|---|---|---|
| `@lansi-ai/dsh-ipc-connection` | `ipc-connection.js` | 零端口 IPC 载波（继承 AbstractApiClient，独占提供 connection 服务） | ✅ |
| `@lansi-ai/dsh-desktop-layout` | `desktop-layout-client.js` | **三列 grid 布局**（sidebar\|center\|details）+ ctx.layout 服务 + rAF 拖拽 + 窄屏折叠 + 官方主题 token（接管 root 槽位，D-18；inject: slots+theme） | ✅（M3-c3 实机验证待做） |
| `@lansi-ai/dsh-desktop-titlebar` | `desktop-titlebar-client.js` | 32px 拖拽顶栏 + 窗控三钮（desktopBridge.windowControl）+ 分割线探针（M3-c4） | ✅（随 M3-c3 验证） |
| `@lansi-ai/dsh-desktop-sidebar` | `desktop-sidebar-client.js` | 侧栏壳（M6-P3）：fold 状态机 + 新会话（workspaces.startSession）+ 5 子槽位声明（brand.mark/name、workspaces、settings、footer.action），官方 workspaces/settings 注册者无改动继续工作 | ✅（dev 实机验证待做） |
| `@lansi-ai/dsh-desktop-settings` | `desktop-settings-client.js` | 设置页「桌面」section（tray/通知/快捷键/自启 Toggle） | ✅ |
| `@lansi-ai/dsh-desktop-panel` | `desktop-panel-client.js` | 侧边栏底部悬浮面板入口（sidebar.footer.action 槽位） | ✅ |
| `@lansi-ai/dsh-desktop-audit-viewer` | `desktop-audit-viewer-client.js` | 会话审计查看器 Tab | ✅ |
| `@lansi-ai/dsh-desktop-cmdpalette` | `desktop-cmdpalette-client.js` | 命令面板（2026-08-27 禁用壳，仅留 quick-ask 聚焦） | ⛔ 已禁用 |

另：HTML 注入预置 `LAYOUT_SKELETON_CSS`（boot-graph 常量）——首帧布局骨架，防裸窗口期；内容归布局插件，与插件 CSS 同源两处同步。

### Host 半（主进程模块，M2 项目内模块形态，11 个）

| 模块 | 作用 | 状态 |
|---|---|---|
| `desktop-api.ts` | ctx.desktop 聚合服务（审计 JSONL / 配置 / 下行事件） | ✅ |
| `desktop-tray.ts` | 托盘 + 关窗驻留 + 快速问答 | ✅ |
| `desktop-notify.ts` | 系统通知（审批/错误/进展三类） | ✅ |
| `desktop-shortcuts.ts` | 全局快捷键（Alt+Shift+Q / Space） | ✅ |
| `desktop-clipboard.ts` | 剪贴板（写走 approval） | ✅ |
| `desktop-cmdpalette.ts` | 命令面板 host 半（Ctrl+Shift+P） | ✅ |
| `desktop-audit-viewer.ts` | 审计查询服务（过滤+分页） | ✅ |
| `desktop-autostart.ts` | 开机自启（OS 登录项唯一真源） | ✅ |
| `dsh-protocol.ts` | dsh:// 系统协议路由 | ✅ |
| `session-rewarm.ts` | 冷会话启动预热（坑 11） | ✅ |
| `compat-webserver.ts` | webServer 等价面（内存路由） | ✅ |

> Host 半插件包化（cordis.patch.yml + dsh.client 声明）排期 M5；titlebar 旧 executeJavaScript 注入方式已废弃（M3-c4）。

---

## 四、维护约定

- 架构变更（增删插件/改排除表）时更新本文与 `architecture-plugins.html`，两端一致。
- `CLIENT_EXCLUDE_IDS` 追加排除项时，同时更新 §二.7（互斥与排除）与被接管槽位说明。
- 上游升级（0.1.1-rc.2，旧载 rc.12 系臆测项）时逐条复核 Client 侧清单（可能有新增 ui-* 包），并核查桌面布局插件的 root 槽位契约（D-18 拴合面债）。
