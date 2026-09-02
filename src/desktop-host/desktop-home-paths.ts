/**
 * 自有化 harness home 路径解析（@lansi-ai/dsh-desktop-home-paths · M4-a4）。
 *
 * 完全重写官方 `@deepseek-ai/dsh-home-paths` 的解析语义（M6 自有化模式），
 * 供自研栈使用（data-home.ts 数据目录决策 + desktop-credentials.ts 凭据落点）。
 * **铁律：解析语义与官方逐字节一致**——官方 16 包（凭据/设置/附件/技能/预设等）
 * 仍读官方实现，两侧必须对同一环境解析出同一 home，否则数据面脱钩：
 *   - 优先级：显式 configured > `$DSH_HOME` > `~/.dsh`；
 *   - `$DSH_HOME` 为空串/纯空白视为未设（空白覆盖不得把 home 解析到 cwd）；
 *   - tilde 前缀（`~` / `~/` / `~\`）按 OS home 展开；
 *   - `canonicalizeWatchPath` 为原生 watcher 提供规范拼写：最深存在祖先经
 *     realpath 解析、缺失后缀原样拼回（防 Windows 把普通文件祖先当普通缺失、
 *     防短名别名混入原生 watcher 产出的长路径）。
 *
 * 上游升级核查（upstream-contracts §7.2）：官方 dsh-home-paths 若变更环境变量名、
 * 默认目录名或优先级语义，须同步本文件。
 */

import { opendir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** 默认 harness home 目录名（官方常量同值：`~/.dsh`）。 */
const DSH_HOME_DIR_NAME = '.dsh'

/** 默认 harness home 的用户可读展示形。 */
const DEFAULT_DSH_HOME_DISPLAY = `~/${DSH_HOME_DIR_NAME}`

/** 覆盖默认 harness home 的环境变量名（官方常量同值）。 */
const DSH_HOME_ENV = 'DSH_HOME'

/**
 * 展开支持的 tilde 前缀（`~` / `~/` / `~\`）到 OS home。
 * @param path - 可能带 tilde 前缀的配置路径。
 * @returns 展开后的路径；无受支持前缀时原样返回。
 */
function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/** 按 Node 平台路径规则解析默认 harness home（`<os home>/.dsh`）。 */
function defaultDshHome(): string {
  return join(homedir(), DSH_HOME_DIR_NAME)
}

/**
 * 解析单根 harness home。
 *
 * 优先级从高到低：显式 configured、`$DSH_HOME`、`~/.dsh`。harness 把全部
 * 用户数据收在一个根下。空串或纯空白的 `$DSH_HOME` 视为未设——空白覆盖
 * 绝不能把 home 解析到当前工作目录。
 * @param configured - 显式 harness home 覆盖（最高优先）。
 * @param env - 环境映射（读 `DSH_HOME`；测试可注入）。
 * @returns 规范化的绝对 harness home。
 */
export function resolveDshHome(configured?: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[DSH_HOME_ENV]
  return resolve(expandHomePath(configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : defaultDshHome())))
}

/** 在解析后的 harness home 上拼接子段（空列表返回 home 本身）。 */
export function dshHomePath(...segments: string[]): string {
  return join(resolveDshHome(), ...segments)
}

/**
 * 以符号形描述解析后的 harness home（永不回传机器绝对路径）：
 * 默认 home 标注 `~/.dsh`，其余标注 `$DSH_HOME`。
 */
export function dshHomeDisplay(resolvedHome: string): string {
  return resolvedHome === resolve(defaultDshHome()) ? DEFAULT_DSH_HOME_DISPLAY : `$${DSH_HOME_ENV}`
}

/**
 * 给原生文件系统 watcher 一个规范拼写的路径，即使末段尚不存在：最深存在
 * 祖先经 realpath 解析，缺失后缀原样拼回。这防止 Windows 把「普通文件祖先
 * 下的缺失」当普通缺失处理，也防短名别名混入原生 watcher 产出的长路径。
 * @param path - watch 目标或根（按当前目录解析）。
 * @returns 已存在的祖先被规范化的目标。
 * @throws 祖先遍历遇到缺失以外的错误时上抛。
 */
export async function canonicalizeWatchPath(path: string): Promise<string> {
  let current = resolve(path)
  const missing: string[] = []
  while (true) {
    try {
      const canonical = await realpath(current)
      if (missing.length > 0) await (await opendir(canonical)).close()
      return join(canonical, ...missing.reverse())
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== 'ENOENT') throw error
      const parent = dirname(current)
      // 文件系统必有根：遍历必然在根处收敛（对齐官方守卫注释）。
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}
