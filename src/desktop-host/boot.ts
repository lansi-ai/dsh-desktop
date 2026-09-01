/**
 * dsh-desktop Cordis Host 装配（M1·步骤3 + Step 6·--serve 兼容模式）。
 *
 * 复用 @deepseek-ai/dsh-app-boot 的 boot() 启动完整 Cordis 插件树，
 * 默认模式（零端口）：通过 overlay patches 禁用 Web 传输层条目，保留核心 host 服务
 *   （llm/session/agent/sandbox/fs），所有通信走 Electron IPC 载波。
 * --serve 兼容模式：显式启用 webserver/web-runtime/web-startup，供第三方 webServer
 *   路由插件（如 dsh-terminal 的 /terminal/stream）走 HTTP 原义，loopback 监听。
 * prepare 钩子中调用 provideCmdline() 注入 cmdlineArgs 服务。
 *
 * 补丁值策略：所有原 cordis.patch.yml 中的 !!js 表达式均在 TypeScript 中直接求值，
 * 不依赖 Cordis Loader 的 __jsExpr 运行时求值管道（该管道仅在 Include YAML 解析阶段激活，
 * 而 overlay patches 作为 JS 对象直接传入 boot() 时跳过了该阶段）。
 */

import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { app } from 'electron'
import { log } from './log.js'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include' with { 'resolution-mode': 'import' }

// 运行时数据根目录（M4-a1·打包路径适配）：
// 开发模式 → 项目内 .runtime（随仓库可清理）；打包模式 → 系统 userData 下 .runtime
// （asar 只读不可写，R7 硬编码路径的打包态收口；完整可配置化留 M5）。
const RUNTIME_ROOT = app.isPackaged
  ? join(app.getPath('userData'), '.runtime')
  : join(__dirname, '..', '..', '.runtime')

/** boot 启动选项（含 Step 6 --serve 兼容模式）。 */
export interface BootOptions {
  /** 自定义 configPath（省略时自动生成于 .runtime/）。 */
  readonly configPath?: string
  /** 自定义 overlay patches（省略时按 serveMode 自动生成）。 */
  readonly patches?: PatchOptions[]
  /** 裸模块解析基 URL（Electron 打包后指向 resources/app/node_modules）。 */
  readonly bareModuleBaseUrl?: string
  /**
   * 是否启用 --serve 兼容模式（默认 false）。
   *
   * 启用时会：
   *   - 解除 DESKTOP_OVERLAY_PATCHES 中对 webserver/web-runtime/web-startup
   *     的 disabled 标记
   *   - 在 prepare 钩子注入 desktopStartup 元信息（供第三方路由插件判定运行模式）
   *
   * @default false（零端口 IPC 载波模式）
   */
  readonly serveMode?: boolean
  /** --serve 监听端口（serveMode=true 时有效；默认 38000）。 */
  readonly servePort?: number
  /** 审计日志文件路径（M3-b2，JSONL 格式）。 */
  readonly auditLogPath?: string
}

