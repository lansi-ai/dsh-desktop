# dsh-desktop 完整插件清单（Plugin Inventory）

> 真源：`src/desktop-host/boot.ts`（Host 树 §1+§4 insert）与 `src/desktop-host/boot-graph.ts`（Client 图谱 desktopDecls + CLIENT_EXCLUDE_IDS）。本文为派生视图，架构变更时同步更新。
> 命名规范（D-19）：桌面插件统一 `@lansi-ai/dsh-*`（蓝思 scope + dsh 生态前缀）。
> 状态更新至：**`0.1.2-alpha.4` 基线（2026-09-02 M4-d4）· M6-P2 首件自有化完成**。
> HTML 可视化版：`docs/architecture-plugins.html`（尚未同步 0.1.2 后状态，以本文为准）。

图例：✅ 已装载 · ⛔ 已禁用 · 🚫 被排除（不入图谱）· 🟠 预载注册（不激活）· 🔁 已自有化（官方件被桌面件替换）

---

## 〇、插件自有化进度（M6 · D-20 全量自绘路线）

> 路线（ADR-006 · D-20）：逐槽位替换官方 `ui-*` 直至全部自有，**数据面零新增**；每阶段可用可验证。
> 自有化铁律：**绝不改官方代码**——要么整体排除替换（互斥槽位），要么 host 半保留复用（双装配线，见下）；自有插件只在「槽位契约 + 服务面」咬官方，逐条登记 `upstream-contracts.md` §7。

### 进度总览

| 阶段 | 范围 | 状态 |
|---|---|---|
| **P1 布局骨架** | root 槽位（三列布局 + titlebar 行） | ✅ 完成（= M3-c，2026-09-01 实机验证通过） |
| **P2 外壳小件** | Session 导出（首件 ✅）→ brand 洞 → 会话 header 重排 | 🔄 1/3 |
| **P3 侧栏自研** | 侧栏壳（✅ 实机通过）+ 会话浏览区（`ui-workspace` 替换，W1-W5 计划） | 🔄 壳完成，内容未动 |
| **P4 对话主区** | `ui-conversation` + `ui-renderer` + input/attachment/reference | ⬜ 未开始（最大单件） |
| **P5 过程可视化** | tool/subagent/plan/goal/jobs/skill/workflow-run/trajectory | ⬜ 未开始 |
| **P6 设置与底座** | settings 6 section + theme/locale/model-selection/permission-presets | ⬜ 未开始 |

### 已自有化明细

| 官方包 | 桌面自有件 | 接管面 | host 半 | 状态 |
|---|---|---|---|---|
| `dsh-client-ui-layout` | `@lansi-ai/dsh-desktop-layout` | root 槽位（三列 grid + ctx.layout 服务）+ ThemePresenter 等价（坑 26） | — | ✅ 实机通过 |
| （无官方对应，宿主化骨架 D-21） | `desktop-appearance.ts` + `LAYOUT_SKELETON_CSS` | `--dsd-*` 外观变量 + 首帧骨架（防裸窗口期） | 宿主模块 | ✅ |
| （无官方对应，M3-c4） | `@lansi-ai/dsh-desktop-titlebar` | 布局 root 槽位 `titlebar` 行（拖拽区 + 窗控三钮 + 品牌区） | — | ✅ 实机通过 |
| `dsh-client-ui-sidebar` | `@lansi-ai/dsh-desktop-sidebar` | sidebar 槽位（fold 状态机 + 新会话 + 5 子槽位声明）；ui-workspace/ui-settings 经子槽位无改动继续工作 | — | ✅ 实机通过（2026-09-01） |
| `dsh-session-log-export`（client 半） | `@lansi-ai/dsh-desktop-session-export` | `conversation.session.header.utilities` 槽位（导出胶囊 + 结果弹层，文案修正桌面语义） | **保留复用**（boot.ts `session-log-download` 行：/export 命令 + `/api/session.export` ZIP 流式路由） | ✅ 实机通过（2026-09-02，M6-P2 首件） |

