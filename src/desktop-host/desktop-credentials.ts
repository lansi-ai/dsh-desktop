/**
 * 自有化凭据 provider（@lansi-ai/dsh-desktop-credentials · M4 数据目录选择配套）。
 *
 * 完全重写官方 `@deepseek-ai/dsh-credentials-local` 的 provider 行为（M6 自有化模式）：
 *   - 文档层：desktop-credentials-document.ts（version-1 格式与官方 CLI 互换兼容）；
 *   - 解析分层：进程环境（只读，最高）> 文档 store（可写）> project/.env > harness home/.env；
 *   - 存储位置：跟随首启选择的 harness home（main.ts 启动早期已设 DSH_HOME；
 *     缺省 filename 时经 resolveDshHome() 解析），不再是隐式的 `~/.dsh`；
 *   - 写路径：跨进程文件锁 + 原子写 + 注释保全渲染；外部编辑经 chokidar 热发布。
 *
 * 装配方式：boot() prepare 钩子调用 installDesktopCredentials(hostCtx)——
 * CredentialProvider 基类构造即 ctx.provide('credentials', this)（官方服务契约），
 * 官方消费者（llm/agent/settings 等 inject ['credentials']）零改动。
 * roster 中官方 `dsh-credentials-local` 条目已删除（避免重复 provide 冲突）。
 *
 * ESM 边界说明：项目 CJS，官方 seam 均为 ESM-only——运行时值全部经动态 import
 * 在工厂闭包内取得；类型经 `import type` + resolution-mode 静态引入（擦除，零运行时）。
 */

import { dirname, join, resolve } from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import { log } from './log.js'
import { assertOwnerOnly, isENOENT, createCredentialsDocument } from './desktop-credentials-document.js'
import { canonicalizeWatchPath, resolveDshHome } from './desktop-home-paths.js'
import type { Context } from '@deepseek-ai/cordis' with { 'resolution-mode': 'import' }
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials' with { 'resolution-mode': 'import' }

/** 凭据文档锁等待上限：记录变更在锁内可能含网络往返（token 刷新），对齐官方 30s 鲁棒界。 */
const DOCUMENT_LOCK_WAIT_MS = 30_000

/** installDesktopCredentials 选项（filename 省略时取 `<resolveDshHome()>/.credentials.yaml`）。 */
export interface DesktopCredentialsOptions {
  /** 凭据文档绝对路径（缺省由 DSH_HOME / ~/.dsh 解析）。 */
  readonly filename?: string
  /** 是否监听外部编辑（默认 true）。 */
  readonly watch?: boolean
  /** 文件稳定判定去抖毫秒（默认 100）。 */
  readonly debounceMs?: number
}