// ── Desktop profile overlay patches ─────────────────────────────────────────
/**
 * 桌面 overlay 补丁栈（顺序重要：后写覆盖前写）。
 *
 * 结构对齐 dsh-base cordis.patch.yml（insert）+ dsh-web-app cordis.patch.yml（id 覆盖），
 * 并叠加 desktop 特定补丁：禁用 webserver/web-runtime/web-startup/connection/client-*，
 * 覆盖 system-prompt persona 为桌面版本。
 *
 * 所有 !!js 表达式已在 TS 中求值为具体值（见文件头部注释）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DESKTOP_OVERLAY_PATCHES: any[] = [
  // ── §1 dsh-base insert（全量核心 host 服务）──────────────────────────────
  {
    insert: [
      { id: 'timer', name: '@deepseek-ai/cordis-plugin-timer' },
      { id: 'hmr', name: '@deepseek-ai/cordis-plugin-hmr', config: { root: ['.'] }, disabled: true },
      { id: 'llm', name: '@deepseek-ai/dsh-llm' },
      { id: 'session', name: '@deepseek-ai/dsh-session' },
      { id: 'typert', name: '@deepseek-ai/dsh-typert-registry' },
      { id: 'typert-loader', name: '@deepseek-ai/dsh-typert-loader' },
      { id: 'typert-gateway', name: '@deepseek-ai/dsh-api-gateway' },
      // 0.1.2 传输背板：host 侧 connection(HostConnectionHandle) + api-remotes($events 源)。
      //   connection：官方 host 半提供 `ctx.connection.createSharedFetchHandler('/api')` 等
      //     （桌面经 bridge 转发 unary/逻辑流，见 main.ts 第 4 步）；
      //   api-remotes：注册 `$events` forwarded Remote 事件源（api-gateway 消费），
      //     host 端事件（api-session/*、settings/document-updated、approval/request 等）
      //     经它泵给 renderer 的 ClientRemoteEvents。inject ['typertGateway']。
      { id: 'api-remotes', name: '@deepseek-ai/dsh-api-remotes' },
      // host 侧 connection（官方 `@deepseek-ai/dsh-client-connection` 的 host 半）：
      // 提供 `ctx.connection.createSharedFetchHandler('/api')`（unary 面）。inject 需
      // webServer（由 prepare 钩子注入的 compat 等价面提供）+ credentials（base 已装）。
      // 官方 host connection 不绑定端口（只在 webServer 注册 /api 前缀路由，零监听 stub）。
      { id: 'host-connection', name: '@deepseek-ai/dsh-client-connection' },
      // 0.1.2 API controllers（web-app bundle L91-101 等价行）：typertGateway 解析
      // session/*、settings/*、credentials/*、workspace/* Remote endpoint 的前提。
      // 缺此三行 → createSharedFetchHandler 对这些端点返回 404、流端点 "no active Remote
      // method"（实机 2026-09-01 定位）。依赖服务（agents/llm/session/settings/credentials/
      // workspaceRegistry/typert 等）均已在上方或 base 补丁装配。
      { id: 'session-controller', name: '@deepseek-ai/dsh-api-session-controller' },
      { id: 'settings-controller', name: '@deepseek-ai/dsh-api-settings-controller' },
      { id: 'workspace-controller', name: '@deepseek-ai/dsh-api-workspace-controller' },
      // directoryPicker 服务：ApiProxyService.inject 必需。官方 -auto 版依赖 webServer
      // （已禁用），改为在 prepare 钩子直接实例化 native 版注入（见 boot() 内注释），
      // 此处不设 cordis 条目，避免 auto 版因缺 webServer 激活失败。
      // workspaceRegistry 服务：ApiProxyService.inject 必需（inject storageDomain+sessionPersistence）
      { id: 'workspace', name: '@deepseek-ai/dsh-workspace' },
      { id: 'session-title', name: '@deepseek-ai/dsh-session-title', config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
      { id: 'session-title-llm', name: '@deepseek-ai/dsh-session-title-first-prompt-llm', config: { targetWords: 5, targetCjkCharacters: 10, maxInputBytes: 4096, maxOutputTokens: 64, timeoutMs: 60000 } },
      { id: 'user-questions', name: '@deepseek-ai/dsh-user-questions' },
      { id: 'agent', name: '@deepseek-ai/dsh-agent' },
      { id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
      { id: 'jobs', name: '@deepseek-ai/dsh-jobs-local' },
      { id: 'llm-retry', name: '@deepseek-ai/dsh-llm-retry' },
      { id: 'settings', name: '@deepseek-ai/dsh-settings-file' },
      { id: 'credentials', name: '@deepseek-ai/dsh-credentials-local' },
      { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' },
      // session-persistence-jsonl: !!js dshHomePath('sessions') → 使用运行时数据根下的 sessions 目录
      // 开发模式：userData 在 main.ts 中重定向至 .runtime/user-data；打包模式：RUNTIME_ROOT（系统 userData）
      { id: 'session-persistence-jsonl', name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(RUNTIME_ROOT, 'user-data', 'sessions') } },
      { id: 'attachment-local', name: '@deepseek-ai/dsh-attachment-local' },
      { id: 'session-query-sqlite', name: '@deepseek-ai/dsh-session-query-sqlite', config: { path: ':memory:', openAt: 'never' } },
      { id: 'session-projection', name: '@deepseek-ai/dsh-session-projection' },
      {
        id: 'session-telemetry-otel',
        name: '@deepseek-ai/dsh-session-telemetry-otel',
        config: {
          // !!js process.env.DSH_TELEMETRY_MODE || 'DISABLED'
          mode: process.env.DSH_TELEMETRY_MODE || 'DISABLED',
          shutdownTimeoutMillis: 3000,
          exporter: {
            // !!js process.env.DSH_TELEMETRY_OTLP_URL ?? 'https://...'
            url: process.env.DSH_TELEMETRY_OTLP_URL ?? 'https://harness-telemetry.deepseeksvc.com/v1/logs',
            compression: 'gzip',
            timeoutMillis: 1000,
          },
          processor: { scheduledDelayMillis: 10000, maxQueueSize: 2048, maxExportBatchSize: 2048, exportTimeoutMillis: 1500 },
        },
      },
      { id: 'subprocess', name: '@deepseek-ai/dsh-subprocess-local' },
      { id: 'sandbox', name: '@deepseek-ai/dsh-sandbox-local' },
      {
        id: 'sandbox-policy',
        name: '@deepseek-ai/dsh-sandbox-policy',
        config: {
          // !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
          mode: process.env.DSH_PERMISSION_MODE ?? 'workspace-write',
          // !!js process.cwd()
          workspaceRoot: process.cwd(),
        },
      },
      { id: 'bash-sandbox', name: '@deepseek-ai/dsh-bash-sandbox', disabled: process.platform === 'win32', config: { timeoutMs: 60000 } },
      { id: 'pwsh-sandbox', name: '@deepseek-ai/dsh-pwsh-sandbox', disabled: process.platform !== 'win32' },
      {
        id: 'approval',
        name: '@deepseek-ai/dsh-user-approval',
        config: {
          // !!js "(process.env.DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask'"
          policy: (process.env.DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask',
        },
      },
      { id: 'permission', name: '@deepseek-ai/dsh-permission-presets', config: { presets: { 'read-only': { sandbox: 'read-only', approval: 'ask' }, 'workspace-write': { sandbox: 'workspace-write', approval: 'ask' }, 'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' } } } },
      { id: 'shell-env', name: '@deepseek-ai/dsh-shell-env' },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: process.platform === 'win32' },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: process.platform !== 'win32' },
      { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
      { id: 'fs-observation-policy', name: '@deepseek-ai/dsh-fs-observation-policy' },
      { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
      { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
      { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
      { id: 'skill', name: '@deepseek-ai/dsh-skill' },
      { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
      { id: 'skill-badge', name: '@deepseek-ai/dsh-skill-badge', disabled: true },
      { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
      { id: 'commands', name: '@deepseek-ai/dsh-commands' },
      { id: 'command-feedback', name: '@deepseek-ai/dsh-command-feedback' },
      // messageFeedback host 服务（消息赞/踩+备注 sidecar）：官方 UI 的
      // dsh-client-ui-message-feedback（客户端半，渲染 assistant 消息动作条）会调
      // messageFeedback/list|put|delete Remote；缺此服务 → typertGateway 404
      // （[dsh-bridge] RPC 失败 (messageFeedback/list) HTTP 404，实机 2026-09-01）。
      // 纯 cordis service 库（static inject: storageDomain/sessionPersistence/sessions，
      // 三者本清单均已装载）；maxNoteBytes 对齐官方 Web bundle（8192）。
      { id: 'message-feedback', name: '@deepseek-ai/dsh-message-feedback', config: { maxNoteBytes: 8192 } },
      { id: 'goal', name: '@deepseek-ai/dsh-goal' },
      { id: 'goal-round-driver', name: '@deepseek-ai/dsh-goal-round-driver' },
      { id: 'command-goal', name: '@deepseek-ai/dsh-command-goal' },
      { id: 'plan-mode', name: '@deepseek-ai/dsh-plan-mode', config: { section: 'You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode.' } },
      { id: 'token-meter', name: '@deepseek-ai/dsh-token-meter' },
      { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
      { id: 'subagent', name: '@deepseek-ai/dsh-subagent' },
      { id: 'subagent-spawn-in-process', name: '@deepseek-ai/dsh-subagent-spawn-in-process', config: { providerName: 'spawn' } },
      { id: 'subagent-fork-in-process', name: '@deepseek-ai/dsh-subagent-fork-in-process', config: { providerName: 'fork' } },
      { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
      { id: 'tool-subagent-list-agents', name: '@deepseek-ai/dsh-tool-subagent-control/list-agents' },
      { id: 'tool-subagent', name: '@deepseek-ai/dsh-tool-subagent', config: { provider: 'spawn', toolName: 'subagent', backgroundMode: 'continuable' } },
      { id: 'tool-subagent-fork', name: '@deepseek-ai/dsh-tool-subagent', config: { provider: 'fork', toolName: 'subagent_fork', backgroundMode: 'one-shot' } },
      { id: 'tool-subagent-report', name: '@deepseek-ai/dsh-tool-subagent-report' },
      // 0.1.2：subagent 模型选择设置（Host 平面顶层，对齐官方 web-app insert）。
      // 缺此服务时，任何带 `modelSelectionSettings: true` 的 tool-subagent 装载
      // （含恢复历史会话）会抛 "requires @deepseek-ai/dsh-tool-subagent/model-selection-settings
      // in the Host scope"（实机 2026-09-01 定位）。依赖 settings（settings-file 已装）。
      { id: 'subagent-model-selection-settings', name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings' },
      { id: 'workflow-worker-thread', name: '@deepseek-ai/dsh-workflow-worker-thread', config: { provider: 'spawn' } },
      { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
      { id: 'timeout-policy', name: '@deepseek-ai/dsh-tool-call-timeout-policy' },
      { id: 'spill-local', name: '@deepseek-ai/dsh-spill-local' },
      { id: 'spill-policy', name: '@deepseek-ai/dsh-spill-policy', config: { maxInlineBytes: 50000 } },
      { id: 'session-checkpoint-policy', name: '@deepseek-ai/dsh-session-checkpoint-policy' },
      { id: 'tool-result-pruner', name: '@deepseek-ai/dsh-compaction-tool-result-pruner', config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 } },
      { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
      { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },
      { id: 'tool-ralph', name: '@deepseek-ai/dsh-tool-ralph', config: { subagentProvider: 'spawn', maxRounds: 64 } },
      { id: 'tool-str-replace-editor', name: '@deepseek-ai/dsh-tool-str-replace-editor', config: { maxOutputChars: 16000 } },
      { id: 'repeat-tool-reminder', name: '@deepseek-ai/dsh-repeat-tool-reminder', config: { thresholds: [3, 5, 8], argumentsPreviewChars: 500 } },
      { id: 'web', name: '@deepseek-ai/dsh-web', config: { searchProvider: 'deepseek-official' } },
      { id: 'web-search-deepseek', name: '@deepseek-ai/dsh-web-search-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
      { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: false, searchTimeoutMs: 60000 } },
      { id: 'tools', name: '@deepseek-ai/dsh-tools' },
      // ui-settings-general host 面条目：注册 `ui-onboarding` settings namespace，
      // 供官方 UI 的内测声明/onboarding 写入（client 面经 settings.mutate 打到 host settings，
      // 缺此 namespace 会报 "settings namespace ui-onboarding is not registered" 拦截进入）。
      { id: 'ui-settings-general', name: '@deepseek-ai/dsh-client-ui-settings-general' },
      { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { persona: '' } },
      { id: 'agent-loop', name: '@deepseek-ai/dsh-agent-loop', config: { agents: [] } },
      { id: 'fs-sandbox', name: '@deepseek-ai/dsh-fs-sandbox' },
      { id: 'llm-deepseek', name: '@deepseek-ai/dsh-llm-deepseek' },
      // 注：第三方插件 @lnyanhongyan/dsh-opencode-usage 因 peer 锁 rc.7 与 0.1.2 不兼容，
      // 已在 M4-d3 升级轮移除（package.json 依赖 + 本 insert + THIRD_PARTY_CLIENT_IDS）。
      // 待其升版后按 M1 门禁 ADR-007 重新装载。
    ],
  },

  // ── §2 dsh-web-app 选择性覆盖（桌面 persona）─────────────────────────────
  { id: 'system-prompt', config: { persona: 'You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.' } },
  { id: 'session-query-sqlite', config: { path: ':memory:', openAt: 'never' } },

  // ── §3 禁用 Web 传输层 + 启用 0.1.2 IPC 载波变体 ────────────────
  // 零端口：禁用官方 webserver/web-runtime/web-startup/modules（host 传输层绑定端口）。
  // api-remotes 不再禁用——0.1.2 中它是 $events 转发源（renderer 经 __DSH_TRANSPORT__
  // 逻辑流拉取），必须激活（§1 已 insert，此处不再打 disabled）。
  { id: 'webserver', disabled: true },
  { id: 'web-runtime', disabled: true },
  { id: 'web-startup', disabled: true },
  { id: 'modules', disabled: true },
  { id: 'client-hmr', disabled: true },
  { id: 'cordis-client-runner', disabled: true },
  { id: 'cordis-host-runner', disabled: true },
  // 0.1.2 IPC 载波替换：不再禁用 connection（官方 host connection 提供
  // createSharedFetchHandler，是桌面传输背板的核心）；client-runtime 已删（无此行）。
  // 历史补丁条目（getIpcCarrierPatchEntries）已废弃，见 manifest.ts。

  // ── §4 桌面特定条目（storage + agent-presets）────────────────────────────
  // storage-json: root 用项目 .runtime/user-data/storages（R7：dshHomePath 服务可用前
  // 以硬编码路径兜底，待服务就绪后切回 !!js dshHomePath('storages') 语义）。
  // 链条：storage(提供 ctx.storage) → storage-json(注册 json backend 服务) →
  //        storage-domain(提供 ctx.storageDomain) → workspace(提供 ctx.workspaceRegistry)
  //        → host-apiproxy(提供 ctx.apiProxy + events.mux/host)。
  // agent-presets：M2·官方 UI 设置面板 agent 预设选择器数据源。
  // 坑 16：cordis-plugin-include 的非 insert 补丁（{id,name,config}）只按 id 覆盖
  // 已存在条目，根配置为空 [] 时是静默 no-op——此前该条目不带 insert 键，
  // dsh-agent-presets 插件从未装载（agentPresets 服务 undefined → 设置页纯空白，
  // 页面对空 roster/未装载均不渲染不报错）。必须经 insert 数组进插件树。
  {
    insert: [
      { id: 'storage', name: '@deepseek-ai/dsh-storage' },
      { id: 'storage-json', name: '@deepseek-ai/dsh-storage-json', config: { root: join(RUNTIME_ROOT, 'user-data', 'storages') } },
      { id: 'storage-domain', name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
      // roots 指向仓库随附的裁剪预设（仅用已装插件，避免缺依赖导致 mount 失败）。
      {
        id: 'agent-presets',
        name: '@deepseek-ai/dsh-agent-presets',
        config: {
          default: 'standard',
          roots: [{ path: join(__dirname, '..', 'resources', 'agent-presets'), trust: 'system' }],
        },
      },
    ],
  },
]

// ── 空根配置生成 ────────────────────────────────────────────────────────────
/**
 * 生成空 cordis.yml 根配置文件（`[]`）。
 * Loader 需要真实文件路径作为 Include 根锚点，所有实际配置由 overlay patches 覆盖。
 * 文件写入 .runtime/ 临时目录（随仓库可清理，不污染 src/dist）。
 * @returns cordis.yml 的绝对路径。
 */
