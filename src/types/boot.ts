/**
 * `__DSH_BOOT__` web 启动图谱 zod 契约（dsh-desktop · 步骤5·零端口 bundle spike）。
 *
 * 官方 wire 单一来源：host 侧 `dsh-client-modules` node 半区块扫描 `dsh.client` 声明后
 * 即产出该形状（对照其 `WebBootEntry` / `WebBootGraph`）。桌面以方案 A（`dsh-ui://` 协议直读）
 * 注入同一形态，保证官方 UI 客户端模块系统零改动解析。
 *
 * 字段语义（对齐官方 manifest.d.ts）：
 * - url        = 插件 bundle 端点，官方为 `/plugins/<id>/client.js?rev=...`
 * - rev        = bundle 内容 short hash（sha1 前 12 位 hex，缓存一致性锚点）
 * - inject     = 包名依赖边（信息性，用于 preflight/展示/HMR diff）
 * - immediately= 阶段一预取标记
 * - external   = 非基线模块 specifiers（约束代码到达顺序）
 */

import { z } from 'zod'

/** 单条 client 插件图谱行。 */
export const bootEntrySchema = z.object({
  /** 条目名 == 包名。 */
  id: z.string().min(1),
  /** Bundle 端点，`/plugins/<id>/client.js?rev=<rev>`（同源相对路径）。 */
  url: z.string().min(1),
  /** Bundle 内容 hash（sha1 前 12 位）。 */
  rev: z.string().min(1),
  /** 包名依赖边（信息性）。 */
  inject: z.array(z.string()).optional(),
  /** 阶段一预取标记。 */
  immediately: z.boolean().optional(),
  /** 非基线模块 specifiers。 */
  external: z.array(z.string()).optional(),
})

/** 完整图形：一致性锚点 + 按模块图序排列的条目。 */
export const bootGraphSchema = z.object({
  /** 整个图谱的一致性锚点（内容 + bundle hash）。 */
  rev: z.string().min(1),
  /** 条目列表（模块图序：动态包行须先于 external 请求它的消费方）。 */
  entries: z.array(bootEntrySchema),
})

/** `__DSH_BOOT__` 条目类型。 */
export type BootEntry = z.infer<typeof bootEntrySchema>

/** `__DSH_BOOT__` 图谱类型。 */
export type BootGraph = z.infer<typeof bootGraphSchema>
