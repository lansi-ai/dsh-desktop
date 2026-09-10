/**
 * 数据根分层迁移（M4 · 用户数据 / 设备数据归位 + 应用目录更名）。
 *
 * 分界线是「离开这台机器还有没有价值」：
 *   - 用户数据（settings/凭据/会话/workspace/主题/图标/窗口布局）→ 跟随 `$DSH_HOME`；
 *   - 设备数据（指针 data-location.json、Chromium 运行时缓存、审计日志）→ 留 userData。
 *
 * 两段迁移：
 *   1. `migrateLegacyUserDataSync()`：应用目录更名（`dsh-desktop` → `DSH Forge`，
 *      随 package.json `productName`）。**必须在任何 app 事件之前**同步完成，否则
 *      Chromium 已在旧路径建好 profile，形成「数据在旧、缓存在新」的裂脑。
 *   2. `migrateRuntimeDataIntoHome()`：把历史上落在设备目录的用户数据搬到 home。
 *      幂等（目标已存在即跳过）、失败保持原位绝不半搬，在 boot 之前调用。
 */

import { app } from 'electron'
import { cp, mkdir, rename, rm } from 'node:fs/promises'
import { cpSync, existsSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { log } from '../forge-host/log.js'

/** 更名前后的设备目录名（`%APPDATA%\<name>`）。 */
const LEGACY_APP_DIR_NAME = 'dsh-desktop'
const CURRENT_APP_DIR_NAME = 'DSH Forge'

/** 需要从设备目录归位到 home 的用户数据（目录名或文件名）。 */
const RELOCATED_ENTRIES = ['sessions', 'storages', 'themes', 'icons', 'window-state.json'] as const

/**
 * 设备目录更名迁移（打包态，同步，app ready 之前）。
 *
 * 仅当旧目录存在且新目录不存在时执行；rename 失败（跨卷等）回退「复制 + 删源」，
 * 两者都失败则保持原状并告警——宁可沿用旧目录，也不能让用户数据半途丢失。
 */
export function migrateLegacyUserDataSync(): void {
  if (!app.isPackaged) return
  const target = app.getPath('userData')
  const legacy = join(app.getPath('appData'), LEGACY_APP_DIR_NAME)
  if (normalize(target) === normalize(legacy)) return
  if (normalize(target) !== normalize(join(app.getPath('appData'), CURRENT_APP_DIR_NAME))) return
  if (!existsSync(legacy) || existsSync(target)) return
  try {
    renameSync(legacy, target)
    log.ok(`[data-migration] 设备目录更名: ${LEGACY_APP_DIR_NAME} → ${CURRENT_APP_DIR_NAME}`)
  } catch (error) {
    log.warn('[data-migration] 设备目录更名失败，回退复制:', error)
    try {
      cpSync(legacy, target, { recursive: true })
      rmSync(legacy, { recursive: true, force: true })
      log.ok('[data-migration] 设备目录复制迁移完成')
    } catch (copyError) {
      log.error('[data-migration] 设备目录迁移失败（保持原状）:', copyError)
    }
  }
}

/**
 * 把历史上落在设备目录的用户数据归位到 harness home。
 *
 * 归位源：运行时数据根下的 `user-data/<entry>`（sessions/storages）与设备
 * userData 根下的同名项（themes/icons/window-state.json）。目标已存在即跳过
 * （幂等，重启安全）；单个条目失败只告警并保持原位，不影响其余条目与启动。
 *
 * @param home - 首启选定并已生效的 harness home（`$DSH_HOME`）。
 */
export async function migrateRuntimeDataIntoHome(home: string): Promise<void> {
  const { runtimeRoot } = await import('../forge-host/boot.js')
  const deviceRoot = app.getPath('userData')
  const runtimeUserData = join(runtimeRoot(), 'user-data')
  for (const entry of RELOCATED_ENTRIES) {
    const from = join(entry.startsWith('window-') ? deviceRoot : runtimeUserData, entry)
    const to = join(home, entry)
    if (normalize(from) === normalize(to)) continue
    if (existsSync(to) || !existsSync(from)) continue
    try {
      await mkdir(dirname(to), { recursive: true })
      try {
        await rename(from, to)
      } catch {
        await cp(from, to, { recursive: true, force: false, errorOnExist: true })
        await rm(from, { recursive: true, force: true })
      }
      log.ok(`[data-migration] 用户数据归位: ${entry} → ${home}`)
    } catch (error) {
      log.warn(`[data-migration] 归位失败（保持原位）: ${entry}`, error)
    }
  }
}