function createRootConfig(): string {
  mkdirSync(RUNTIME_ROOT, { recursive: true })
  const configPath = join(RUNTIME_ROOT, 'cordis.yml')
  writeFileSync(configPath, '# dsh-desktop profile root — 所有配置由 desktop-patch.yml overlay 补丁覆盖。\n[]\n')
  return configPath
}

// ── 入口函数 ────────────────────────────────────────────────────────────────

/**
 * 根据 serveMode 构造最终 overlay patches（Step 6 兼容模式切换）。
 *
 * 默认模式（portless）：沿用 DESKTOP_OVERLAY_PATCHES，webserver/web-runtime/
 *   web-startup 保持 disabled，connection/client-runtime 由 IPC 载波变体替代。
 * --serve 模式：解除 webserver/web-runtime/web-startup 的 disabled 标记，
 *   使第三方 webServer 路由插件（dsh-terminal 等）恢复 HTTP 原义路径。
 *
 * @param serveMode 是否启用 --serve 兼容模式。
 * @param servePort serve 监听端口（仅在 serveMode=true 下有意义）。
 * @returns 最终传给 boot() 的 patches 数组。
 */
function buildPatches(serveMode: boolean, servePort: number): PatchOptions[] {
  if (!serveMode) {
    // 默认零端口模式：返回内置补丁栈（IPC 载波变体 + Web 传输层禁用）。
    return DESKTOP_OVERLAY_PATCHES
  }
  // --serve 兼容模式：桌面补丁栈本身从未插入 dsh-web-app 的传输层行——
  // §3 只有 `{ id: 'webserver', disabled: true }` 这类 id 打点 patch，而目标条目
  // （webserver/web-runtime/web-startup）在 boot() 直传空 cordis.yml + patches 的组合里
  // 不存在，故这些 disabled 是 no-op（被 applyEntryPatches 静默跳过）。
  // 因此这里不能靠"解除 disabled"，必须显式 INSERT 一个 webserver 定义行，用常量
  // host/port 直接绑定 loopback，且不依赖 webStartup 服务的 CLI flag 解析。
  // web-runtime/web-startup 是官方 dist 走 HTTP + 旗标解析所在；桌面 UI 经 dsh-ui://
  // 协议 + IPC 载波承载，--serve 只需 webserver 作为第三方 webServer 路由载波
  // （如 dsh-terminal 的 /terminal/stream）即可。
  const webserverInsert: PatchOptions = {
    insert: [
      { id: 'webserver', name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: servePort } },
    ],
  }
  return [...DESKTOP_OVERLAY_PATCHES, webserverInsert]
}

