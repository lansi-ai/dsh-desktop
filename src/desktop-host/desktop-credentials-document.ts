/**
 * 自有化凭据文档层（@lansi-ai/dsh-desktop-credentials · M4 数据目录选择配套）。
 *
 * 承担 `.credentials.yaml` version-1 文档的解析与渲染，行为对齐官方
 * `@deepseek-ai/dsh-credentials-local`（存储格式完全兼容，桌面与官方 CLI 可互换读写）：
 *   - 严格解析：未知顶层键 / 未知 record 字段 / 非 JSON 可表达 payload 一律拒绝，
 *     「存了但没生效」永远好过「静默忽略」；
 *   - 注释保全渲染：编辑基于 parseDocument 的可变树而非重建，comments 与
 *     未触碰条目的排版逐字节存活；
 *   - pre-release 扁平布局一次性原地升级（rc.8 时代旧文档迁移，值不变）。
 *
 * 依赖注入说明：credentialRef/parseCredentialKey 来自 ESM-only 的
 * `@deepseek-ai/dsh-credentials`（项目 CJS 无法静态 import 运行时值），
 * 由 installDesktopCredentials 工厂动态 import 后经 deps 注入；yaml 为双包可静态 import。
 */

import { Document, isMap, isScalar, parseDocument } from 'yaml'
import { stat } from 'node:fs/promises'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials' with { 'resolution-mode': 'import' }

/** 文档层依赖（官方 ESM seam 的运行时校验函数，由宿主工厂注入）。 */
export interface CredentialDocDeps {
  /** 校验并品牌化凭据引用名（POSIX 标识符，如 DEEPSEEK_API_KEY）。 */
  readonly credentialRef: (value: string) => string
  /** 校验并品牌化记录键（`<scope>/<id>` 两段式）。 */
  readonly parseCredentialKey: (value: string) => CredentialKey
}

/** 解析后的凭据快照：引用表 + 记录表，整体替换语义（每次 reload 全量换新）。 */
export interface ParsedCredentialsDocument {
  readonly refs: Map<string, string>
  readonly records: Map<string, CredentialRecord>
}

/** 本构建读写的文档布局版本。 */
export const DOCUMENT_VERSION = 1

/** 是否为「文件不存在」类错误；其余错误必须如实上抛。 */
export function isENOENT(error: unknown): boolean {
  return (error as { code?: string } | null | undefined)?.code === 'ENOENT'
}

/**
 * 拒绝其他 OS 用户可读的凭据文档（POSIX only）：provider 创建/替换时均为 0600，
 * 但手写或外部生成的文件可能带着宽松 umask——静默服务一份 world-readable 的
 * 秘密文件会让 mode 承诺失去意义。Windows 无可检视的 mode 位（ACL 不可在此表达），
 * 跳过检查而不造假。
 */
export async function assertOwnerOnly(filename: string): Promise<void> {
  let mode: number | undefined
  try {
    mode = (await stat(filename)).mode
  } catch (error) {
    if (!isENOENT(error)) throw error
    return
  }
  if (process.platform === 'win32') return
  if ((mode & 0o077) === 0) return
  throw new Error(
    `desktop-credentials: ${filename} is readable beyond its owner (mode ${(mode & 0o777).toString(8)}); ` +
    `run "chmod 600 ${filename}" before starting again`,
  )
}

/** 描述一次 YAML 解析失败（不引用原文——出错的那一行里是秘密）。 */
function describeYamlError(error: { code?: string; linePos?: Array<{ line: number; col: number }> }): string {
  const at = error.linePos?.[0]
  const where = at === undefined ? '' : ` at line ${String(at.line)}, column ${String(at.col)}`
  return `${error.code ?? 'yaml-error'}${where}`
}

/** 文档的一个 section 作为普通 mapping；缺失与 null 都视为空。 */
function asSection(section: unknown, name: string, filename: string): Record<string, unknown> {
  if (section === undefined || section === null) return {}
  if (typeof section !== 'object' || Array.isArray(section)) {
    throw new TypeError(`desktop-credentials: "${name}" in ${filename} must be a mapping`)
  }
  return section as Record<string, unknown>
}