/** cordis logger 的结构子集（实机仅用 info/warn/error 三级）。 */
interface LoggerLike {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** 装配期 host context 的结构子集（完整 cordis Context 的窄化视图）。 */
interface HostContextLike {
  get(name: string): unknown
  logger: LoggerLike
}

/**
 * 装配自有化 credentials 服务（boot.ts prepare 钩子调用）。
 * 类定义在工厂闭包内：extends 动态 import 得到的官方 CredentialProvider 基类。
 */
export async function installDesktopCredentials(hostCtx: unknown, options: DesktopCredentialsOptions = {}): Promise<void> {
  const [
    { Service },
    { CredentialProvider, credentialRef, parseCredentialKey },
    { withFileLock, writeFileAtomic },
    { launchEnvironmentOf },
    { watch },
  ] = await Promise.all([
    import('@deepseek-ai/cordis'),
    import('@deepseek-ai/dsh-credentials'),
    import('@deepseek-ai/dsh-atomic-write'),
    import('@deepseek-ai/dsh-launch-environment'),
    import('chokidar'),
  ])
  // 路径解析用自有实现（desktop-home-paths.ts，语义对齐官方 dsh-home-paths），
  // 不再动态 import 官方包——自研栈与官方包仅共享 DSH_HOME 环境变量契约。

  const ctx = hostCtx as HostContextLike
  const filename = resolve(options.filename ?? join(resolveDshHome(), '.credentials.yaml'))
  const spec = { filename, watch: options.watch ?? true, debounceMs: options.debounceMs ?? 100 }
  const doc = createCredentialsDocument({ credentialRef, parseCredentialKey })

  class DesktopCredentialProvider extends CredentialProvider {
    /** 最近一次读盘/落盘的原文（undefined = 文件缺失）；内容未变的 watcher 事件经此自抑制。 */
    private text: string | undefined
    /** 引用快照（每次 reload 整体替换，删除项绝不滞留内存）。 */
    private values = new Map<string, string>()
    /** 记录快照（每次 reload 整体替换）。 */
    private records = new Map<string, CredentialRecord>()
    /** 单一互斥操作链：watcher reload 与行编辑按队列序逐个执行，编辑绝不基于并发替换中的文本渲染。 */
    private operations: Promise<unknown> = Promise.resolve()
    /** dispose 后拒新写；在途工作各自短路。 */
    private closed = false

    constructor() {
      // 基类构造即 ctx.provide('credentials', this)——官方服务名，消费者零改动。
      super(ctx as unknown as Context)
    }

    /** 进程环境层的引用值（只读，最高优先；空串视为未设）。 */
    private inherited(ref: CredentialRef): string | undefined {
      const entry = launchEnvironmentOf(ctx as unknown as Context).getFrom(ref, ['process'])
      return entry !== undefined && entry.value.length > 0 ? entry.value : undefined
    }

    /** .env 回退层（永远低于托管 store）：调用方 project/.env 优先于用户 harness home/.env。 */
    private dotenvFallback(ref: CredentialRef): ResolvedCredential | undefined {
      const entry = launchEnvironmentOf(ctx as unknown as Context).getFrom(ref, ['project-env', 'user-env'])
      return entry !== undefined && entry.value.length > 0 ? { value: entry.value, source: entry.source } : undefined
    }

    async *[Service.init](): AsyncGenerator<() => Promise<void>> {
      yield async () => {
        this.closed = true
        await this.operations
      }
      await this.loadInitial()
      if (!spec.watch) return
      const watcher = watch(await canonicalizeWatchPath(spec.filename), {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: spec.debounceMs, pollInterval: Math.max(1, Math.min(spec.debounceMs, 10)) },
      })
      watcher.on('all', () => {
        if (this.closed) return
        this.queueRefresh()
      })
      watcher.on('ready', () => {
        if (this.closed) return
        this.queueRefresh()
      })
      watcher.on('error', (error: unknown) => {
        ctx.logger.warn('desktop-credentials: watcher error on %s', spec.filename)
        ctx.logger.warn(error)
      })
      yield async () => {
        this.closed = true
        await watcher.close()
        await this.operations
      }
    }

    override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
      const inherited = this.inherited(ref)
      if (inherited !== undefined) return Promise.resolve({ value: inherited, source: 'env' })
      const stored = this.values.get(ref)
      if (stored !== undefined) return Promise.resolve({ value: stored, source: 'file' })
      const fallback = this.dotenvFallback(ref)
      if (fallback !== undefined) return Promise.resolve(fallback)
      return Promise.resolve(undefined)
    }

    override describe(ref: CredentialRef): Promise<CredentialInfo> {
      if (this.inherited(ref) !== undefined) {
        return Promise.resolve({ configured: true, source: 'env', writable: false })
      }
      if (this.values.get(ref) !== undefined) {
        return Promise.resolve({ configured: true, source: 'file', writable: true })
      }
      const fallback = this.dotenvFallback(ref)
      if (fallback !== undefined) return Promise.resolve({ configured: true, source: fallback.source, writable: true })
      return Promise.resolve({ configured: false, writable: true })
    }

    override async set(ref: CredentialRef, value: string): Promise<void> {
      if (value.length === 0) {
        throw new Error(`desktop-credentials: an empty value cannot be stored for "${ref}"; use unset`)
      }
      await this.write(ref, value)
    }

    override async unset(ref: CredentialRef): Promise<void> {
      await this.write(ref, undefined)
    }

