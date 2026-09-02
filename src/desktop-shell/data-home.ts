/**
 * 数据目录决策（M4 · 首启选择用户数据存储位置）。
 *
 * 背景：官方 harness 把全部用户数据（凭据/设置/附件/技能/agent 预设等 16 个包）
 * 收敛在 harness home（`@deepseek-ai/dsh-home-paths` 的 `resolveDshHome()`：
 * 显式配置 > $DSH_HOME > ~/.dsh）。桌面版在启动早期把 `$DSH_HOME` 指向用户
 * 首启选定的目录，全部官方包零改动跟随；选定结果持久化于 userData，卸载器
 * 经注册表标记（HKCU\Software\DSH Desktop\DataDir）读取同一位置做删除询问。
 *
 * 时序契约：必须在 bootDesktopHost() 之前完成——所有官方包在插件激活期
 * （boot 期间）才解析 DSH_HOME，启动早期设置即全覆盖；--hidden 静默启动
 * （开机自启）不弹首启窗口，直接采用默认目录并持久化（与自启语义一致）。
 */

import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { log } from '../desktop-host/log.js'
import { resolveDshHome } from '../desktop-host/desktop-home-paths.js'

const execFileAsync = promisify(execFile)

/** 卸载器读取的数据目录标记（打包版写入；dev 无安装器语义，跳过）。 */
const REGISTRY_KEY_PATH = 'Software\\DSH Desktop'
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
 * 应用选定目录：设 DSH_HOME（全部官方包在插件激活期解析）+ 打包版写注册表
 * 卸载标记（失败只告警——卸载询问退化为「不删数据」，绝不阻断启动）。
 */
async function applyHome(home: string): Promise<void> {
  process.env.DSH_HOME = home
  if (!app.isPackaged || process.platform !== 'win32') return
  try {
    await execFileAsync('reg', ['add', `HKCU\\${REGISTRY_KEY_PATH}`, '/v', REGISTRY_VALUE_NAME, '/t', 'REG_SZ', '/d', home, '/f'])
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

/**
 * 解析并应用数据目录（main.ts bootstrap 调用，闪屏创建之前）。
 *
 * 决策链：已持久化选择且非重配置 → 直接沿用；--hidden 静默 → 在用目录（无
 * 选择时默认目录）并持久化；否则弹自绘首启窗口（first-run.ts）——首启预选
 * 默认目录，重配置（--select-data-dir）预选当前在用目录，迁移源 = 当前在用
 * 目录（换目录时旧数据可跟随，不局限于默认 ~/.dsh）。用户关闭窗口 = 不选择
 * → 维持原状（本次沿用当前目录，不覆盖已持久化选择）。
 */
export async function ensureDataHome(options: { silent: boolean; selectDataDir?: boolean }): Promise<DataHomeResult> {
  // 自有实现解析默认 home（语义对齐官方 dsh-home-paths：$DSH_HOME > ~/.dsh）。
  const defaultHome = resolveDshHome()

  const stored = await readStoredHome()
  if (stored !== null && options.selectDataDir !== true) {
    await applyHome(stored)
    log.info(`[data-home] 沿用已选数据目录: ${stored}`)
    return { home: stored, firstRun: false }
  }

  // 静默启动（开机自启）：不弹 UI——沿用现有选择，无选择则采用默认目录并持久化。
  if (options.silent) {
    const home = stored ?? defaultHome
    await applyHome(home)
    if (stored === null) await storeHome(home)
    log.info(`[data-home] 静默启动采用数据目录: ${home}`)
    return { home, firstRun: false }
  }

  // 首启/重配置：预选与迁移源 = 当前在用目录（无选择时为默认目录 ~/.dsh）。
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