> **双装配线先例**（session-log-export，自有化方法论第 18 条的实践）：官方双面包的 client 半被排除替换时，host 半经 boot.ts 照常装载提供数据面——自有件零重复实现。

### 互斥排除清单（CLIENT_EXCLUDE_IDS）

| 被排除包 | 原因 |
|---|---|
| `dsh-client-ui-layout` | root 槽位互斥（桌面布局插件接管，D-18） |
| `dsh-client-ui-sidebar` | sidebar 槽位互斥（M6-P3 壳接管，D-20） |
| `dsh-client-ui-directory-picker-browse` | 与 native 形态 single slot 冲突（桌面走 Electron chooser） |
| `dsh-session-log-export` | 导出 UI 自有化（client 半；host 半保留，见上） |
| `dsh-client-hmr` | dev SSE `/plugins/events` 桌面不存在，轮询必 404（终端静音） |
| `dsh-cordis-client-runner` + `dsh-client-ui-cordis` | 动态双半插件子系统对端 host-runner 已禁用（零端口架构）；插件清单经 cordis-inventory 兼容面在设置页查看 |

### 自有化待办（按阶段）

- **P2**：`dsh-desktop-brand`（sidebar.brand.mark/name 洞）、会话 header 重排评估（TRAE 式会话名 + 按钮组）
- **P3**：`dsh-desktop-workspaces`（全量复刻 ui-workspace，摸底已完成，W1-W5 原子提交计划）
- **P4-P6**：见上表（启动前需逐件摸底登记）

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
| `@deepseek-ai/dsh-workspace` | 工作区注册表 | ✅ |

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

### 6. 工具集（16 条）

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

> ~~`dsh-tool-subagent-report`~~ **已移除（0.1.2-alpha.4）**：`send_message` 取代单向 `report`（并入 dsh-tool-subagent 本体），独立包官方未再发布 alpha.4，roster 残留条目致 loader import 失败（M4-d4 收口）。

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

### 9. API 载波与网关（7 条，0.1.2 重构后形态）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-client-connection`（host 半） | HostConnectionHandle：`createSharedFetchHandler('/api')`（unary 背板） | ✅ |
| `@deepseek-ai/dsh-api-gateway` | typertGateway（逻辑流 `wireStream.open` 背板，坑 12） | ✅ |
| `@deepseek-ai/dsh-typert-registry` | Typert 注册表 | ✅ |
| `@deepseek-ai/dsh-typert-loader` | Typert 加载器 | ✅ |
| `@deepseek-ai/dsh-api-remotes` | `$events` forwarded 事件源（0.1.2 必备） | ✅ |
| `dsh-api-session-controller` / `settings-controller` / `workspace-controller` | 三 controller（0.1.2 必备，缺则 unary 404/流 "no active Remote method"） | ✅ |
| `@deepseek-ai/dsh-message-feedback` | 消息反馈 Remote（messageFeedback/list\|put\|delete） | ✅ |

> ~~`@deepseek-ai/dsh-host-apiproxy`~~ **已删除（0.1.2）**：`AbstractApiClient`/apiProxy 整体不存在，RPC 通道由 connection unary + typertGateway 逻辑流两通道取代（M4-d3 迁移，详见 `upstream-contracts.md` §1/§2）。

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
| `@deepseek-ai/dsh-client-ui-settings-general`（host 半） | ui-onboarding settings namespace（进入官方 UI 必需，坑 7） | ✅ |

### 13. 功能 host 行（双面/命令域，4 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-session-log-export`（host 半） | `/export` 命令 + `/api/session.export` ZIP 流式路由（session-log-download 行；client 半已自有化替换） | ✅ |
| `@deepseek-ai/dsh-tool-subagent/model-selection-settings` | 子代理模型选择设置（缺则 preset mount 报错） | ✅ |
| `@deepseek-ai/dsh-client-ui-theme` 等 4 个双面包 host 半 | ui-theme/locale/ui-chat/ui-conversation 的 settings namespace 注册（坑 26） | ✅ |
| `@deepseek-ai/dsh-host-plugin-inventory` | 官方插件清单（pluginInventory/list，设置页「插件列表」Tab） | ✅ |

