/**
 * 数据目录决策（M4 · 首启选择用户数据存储位置）。
 *
 * 背景：官方 harness 把全部用户数据（凭据/设置/附件/技能/agent 预设等 16 个包）
 * 收敛在 harness home（`@deepseek-ai/dsh-home-paths` 的 `resolveDshHome()`：
 * 显式配置 > $DSH_HOME > ~/.dsh）。桌面版在启动早期把 `$DSH_HOME` 指向用户
 * 首启选定的目录，全部官方包零改动跟随；选定结果持久化于 userData，卸载器
 * 经注册表标记（HKCU\Software\DSH Forge\DataDir）读取同一位置做删除询问。
 *
 * 决策优先级（高 → 低）：
 *   1. `--data-dir=<path>` 启动参数（企业静默部署，启动即生效并回写持久化）；
 *   2. userData/data-location.json（用户在应用内选定，正常路径）；
 *   3. 注册表预置（安装器 / 部署脚本写入的「种子」，仅在尚无持久化选择时生效）；
 *   4. 默认目录 `~/.dsh`。
 *
 * 时序契约：必须在 bootDesktopHost() 之前完成——所有官方包在插件激活期
 * （boot 期间）才解析 DSH_HOME，启动早期设置即全覆盖；--hidden 静默启动
 * （开机自启）不弹首启窗口，直接采用默认目录并持久化（与自启语义一致）。
 */

import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { log } from '../desktop-host/log.js'
import { resolveDshHome } from '../desktop-host/desktop-home-paths.js'

const execFileAsync = promisify(execFile)

/** 卸载器读取的数据目录标记（打包版写入；dev 无安装器语义，跳过）。 */
const REGISTRY_KEY_PATH = 'Software\\DSH Forge'
/** 更名前的注册表键（dsh-desktop 时期）：只读兼容，读到即迁移到新键。 */
const LEGACY_REGISTRY_KEY_PATH = 'Software\\DSH Desktop'
const REGISTRY_VALUE_NAME = 'DataDir'

/** userData 中的选择持久化文件。 */
function configFilePath(): string {
  return join(app.getPath('userData'), 'data-location.json')
}