/** 收纳一个 record 条目：拒绝未知 tag 或未知字段，绝不做静默丢弃。 */
function parseRecord(deps: CredentialDocDeps, key: string, value: unknown, filename: string): CredentialRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`desktop-credentials: record "${key}" in ${filename} must be a mapping`)
  }
  const fields = value as Record<string, unknown>
  const kind = fields['kind']
  const assertFields = (allowed: string[]): void => {
    for (const field of Object.keys(fields)) {
      if (!allowed.includes(field)) {
        throw new Error(`desktop-credentials: record "${key}" in ${filename} has unknown field "${field}"`)
      }
    }
  }
  if (kind === 'api-key') {
    assertFields(['kind', 'key', 'env'])
    const apiKey = fields['key']
    if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length === 0)) {
      throw new TypeError(`desktop-credentials: record "${key}" in ${filename} has a non-string or empty key`)
    }
    let env: Record<string, string> | undefined
    if (fields['env'] !== undefined) {
      if (typeof fields['env'] !== 'object' || fields['env'] === null || Array.isArray(fields['env'])) {
        throw new TypeError(`desktop-credentials: record "${key}" in ${filename} has a non-mapping env`)
      }
      env = {}
      for (const [name, entryValue] of Object.entries(fields['env'] as Record<string, unknown>)) {
        deps.credentialRef(name)
        if (typeof entryValue !== 'string' || entryValue.length === 0) {
          throw new TypeError(`desktop-credentials: record "${key}" env "${name}" in ${filename} must be a non-empty string`)
        }
        env[name] = entryValue
      }
    }
    return {
      kind: 'api-key',
      ...(apiKey === undefined ? {} : { key: apiKey }),
      ...(env === undefined ? {} : { env }),
    }
  }
  if (kind === 'grant') {
    assertFields(['kind', 'payload'])
    if (!('payload' in fields)) {
      throw new Error(`desktop-credentials: record "${key}" in ${filename} has no payload`)
    }
    assertJsonValue(`record "${key}" payload in ${filename}`, fields['payload'], new Set())
    return { kind: 'grant', payload: fields['payload'] }
  }
  if (kind === undefined) throw new Error(`desktop-credentials: record "${key}" in ${filename} has no kind`)
  throw new Error(`desktop-credentials: record "${key}" in ${filename} has unknown kind ${JSON.stringify(kind)}`)
}

/** 拒绝无法通过 JSON round-trip 的 payload（进与出两个方向都把守）。 */
function assertJsonValue(where: string, value: unknown, seen: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new TypeError(`desktop-credentials: ${where} holds a non-finite number`)
  }
  if (typeof value === 'object') {
    if (seen.has(value as object)) throw new TypeError(`desktop-credentials: ${where} is cyclic`)
    if (Object.getPrototypeOf(value) === Object.prototype || Array.isArray(value)) {
      seen.add(value as object)
      for (const nested of Object.values(value as Record<string, unknown>)) assertJsonValue(where, nested, seen)
      seen.delete(value as object)
      return
    }
  }
  throw new TypeError(`desktop-credentials: ${where} holds a value JSON cannot represent`)
}

/** 写入前的持久边界校验：空 key / 越界 env 名 / 空 env 值在写入侧就拒绝。 */
function assertStorableApiKey(deps: CredentialDocDeps, key: string, record: CredentialRecord): void {
  if (record.kind !== 'api-key') return
  if (record.key !== undefined && record.key.length === 0) {
    throw new TypeError(`desktop-credentials: record "${key}" has an empty key; omit the field instead`)
  }
  for (const [name, value] of Object.entries(record.env ?? {})) {
    deps.credentialRef(name)
    if (value.length === 0) {
      throw new TypeError(`desktop-credentials: record "${key}" env "${name}" must be a non-empty string`)
    }
  }
}

/**
 * 创建文档操作面（工厂闭包持有 seam 校验函数）。
 * 返回的方法集覆盖：启动解析 / 扁平迁移识别 / 引用与记录渲染 / 记录结构等值比较。
 */