### 14. 基础设施与第三方（4 条）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/cordis-plugin-timer` | 定时器服务 | ✅ |
| `@deepseek-ai/cordis-plugin-hmr` | 热重载（桌面不需要） | ⛔ 已禁用 |
| `@lnyanhongyan/dsh-opencode-usage` | 第三方用量统计 | ⛔ 暂移除（0.1.2 不兼容，待其升版重装） |
| webserver / web-runtime / web-startup / client-hmr / cordis-host-runner | 官方 Web 传输层与动态装载器（禁用 = 零端口红线；host-runner 未装载致 `dynamicCordisRunner/*` 部分不可用，M5 评估） | ⛔ 已禁用 |

### 15. Host 进程内注入（prepare 钩子，非插件，5 项）

| 服务 | 作用 | 状态 |
|---|---|---|
| `cmdlineArgs` | provideCmdline 命令行参数服务 | ✅ 已注入 |
| `desktopStartup` | 运行模式元信息（portless/serve + port） | ✅ 已注入 |
| `directoryPicker` | ElectronDirectoryPicker（原生对话框替代 koffi FFI） | ✅ 已注入 |
| `desktop`（ctx.desktop） | 桌面聚合服务（审计总线 + 配置 + 下行事件） | ✅ 已注入 |
| `webServer`（等价面） | 内存路由注册表（compat，第三方插件 HTTP 原义） | ✅ 已注入 |

---

## 二、Client 侧 · 官方 Web 插件（boot-graph 自动扫描）

装载链：`scanClientPackages()` 扫描 `node_modules/@deepseek-ai` 下全部 `dsh.client.platform==='web'` → `__DSH_BOOT__` 图谱（`{rev, entries, batches}`）注入 index.html → 官方 BootRunner 全量激活（CLIENT_EXCLUDE_IDS 除外）→ 各插件经官方 Slots 组合出 UI。

> 本节为**功能域摘要**（非逐包全量；0.1.2 图谱共 54 条目，全量清单经设置页「插件列表」Tab 读 `pluginInventory/list` 查看）。store/ui-slots 由官方 dist 内核 PLATFORM_MODULES seed，不入图。

### 1. 模块系统核心（3 个）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-client-modules` | 客户端模块系统 bootstrap（0.1.2 PARSER_PRELOAD_IDS 仅含它） | ✅ |
| `@deepseek-ai/dsh-client-connection` | 官方传输连接（0.1.2：读页面全局 `__DSH_TRANSPORT__` 自行 provide ctx.connection，桌面 HTML boot 脚本注入 IPC 传输） | ✅ |
| `@deepseek-ai/dsh-client-locale` | 国际化 | ✅ |

> ~~`dsh-client-runtime`~~ **已删除（0.1.2）**：runtime 重组拆包，store 迁 `dsh-client-store`（由官方 dist 内核 seed）。

### 2. 布局与导航（4 个）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-layout` | 官方整体布局骨架 | 🔁 已自有化（桌面布局插件接管 root 槽位，D-18） |
| `@deepseek-ai/dsh-client-ui-sidebar` | 侧边栏壳：fold 折叠状态机 / 新会话按钮 / 5 子槽位声明 | 🔁 已自有化（M6-P3 桌面侧栏壳接管；ui-workspace/ui-settings 经子槽位无改动继续工作） |
| `@deepseek-ai/dsh-client-ui-workspace` | 工作区切换与目录流（P3 待自有化） | ✅ |
| `@deepseek-ai/dsh-client-ui-brand-official` | 官方品牌标识（P2 待自有化 brand 洞） | ✅ |

### 3. 对话主区（8 个）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-conversation` | 对话主界面（消息流渲染；声明 `conversation.session.header.utilities` 槽位） | ✅ |
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
| `@deepseek-ai/dsh-client-ui-settings-plugins` | 插件面板 | ✅ |
| `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` | 插件清单 Tab（读 pluginInventory/list 等价面） | ✅ |

