/**
 * `__DSH_BOOT__` web 启动图谱 zod 契约（dsh-desktop · 0.1.2 迁移）。
 *
 * 官方 wire 单一来源：host 侧 `dsh-client-modules` node 半区块扫描 `dsh.client` 声明后
 * 即产出该形状（对照其 `WebBootEntry` / `WebBootGraph` / `WebBootBatch`）。桌面以方案 A
 * （`dsh-ui://` 协议直读）注入同一形态，保证官方 UI 客户端模块系统零改动解析。
 *
 * 0.1.2 字段语义（对齐官方 client/manifest.d.ts）：
 * - id         = 条目名 == 包名
 * - url        = HMR 失效后使用的「单资源 combo」端点 `/plugins/??<id>/client.js&rev=...`
 * - rev        = 插件产物不透明修订号
 * - inject     = 包名依赖边（信息性）
 * - immediately= 阶段一预取标记
 * - external   = 非基线模块 specifiers
 * - batches    = 初始加载 combo 描述符（`bootstrap` / `application` 两阶段），
 *                每个条目恰属于一个 batch；解析端要求该字段**必填**（缺失抛错）
 */

import { z } from 'zod'

/** 单条 client 插件图谱行。 */
export const bootEntrySchema = z.object({
  /** 条目名 == 包名。 */
  id: z.string().min(1),
  /** HMR 失效后的单资源 combo 端点 `/plugins/??<id>/client.js&rev=<rev>`。 */
  url: z.string().min(1),
  /** 插件产物不透明修订号（缓存一致性锚点）。 */
  rev: z.string().min(1),
  /** 包名依赖边（信息性）。 */
  inject: z.array(z.string()).optional(),
  /** 阶段一预取标记。 */
  immediately: z.boolean().optional(),
  /** 非基线模块 specifiers。 */
  external: z.array(z.string()).optional(),
})

/** combo 阶段：`bootstrap`（解析器阻塞，先于 Vite shell）| `application`（应用批）。 */
export const bootBatchPhaseSchema = z.enum(['bootstrap', 'application'])

/** 一个初始 combo 脚本的描述符。 */
export const bootBatchSchema = z.object({
  /** 阶段（bootstrap | application）。 */
  phase: bootBatchPhaseSchema,
  /** 内容寻址 combo 脚本端点（`/plugins/??.../client.js,...,client.js&rev=...`）。 */
  url: z.string().min(1),
  /** 组合脚本字节 + 索引 sourcemap 的修订。 */
  rev: z.string().min(1),
  /** 该脚本注册的图谱条目标识（执行序）。 */
  entries: z.array(z.string()).min(1),
})

/** 完整图形：一致性锚点 + 按模块图序排列的条目 + 初始 combo 批。 */
export const bootGraphSchema = z.object({
  /** 整个图谱的一致性锚点（内容 + bundle hash）。 */
  rev: z.string().min(1),
  /** 条目列表（模块图序：动态包行须先于 external 请求它的消费方）。 */
  entries: z.array(bootEntrySchema),
  /** 初始 combo 描述符（每个条目恰属于一个）。必填。 */
  batches: z.array(bootBatchSchema),
})

/** `__DSH_BOOT__` 条目类型。 */
export type BootEntry = z.infer<typeof bootEntrySchema>

/** `__DSH_BOOT__` 图谱批次类型。 */
export type BootBatch = z.infer<typeof bootBatchSchema>

/** `__DSH_BOOT__` 图谱类型。 */
export type BootGraph = z.infer<typeof bootGraphSchema>