/** 读取已持久化的选择（缺失/损坏/非法返回 null，触发首启流程）。 */
async function readStoredHome(): Promise<string | null> {
  try {
    const raw = await fs.readFile(configFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as { home?: unknown }
    if (typeof parsed.home === 'string' && parsed.home.trim().length > 0) return parsed.home
    return null
  } catch {
    return null
  }
}

/** 持久化选择（writeFileSync 语义足够：仅启动期单写者，崩溃残留由 JSON.parse 拒收兜底）。 */
async function storeHome(home: string): Promise<void> {
  await fs.writeFile(configFilePath(), JSON.stringify({ home }, null, 2), 'utf8')
}

/**
 * 读取注册表预置目录（安装器 / 部署脚本写入的种子）。
 *
 * 新键优先、旧键兼容；仅 Windows 有注册表语义。读取失败一律按「未预置」处理，
 * 绝不因注册表异常阻断启动。
 * @returns 预置的绝对路径；未预置或读取失败返回 null。
 */
async function readRegistryHome(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  for (const key of [REGISTRY_KEY_PATH, LEGACY_REGISTRY_KEY_PATH]) {
    try {
      const { stdout } = await execFileAsync('reg', ['query', `HKCU\\${key}`, '/v', REGISTRY_VALUE_NAME])
      const matched = /REG_SZ\s+(.+?)\s*$/m.exec(stdout)
      const value = matched?.[1]?.trim()
      if (value !== undefined && value.length > 0) return value
    } catch {
      // 键/值不存在或 reg 调用失败：继续尝试下一个键。
    }
  }
  return null
}

/**
 * 应用选定目录：设 DSH_HOME（全部官方包在插件激活期解析）+ 打包版写注册表
 * 卸载标记（失败只告警——卸载询问退化为「不删数据」，绝不阻断启动）。
 */
async function applyHome(home: string): Promise<void> {
  process.env.DSH_HOME = home
  if (!app.isPackaged || process.platform !== 'win32') return
  try {
    await execFileAsync('reg', ['add', `HKCU\\${REGISTRY_KEY_PATH}`, '/v', REGISTRY_VALUE_NAME, '/t', 'REG_SZ', '/d', home, '/f'])
    // 清理更名前遗留的旧键（best-effort：失败不影响本次启动）。
    await execFileAsync('reg', ['delete', `HKCU\\${LEGACY_REGISTRY_KEY_PATH}`, '/f']).catch(() => undefined)
  } catch (error) {
    log.warn('[data-home] 注册表卸载标记写入失败（卸载时将不询问删除）:', error)
  }
}

/** ensureDataHome 结果：最终生效的 harness home。 */
export interface DataHomeResult {
  /** 生效的绝对路径（已同步设置 process.env.DSH_HOME）。 */
  readonly home: string
  /** 本次是否走了首启选择流程（true = 用户交互选定；false = 沿用既有选择或静默默认）。 */
  readonly firstRun: boolean
}

/** ensureDataHome 选项。 */
export interface EnsureDataHomeOptions {
  /** 静默启动（--hidden，开机自启）：不弹首启窗口。 */
  readonly silent: boolean
  /** 强制重新选择（--select-data-dir）：忽略已有选择与注册表预置，弹窗。 */
  readonly selectDataDir?: boolean
  /** 显式指定数据目录（--data-dir=<path>）：最高优先，不弹窗。 */
  readonly dataDir?: string
}

/**
 * 解析并应用数据目录（main.ts bootstrap 调用，闪屏创建之前）。
 *
 * 决策链见文件头；用户关闭首启窗口 = 不选择 → 维持原状（本次沿用当前目录，
 * 不覆盖已持久化选择）。
 */
export async function ensureDataHome(options: EnsureDataHomeOptions): Promise<DataHomeResult> {
  // 自有实现解析默认 home（语义对齐官方 dsh-home-paths：$DSH_HOME > ~/.dsh）。
  const defaultHome = resolveDshHome()

  // 1. --data-dir 显式覆盖（企业静默部署）：最高优先，落盘 + 写注册表，不弹窗。
  if (options.dataDir !== undefined) {
    const explicit = resolve(options.dataDir)
    await fs.mkdir(explicit, { recursive: true })
    await applyHome(explicit)
    await storeHome(explicit)
    log.ok(`[data-home] 采用 --data-dir 指定目录: ${explicit}`)
    return { home: explicit, firstRun: false }
  }

  // 2. 已持久化选择且非重配置 → 直接沿用。
  const stored = await readStoredHome()
  if (stored !== null && options.selectDataDir !== true) {
    await applyHome(stored)
    log.info(`[data-home] 沿用已选数据目录: ${stored}`)
    return { home: stored, firstRun: false }
  }

  // 3. 注册表预置（安装器 / 部署脚本）：仅在应用内尚无选择时作为种子生效。
  if (stored === null && options.selectDataDir !== true) {
    const seeded = await readRegistryHome()
    if (seeded !== null) {
      await fs.mkdir(seeded, { recursive: true })
      await applyHome(seeded)
      await storeHome(seeded)
      log.info(`[data-home] 采用注册表预置目录: ${seeded}`)
      return { home: seeded, firstRun: false }
    }
  }

  // 4. 静默启动（开机自启）：不弹 UI——沿用现有选择，无选择则采用默认目录并持久化。
  if (options.silent) {
    const home = stored ?? defaultHome
    await applyHome(home)
    if (stored === null) await storeHome(home)
    log.info(`[data-home] 静默启动采用数据目录: ${home}`)
    return { home, firstRun: false }
  }

  // 5. 首启/重配置：预选与迁移源 = 当前在用目录（无选择时为默认目录 ~/.dsh）。
  const currentHome = stored ?? defaultHome
  let sourceExists: boolean
  try {
    sourceExists = (await fs.stat(currentHome)).isDirectory()
  } catch {
    sourceExists = false
  }
  const { showFirstRunWindow } = await import('./first-run.js')
  const choice = await showFirstRunWindow({ preselect: currentHome, migrateSource: currentHome, sourceExists })

  if (choice === null) {
    // 用户关闭窗口：维持原状（不覆盖已持久化选择；无选择时本次以默认目录启动但不持久化）。
    const fallback = stored ?? defaultHome
    await applyHome(fallback)
    log.warn(`[data-home] 首启窗口被关闭，本次以 ${fallback} 启动（未持久化新选择）`)
    return { home: fallback, firstRun: false }
  }

  await fs.mkdir(choice.home, { recursive: true })
  // 迁移旧数据：仅当源目录存在且与选定目录不同（fs.cp 不删源，失败即中止选择）。
  if (choice.migrate && sourceExists && choice.home !== currentHome) {
    log.info(`[data-home] 迁移现有数据: ${currentHome} → ${choice.home}`)
    await fs.cp(currentHome, choice.home, { recursive: true })
  }
  await applyHome(choice.home)
  await storeHome(choice.home)
  log.ok(`[data-home] 数据目录已选定: ${choice.home}`)
  return { home: choice.home, firstRun: true }
}