export function createCredentialsDocument(deps: CredentialDocDeps) {
  /** 严格解析一份凭据文档：空文档即空 store（无需 version）。 */
  function parseCredentialsDocument(text: string, filename: string): ParsedCredentialsDocument {
    const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true })
    if (document.errors.length > 0) {
      throw new Error(
        `desktop-credentials: invalid document at ${filename}: ${document.errors.map(describeYamlError).join('; ')}`,
      )
    }
    const root = document.toJS() ?? {}
    if (typeof root !== 'object' || root === null || Array.isArray(root)) {
      throw new TypeError(`desktop-credentials: ${filename} must be a mapping`)
    }
    const fields = root as Record<string, unknown>
    const keys = Object.keys(fields)
    if (keys.length === 0) return { refs: new Map(), records: new Map() }
    if (!('version' in fields)) {
      throw new Error(
        `desktop-credentials: ${filename} uses the pre-release flat layout. Add \`version: 1\` and nest the ` +
        `existing ${keys.length} ${keys.length === 1 ? 'entry' : 'entries'} under \`refs:\`. No values need to change.`,
      )
    }
    if (fields['version'] !== DOCUMENT_VERSION) {
      throw new Error(
        `desktop-credentials: ${filename} declares version ${JSON.stringify(fields['version'])}; ` +
        `this build reads version ${DOCUMENT_VERSION}`,
      )
    }
    for (const key of keys) {
      if (key !== 'version' && key !== 'refs' && key !== 'records') {
        throw new Error(`desktop-credentials: unknown top-level key "${key}" in ${filename}`)
      }
    }
    // refs section：POSIX 标识符键 over 非空字符串值。
    const refs = new Map<string, string>()
    for (const [key, value] of Object.entries(asSection(fields['refs'], 'refs', filename))) {
      deps.credentialRef(key)
      if (typeof value !== 'string') {
        throw new TypeError(`desktop-credentials: the value for "${key}" in ${filename} must be a string`)
      }
      if (value.length === 0) {
        throw new Error(`desktop-credentials: the value for "${key}" in ${filename} is empty; remove the key instead`)
      }
      refs.set(key, value)
    }
    // records section：`<scope>/<id>` 键 over 带	tag 的 record mapping。
    const records = new Map<string, CredentialRecord>()
    for (const [key, value] of Object.entries(asSection(fields['records'], 'records', filename))) {
      deps.parseCredentialKey(key)
      records.set(key, parseRecord(deps, key, value, filename))
    }
    return { refs, records }
  }

  /**
   * 识别 pre-release 扁平布局并渲染 version-1 迁移文本：非空顶层 mapping、
   * 键全部可寻址、值全部非空字符串、无 version 键且无文档指令。迁移把原始行
   * 逐字节嵌进 `refs:`（缩进两格），comments / 空行 / 值拼写全存活。
   * 返回 undefined 表示不识别——交给 parseCredentialsDocument 大声拒绝。
   */
  function renderFlatLayoutMigration(text: string): string | undefined {
    const document = parseDocument(text, { prettyErrors: true, uniqueKeys: true })
    if (document.errors.length > 0) return undefined
    const flat = document.contents
    if (!isMap(flat) || flat.items.length === 0) return undefined
    for (const line of text.split('\n')) {
      if (/^(%|---|\.\.\.)/.test(line)) return undefined
    }
    for (const pair of flat.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || pair.key.value === 'version') return undefined
      try {
        deps.credentialRef(pair.key.value)
      } catch {
        return undefined
      }
      if (!isScalar(pair.value) || typeof pair.value.value !== 'string' || pair.value.value.length === 0) return undefined
    }
    return `version: ${DOCUMENT_VERSION}\nrefs:\n${text.split('\n').map((line) => (line.length === 0 ? line : `  ${line}`)).join('\n')}${text.endsWith('\n') ? '' : '\n'}`
  }

  /** 注释保全的可变树：编辑已解析文档而非重建；缺失文档从空白新树起步。 */
  function mutableDocument(text: string | undefined) {
    const document = text === undefined ? new Document({}) : parseDocument(text)
    document.setIn(['version'], DOCUMENT_VERSION)
    return document
  }

  /** 移除 section 条目时连同其注释一起带走（防注释错挂到下一个条目头上）。 */
  function deleteSectionEntry(document: ReturnType<typeof mutableDocument>, section: string, key: string): void {
    const map = document.get(section, true)
    if (isMap(map)) {
      const first = map.items[0]
      if (first !== undefined && isScalar(first.key) && first.key.value === key) map.commentBefore = null
    }
    document.deleteIn([section, key])
  }

  /** 渲染下一版文档文本：写入或删除一个引用。 */
  function renderRef(text: string | undefined, ref: string, value: string | undefined): string {
    const document = mutableDocument(text)
    if (value === undefined) deleteSectionEntry(document, 'refs', ref)
    else document.setIn(['refs', ref], value)
    return document.toString()
  }

  /** 渲染下一版文档文本：整写或删除一个记录（记录是机器写的，无内部排版需保全）。 */
  function renderRecord(text: string | undefined, key: string, record: CredentialRecord | undefined): string {
    const document = mutableDocument(text)
    if (record === undefined) deleteSectionEntry(document, 'records', key)
    else document.setIn(['records', key], record)
    return document.toString()
  }

  /** 两个已收纳 JSON 值的结构等值（键序无关——外部编辑器可重排记录字段）。 */
  function sameJsonValue(left: unknown, right: unknown): boolean {
    if (left === right) return true
    if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
    if (Array.isArray(left) !== Array.isArray(right)) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every(
      (key) => key in right && sameJsonValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    )
  }

  return {
    parseCredentialsDocument,
    renderFlatLayoutMigration,
    renderRef,
    renderRecord,
    sameJsonValue,
    assertStorableApiKey: (key: string, record: CredentialRecord): void => assertStorableApiKey(deps, key, record),
    assertJsonValue,
  }
}

export type CredentialsDocument = ReturnType<typeof createCredentialsDocument>