    override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
      return Promise.resolve(this.records.get(key))
    }

    override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
      const stored = this.records.get(key)
      if (stored === undefined) return Promise.resolve({ configured: false, writable: true })
      return Promise.resolve({ configured: true, kind: stored.kind, writable: true })
    }

    override listRecords(): Promise<readonly CredentialRecordEntry[]> {
      return Promise.resolve(
        [...this.records].map(([key, record]) => ({ key: parseCredentialKey(key), kind: record.kind })),
      )
    }

    override async modifyRecord(
      key: CredentialKey,
      mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
    ): Promise<CredentialRecord | undefined> {
      if (this.closed) throw new Error(`desktop-credentials is disposed: cannot modify "${key}"`)
      return this.enqueue(async () => {
        if (this.closed) throw new Error(`desktop-credentials was disposed before the queued "${key}" modify ran`)
        await mkdir(dirname(spec.filename), { recursive: true, mode: 0o700 })
        return withFileLock(
          spec.filename,
          async () => {
            await this.reconcileFromDisk()
            const current = this.records.get(key)
            const next = await mutate(current)
            if (next === undefined) return current
            if (next.kind === 'grant') doc.assertJsonValue(`record "${key}" payload`, next.payload, new Set())
            else doc.assertStorableApiKey(key, next)
            const nextText = doc.renderRecord(this.text, key, next)
            await writeFileAtomic(spec.filename, nextText, { mode: 0o600, dirMode: 0o700 })
            this.text = nextText
            this.records.set(key, next)
            this.notifyRecordUpdated(key)
            return next
          },
          { waitMs: DOCUMENT_LOCK_WAIT_MS },
        )
      })
    }

    override async deleteRecord(key: CredentialKey): Promise<void> {
      if (this.closed) throw new Error(`desktop-credentials is disposed: cannot delete "${key}"`)
      await this.enqueue(async () => {
        if (this.closed) throw new Error(`desktop-credentials was disposed before the queued "${key}" delete ran`)
        await mkdir(dirname(spec.filename), { recursive: true, mode: 0o700 })
        await withFileLock(
          spec.filename,
          async () => {
            await this.reconcileFromDisk()
            if (!this.records.has(key)) return
            const nextText = doc.renderRecord(this.text, key, undefined)
            await writeFileAtomic(spec.filename, nextText, { mode: 0o600, dirMode: 0o700 })
            this.text = nextText
            this.records.delete(key)
            this.notifyRecordUpdated(key)
          },
          { waitMs: DOCUMENT_LOCK_WAIT_MS },
        )
      })
    }

    /** 把一个操作排进互斥链（失败不中断后续操作）。 */
    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const task = this.operations.then(operation) as Promise<T>
      this.operations = task.then(
        () => undefined,
        () => undefined,
      )
      return task
    }

    /** 排队一次 reload；只有逃出 fan-out 的不变量违例才会拒绝。 */
    private queueRefresh(): void {
      this.enqueue(() => this.refresh()).catch((error: unknown) => {
        ctx.logger.error('desktop-credentials: reload commit failed at %s', spec.filename)
        ctx.logger.error(error)
      })
    }

    /** 排队一次行编辑；入队前先查（快速拒绝），运行时在互斥链内复查。 */
    private async write(ref: CredentialRef, value: string | undefined): Promise<void> {
      const verb = value === undefined ? 'unset' : 'set'
      if (this.closed) throw new Error(`desktop-credentials is disposed: cannot ${verb} "${ref}"`)
      this.assertUnshadowed(ref, verb)
      return this.enqueue(async () => {
        if (this.closed) throw new Error(`desktop-credentials was disposed before the queued "${ref}" ${verb} ran`)
        this.assertUnshadowed(ref, verb)
        await mkdir(dirname(spec.filename), { recursive: true, mode: 0o700 })
        await withFileLock(
          spec.filename,
          async () => {
            await this.reconcileFromDisk()
            const existing = this.values.get(ref)
            if (value === undefined && existing === undefined) return
            const nextText = doc.renderRef(this.text, ref, value)
            await writeFileAtomic(spec.filename, nextText, { mode: 0o600, dirMode: 0o700 })
            this.text = nextText
            if (value === undefined) this.values.delete(ref)
            else this.values.set(ref, value)
            this.notifyUpdated(credentialRef(ref))
          },
          { waitMs: DOCUMENT_LOCK_WAIT_MS },
        )
      })
    }

    /** 拒绝会被进程环境遮蔽成「看似无效」的写入（唯一能遮蔽写入的层）。 */
    private assertUnshadowed(ref: CredentialRef, verb: string): void {
      if (this.inherited(ref) !== undefined) {
        throw new Error(
          `desktop-credentials: "${ref}" is supplied read-only by the launching environment, ` +
          `so ${verb} would be shadowed; unset it in the shell you start dsh from instead`,
        )
      }
    }

    /** 启动读：文件缺失 = 空 store；文档存在但不可信则让激活失败（绝不当作「没存凭据」）。 */
    private async loadInitial(): Promise<void> {
      await assertOwnerOnly(spec.filename)
      let text: string
      try {
        text = await readFile(spec.filename, 'utf8')
      } catch (error) {
        if (!isENOENT(error)) throw error
        return
      }
      // pre-release 扁平布局一次性原地升级（跨进程锁 + 先重读防迁移竞态）。
      if (doc.renderFlatLayoutMigration(text) !== undefined) {
        await withFileLock(
          spec.filename,
          async () => {
            const current = await readFile(spec.filename, 'utf8')
            const migrated = doc.renderFlatLayoutMigration(current)
            if (migrated === undefined) return
            await writeFileAtomic(spec.filename, migrated, { mode: 0o600, dirMode: 0o700 })
            ctx.logger.info('desktop-credentials: migrated %s to the version-1 layout; values are unchanged', spec.filename)
            text = migrated
          },
          { waitMs: DOCUMENT_LOCK_WAIT_MS },
        )
      }
      const document = doc.parseCredentialsDocument(text, spec.filename)
      this.values = document.refs
      this.records = document.records
      this.text = text
    }

    /** watcher 事件后的重读：内容未变 no-op；文档不可读保留最后可用快照并告警（热更新绝不拖垮进程）。 */
    private async refresh(): Promise<void> {
      if (this.closed) return
      try {
        await this.reconcileFromDisk()
      } catch (error) {
        if ((error as { code?: string } | null)?.code === 'INVARIANT') throw error
        ctx.logger.warn('desktop-credentials: reload failed at %s; keeping the last good document', spec.filename)
        ctx.logger.warn(error)
      }
    }

    /** 比对盘上文本与缓存并发布差异；不可解析的文档抛错由调用方定策略。 */
    private async reconcileFromDisk(): Promise<void> {
      await assertOwnerOnly(spec.filename)
      let text: string | undefined
      try {
        text = await readFile(spec.filename, 'utf8')
      } catch (error) {
        if (!isENOENT(error)) throw error
        text = undefined
      }
      if (text === this.text || this.closed) return
      const next = text === undefined
        ? { refs: new Map<string, string>(), records: new Map<string, CredentialRecord>() }
        : doc.parseCredentialsDocument(text, spec.filename)
      const changedRefs = this.changedRefs(this.values, next.refs)
      const changedRecords = this.changedRecords(this.records, next.records)
      this.text = text
      this.values = next.refs
      this.records = next.records
      for (const ref of changedRefs) this.notifyUpdated(credentialRef(ref))
      for (const key of changedRecords) this.notifyRecordUpdated(parseCredentialKey(key))
    }

    /** 值发生变化的引用（键的可寻址性已由解析器证明）。 */
    private changedRefs(prev: Map<string, string>, next: Map<string, string>): CredentialRef[] {
      const changed: CredentialRef[] = []
      for (const key of new Set([...prev.keys(), ...next.keys()])) {
        if (prev.get(key) === next.get(key)) continue
        changed.push(credentialRef(key))
      }
      return changed
    }

    /** 值发生变化的记录（结构等值比较，键序无关）。 */
    private changedRecords(prev: Map<string, CredentialRecord>, next: Map<string, CredentialRecord>): CredentialKey[] {
      const changed: CredentialKey[] = []
      for (const key of new Set([...prev.keys(), ...next.keys()])) {
        if (doc.sameJsonValue(prev.get(key), next.get(key))) continue
        changed.push(parseCredentialKey(key))
      }
      return changed
    }
  }

  new DesktopCredentialProvider()
  log.ok(`[dsh-boot] desktop-credentials 已注入（${filename}${spec.watch ? '，watch 开启' : ''}）`)
}
