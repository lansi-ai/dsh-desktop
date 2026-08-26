/**
 * dsh-desktop Cordis Host 装配（M1·步骤3）。
 *
 * 复用 @deepseek-ai/dsh-app-boot 的 boot() 启动完整 Cordis 插件树，
 * 通过 overlay patches 禁用 Web 传输层条目，保留核心 host 服务（llm/session/agent/sandbox/fs）。
 * prepare 钩子中调用 provideCmdline() 注入 cmdlineArgs 服务（桌面模式：空参数列表）。
 *
 * 补丁值策略：所有原 cordis.patch.yml 中的 !!js 表达式均在 TypeScript 中直接求值，
 * 不依赖 Cordis Loader 的 __jsExpr 运行时求值管道（该管道仅在 Include YAML 解析阶段激活，
 * 而 overlay patches 作为 JS 对象直接传入 boot() 时跳过了该阶段）。
 */

import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { getIpcCarrierPatchEntries } from './manifest.js'

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
      // session-persistence-jsonl: !!js dshHomePath('sessions') → 使用 Electron userData 下的 sessions 目录
      // userData 在 main.ts 中重定向至 .runtime/user-data
      { id: 'session-persistence-jsonl', name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(__dirname, '..', '..', '.runtime', 'user-data', 'sessions') } },
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
      { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { persona: '' } },
      { id: 'agent-loop', name: '@deepseek-ai/dsh-agent-loop', config: { agents: [] } },
      { id: 'fs-sandbox', name: '@deepseek-ai/dsh-fs-sandbox' },
      { id: 'llm-deepseek', name: '@deepseek-ai/dsh-llm-deepseek' },
    ],
  },

  // ── §2 dsh-web-app 选择性覆盖（桌面 persona）─────────────────────────────
  { id: 'system-prompt', config: { persona: 'You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.' } },
  { id: 'session-query-sqlite', config: { path: ':memory:', openAt: 'never' } },

  // ── §3 禁用 Web 传输层 + 启用 IPC 载波变体（步骤 4 实现）────────────
  { id: 'webserver', disabled: true },
  { id: 'web-runtime', disabled: true },
  { id: 'web-startup', disabled: true },
  { id: 'modules', disabled: true },
  { id: 'client-hmr', disabled: true },
  { id: 'api-remotes', disabled: true },
  { id: 'cordis-client-runner', disabled: true },
  { id: 'cordis-host-runner', disabled: true },
  // IPC 载波替换：connection + client-runtime → IPC 载波变体（doFetch/openMux/openHost/rpc）
  ...getIpcCarrierPatchEntries(),

  // ── §4 桌面特定条目（storage + agent-presets）────────────────────────────
  // storage-json: !!js dshHomePath('storages') —— M1 暂跳过（storage 使用默认路径）
  {
    insert: [
      { id: 'storage', name: '@deepseek-ai/dsh-storage' },
      { id: 'storage-domain', name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
    ],
  },
  { id: 'agent-presets', config: { default: 'standard' } },
]

// ── 空根配置生成 ────────────────────────────────────────────────────────────
/**
 * 生成空 cordis.yml 根配置文件（`[]`）。
 * Loader 需要真实文件路径作为 Include 根锚点，所有实际配置由 overlay patches 覆盖。
 * 文件写入 .runtime/ 临时目录（随仓库可清理，不污染 src/dist）。
 * @returns cordis.yml 的绝对路径。
 */
function createRootConfig(): string {
  const runtimeDir = join(__dirname, '..', '..', '.runtime')
  mkdirSync(runtimeDir, { recursive: true })
  const configPath = join(runtimeDir, 'cordis.yml')
  writeFileSync(configPath, '# dsh-desktop profile root — 所有配置由 desktop-patch.yml overlay 补丁覆盖。\n[]\n')
  return configPath
}

// ── 入口函数 ────────────────────────────────────────────────────────────────
/**
 * 启动 dsh-desktop Cordis Host。
 *
 * @param options 配置选项。
 * @param options.configPath cordis.yml 绝对路径；省略时自动生成于 .runtime/。
 * @param options.patches overlay 补丁数组（桌面 patch 栈）；省略时使用内置 DESKTOP_OVERLAY_PATCHES。
 * @param options.bareModuleBaseUrl 裸模块解析基 URL（Electron 打包后指向 resources/app/node_modules）。
 * @returns 已就绪的 Cordis Context（ctx.get(service) 可获取服务）。
 */
export async function bootDesktopHost(options: {
  readonly configPath?: string
  readonly patches?: unknown[]
  readonly bareModuleBaseUrl?: string
}): Promise<unknown> {
  // 动态导入 ESM 包（项目 CJS，上游 ESM，必须使用 import()）
  const { boot } = await import('@deepseek-ai/dsh-app-boot') as any
  const { provideCmdline } = await import('@deepseek-ai/dsh-cmdline') as any

  const configPath = options.configPath ?? createRootConfig()
  const patches = options.patches ?? DESKTOP_OVERLAY_PATCHES

  const ctx = await boot(
    'dsh-desktop',
    configPath,
    patches,
    // prepare 钩子：在 Loader 安装后、插件树挂载前注入 cmdlineArgs 服务
    async (hostCtx: any) => {
      provideCmdline(hostCtx, {
        args: Object.freeze([]),
        exit: (code: number) => {
          console.error(`[dsh-desktop] cmdline exit 请求: ${code}`)
          process.exit(code)
        },
      })
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