/**
 * 启动 dsh-desktop Cordis Host。
 *
 * @param options 配置选项。
 * @param options.configPath cordis.yml 绝对路径；省略时自动生成于 .runtime/。
 * @param options.patches overlay 补丁数组（桌面 patch 栈）；省略时按 serveMode 自动生成。
 * @param options.bareModuleBaseUrl 裸模块解析基 URL（Electron 打包后指向 resources/app/node_modules）。
 * @param options.serveMode 是否启用 --serve 兼容模式（默认 false）。
 * @param options.servePort --serve 监听端口（默认 38000）。
 * @returns 已就绪的 Cordis Context（ctx.get(service) 可获取服务）。
 */
export async function bootDesktopHost(options: BootOptions = {}): Promise<unknown> {
  // 动态导入 ESM 包（项目 CJS，上游 ESM，必须使用 import()）
  const { boot } = await import('@deepseek-ai/dsh-app-boot')
  const { provideCmdline } = await import('@deepseek-ai/dsh-cmdline')

  const serveMode = options.serveMode === true
  const servePort = options.servePort ?? 38000
  const configPath = options.configPath ?? createRootConfig()
  const patches = options.patches ?? buildPatches(serveMode, servePort)

  const ctx = await boot(
    'dsh-desktop',
    configPath,
    patches,
    // prepare 钩子：在 Loader 安装后、插件树挂载前注入 cmdlineArgs 服务 + desktopStartup 元信息
    async (hostCtx) => {
      provideCmdline(hostCtx, {
        args: Object.freeze([]),
        exit: (code: number) => {
          log.error(`[dsh-boot] cmdline exit 请求: ${code}`)
          process.exit(code)
        },
      })

      // desktopStartup 元信息：供第三方 web 路由插件判定当前运行模式
      //   - mode: 'portless'（默认，IPC 载波）| 'serve'（HTTP loopback 兼容）
      //   - port: serve 模式下的 loopback 端口
      try {
        hostCtx.provide('desktopStartup', {
          mode: serveMode ? 'serve' : 'portless',
          port: serveMode ? servePort : 0,
          portless: !serveMode,
        })
        log.ok(`[dsh-boot] desktopStartup 已注入（mode=${serveMode ? 'serve' : 'portless'}）`)
      } catch (error) {
        log.warn('[dsh-boot] desktopStartup 注入失败:', error)
      }

      // directoryPicker 服务：ApiProxyService.inject 必需。官方 -auto 版依赖 webServer（已禁用），
      // native 版用 koffi（Win32 FFI），在 Electron 主进程读对话框路径时崩溃。故定义本地
      // ElectronDirectoryPicker extends DirectoryPicker（基类构造 super(ctx) 即 ctx.provide
      // `directoryPicker` 服务），override capability 用 Electron dialog.showOpenDialog 提供
      // kind:"native"，pick 返回 string|null（对齐官方契约），稳定无 koffi。
      try {
        const { dialog, BrowserWindow } = await import('electron')
        const { DirectoryPicker } = await import('@deepseek-ai/dsh-host-directory-picker')
        class ElectronDirectoryPicker extends DirectoryPicker {
          override capability() {
            return {
              kind: 'native' as const,
              pick: async (signal?: AbortSignal): Promise<string | null> => {
                const win = BrowserWindow.getAllWindows()[0]
                const ret = await dialog.showOpenDialog(win ?? undefined, {
                  title: '选择工作区目录',
                  properties: ['openDirectory', 'createDirectory'],
                })
                if (signal?.aborted || ret.canceled || ret.filePaths.length === 0) return null
                return ret.filePaths[0]
              },
            }
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new (ElectronDirectoryPicker as any)(hostCtx)
        log.ok('[dsh-boot] directoryPicker (Electron native dialog Service) 已注入')
      } catch (error) {
        log.warn('[dsh-boot] directoryPicker 注入失败:', error)
      }

      // M2·地基 desktop-host-core：注入 ctx.desktop 聚合服务（core 子集）。
      // 后续桌面能力 host 插件（tray/notify/shortcuts/clipboard…）经 inject:['desktop']
      // 解析，共用审计总线 + 配置 + 下行桌面事件通道。
      try {
        const { installDesktopCore } = await import('./desktop-api.js')
        await installDesktopCore(hostCtx, { auditLogPath: options.auditLogPath })
      } catch (error) {
        log.warn('[dsh-boot] ctx.desktop 聚合服务注入失败:', error)
      }

      // 第三方 web 插件 host 半兼容（M1 门禁·ADR-007）：注入 ctx.webServer 等价面。
      // 第三方/旧插件（如 @lnyanhongyan/dsh-opencode-usage）inject:['webServer','fs','tools']
      // 硬依赖 webServer 服务；零端口模式下官方 webserver 已禁用，这里在插件树挂载前
      // 注入内存路由表等价服务（register + dispatch），使插件 apply 无改动激活。
      try {
        const { installWebServerCompat } = await import('./compat-webserver.js')
        await installWebServerCompat(hostCtx)
      } catch (error) {
        log.warn('[dsh-boot] webServer 等价面注入失败:', error)
      }
    },
    options.bareModuleBaseUrl,
  )

  return ctx
}

/**
 * 获取 Desktop overlay 补丁栈（供外部检查/日志用）。
 */
export function getDesktopOverlayPatches(): unknown[] {
  return DESKTOP_OVERLAY_PATCHES
}