### 6. 其他 UI 域（6 个）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-theme` | 主题（ui-theme namespace；client 半发 theme/change，DOM 应用由桌面 ThemePresenter 承担——坑 26） | ✅ |
| `@deepseek-ai/dsh-client-ui-slots` | 插槽系统（所有 UI 插件的组合底座，官方内核 seed） | ✅ |
| `@deepseek-ai/dsh-client-ui-model-selection` | 模型选择器 | ✅ |
| `@deepseek-ai/dsh-client-ui-permission-presets` | 权限预设 UI | ✅ |
| `@deepseek-ai/dsh-client-ui-message-feedback` | 消息反馈（点赞/点踩） | ✅ |
| `@deepseek-ai/dsh-session-log-export`（client 半） | Session 日志导出 UI（header 导出胶囊 + 结果弹层） | 🔁 已自有化（M6-P2 首件） |

### 7. 互斥与排除（2 个 + 6 项，见 §〇 排除清单）

| 插件 | 作用 | 状态 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-directory-picker-native` | 目录选择 native 形态（与 prepare 注入的 Electron 版匹配） | ✅ |
| `@deepseek-ai/dsh-client-ui-directory-picker-browse` | 目录选择浏览器形态（single slot 冲突） | 🚫 被排除 |

> 其余排除项（ui-layout / ui-sidebar / session-log-export / hmr / cordis-client-runner / ui-cordis）见 §〇「互斥排除清单」。

---

## 三、桌面注入插件（@lansi-ai/dsh-*，boot-graph desktopDecls 显式声明）

### Client 半（renderer bundle，9 个）

| 插件 | 文件 | 作用 | 状态 |
|---|---|---|---|
| `@lansi-ai/dsh-ipc-connection` | `ipc-connection.js` | 零端口 IPC 载波占位（0.1.2：传输经 HTML boot 脚本注入 `__DSH_TRANSPORT__`，官方 client-connection 自行 provide connection；本条目为图谱激活占位） | ✅ |
| `@lansi-ai/dsh-desktop-layout` | `desktop-layout-client.js` | **三列 grid 布局**（sidebar\|center\|details）+ ctx.layout 服务 + rAF 拖拽 + 窄屏折叠 + ThemePresenter 等价 + 官方主题 token（接管 root 槽位，D-18；inject: slots+theme） | ✅（2026-09-01 实机验证通过） |
| `@lansi-ai/dsh-desktop-titlebar` | `desktop-titlebar-client.js` | titlebar 行：品牌区（官方 FishLogo/BrandWordmark，坑 23）+ 折叠钮 + 中部拖拽区 + 窗控三钮；**v5：logo + 窗控四枚 + 折叠两枚全部支持主题槽位 `icons/titlebar-*.svg`**（状态对成对提供才启用，缺失回退内置，peekSvg 防首帧空窗）（inject: slots+layout+themeIcon） | ✅（2026-09-04 v5，待实机点验） |
| `@lansi-ai/dsh-desktop-sidebar` | `desktop-sidebar-client.js` | 侧栏壳（M6-P3）：fold 状态机 + 新会话（workspaces.startSession）+ 5 子槽位声明（brand.mark/name、workspaces、settings、footer.action），官方 workspaces/settings 注册者无改动继续工作 | ✅（2026-09-01 实机验证通过） |
| `@lansi-ai/dsh-desktop-session-export` | `desktop-session-export-client.js` | Session 日志导出 UI（M6-P2 首件）：header 导出胶囊 + 结果弹层 + 下载 controller，文案修正桌面语义；host 半官方保留 | ✅（2026-09-02 实机验证通过） |
| `@lansi-ai/dsh-desktop-settings` | `desktop-settings-client.js` | 设置页「桌面」section（tray/通知/快捷键/自启 Toggle） | ✅ |
| `@lansi-ai/dsh-desktop-theme` | `desktop-theme-client.js` | 设置页「外观」section，**由上至下四项一级设置项**：① 应用图标 ② 托盘图标 ③ 品牌 logo（三项 global，存 `userData/icons/` 全局单份、不随包切换）④ 图标包（卡片网格 + 新建包，其下二级=界面图标需求清单：默认折叠、按消费方插件分组卡、行内上传·替换）；槽位真源 = host `ICON_SLOTS`（D-23；坑 27/28/29/30） | ✅（2026-09-04 重构，待实机点验） |
| `@lansi-ai/dsh-desktop-audit-viewer` | `desktop-audit-viewer-client.js` | 会话审计查看器 Tab | ✅ |
| `@lansi-ai/dsh-desktop-conversation-visuals` | `desktop-conversation-visuals-client.js` | 对话区视觉层（data-phase 圆角/裁剪样式，不接管 conversation 槽位） | ✅ |
| `@lansi-ai/dsh-desktop-cmdpalette` | `desktop-cmdpalette-client.js` | 命令面板（2026-08-27 禁用壳，仅留 quick-ask 聚焦） | ⛔ 已禁用 |

> ~~`@lansi-ai/dsh-desktop-panel`~~ **已下线**（`feat(plugins)!` dabdae0，随侧栏触发按钮一并撤下）。

另：HTML 注入预置 `LAYOUT_SKELETON_CSS`（boot-graph 常量）——首帧布局骨架，防裸窗口期；内容归布局插件，与插件 CSS 同源两处同步。

### Host 半（主进程模块，M2 项目内模块形态，16 个）

| 模块 | 作用 | 状态 |
|---|---|---|
| `desktop-api.ts` | ctx.desktop 聚合服务（审计 JSONL / 配置 / 下行事件） | ✅ |
| `desktop-tray.ts` | 托盘 + 关窗驻留 + 快速问答 | ✅ |
| `desktop-notify.ts` | 系统通知（审批/错误/进展三类，0.1.2 host 事件直订阅） | ✅ |
| `desktop-shortcuts.ts` | 全局快捷键（Alt+Shift+Q / Space） | ✅ |
| `desktop-clipboard.ts` | 剪贴板（写走 approval） | ✅ |
| `desktop-cmdpalette.ts` | 命令面板 host 半（Ctrl+Shift+P） | ✅ |
| `desktop-audit-viewer.ts` | 审计查询服务（过滤+分页） | ✅ |
| `desktop-autostart.ts` | 开机自启（OS 登录项唯一真源） | ✅ |
| `desktop-appearance.ts` | `--dsd-*` 外观变量注入（D-21 骨架宿主化外观契约） | ✅ |
| `theme-sync.ts` | 主题同步（0.1.2 host 事件双路直订阅，坑 22/26） | ✅ |
| `connection-fetch-bridge.ts` | connection fetch 桥（非 POST `/api/` 同源请求 → host connection 共享处理器，导出链路） | ✅ |
| `window-manager.ts` | 多窗口 WindowManager（会话独立窗口 + 广播） | ✅ |
| `dsh-protocol.ts` | dsh:// 系统协议路由 | ✅ |
| `session-rewarm.ts` | 冷会话启动预热（坑 11；0.1.2 wire 契约对齐坑 24） | ✅ |
| `cordis-inventory.ts` | 插件清单兼容面（pluginInventory/list 等价服务） | ✅ |
| `compat-webserver.ts` | webServer 等价面（内存路由） | ✅ |

> Host 半插件包化（cordis.patch.yml + dsh.client 声明）排期 M5。

---

## 四、维护约定

- 架构变更（增删插件/改排除表）时更新本文；`architecture-plugins.html` 尚未同步 0.1.2 后状态，同步前以本文为准。
- `CLIENT_EXCLUDE_IDS` 追加排除项时，同步更新 §〇「互斥排除清单」与 §二 对应行（🔁 标记）。
- 每完成一件自有化（新 `@lansi-ai/dsh-*` 替换官方件）：更新 §〇「进度总览 + 已自有化明细」+ §二/§三 对应行，并在 `upstream-contracts.md` §7 登记契约矩阵行。
- 上游升级时：先对照 `upstream-contracts.md` §7 逐条核对自有插件契约，再复核本文 Host/Client 两侧清单（ui-* 包可能有增删，如 alpha.4 的 tool-subagent-report 废除先例）。
