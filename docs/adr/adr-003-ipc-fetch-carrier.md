# ADR-003 · 传输载波：IPC fetch 桥（零 HTTP 端口）

状态：**已接受**（2026-08）· 关联：[`04-architecture.md §5.1`](../04-architecture.md)、[`07-desktop-shell.md §3`](../07-desktop-shell.md)、风险 R3

## 背景
renderer ↔ Host 之间怎么传：HTTP（同官方 Web）/ 进程内 fetch / 自定义 IPC。

## 决策
- **默认**：`AbstractApiClient` 的 **IPC 载波子类**（`ipcRenderer.invoke('dsh:rpc'/'dsh:respond')` 上行、
  `webContents.send('dsh:frame')` 下行），**零 HTTP/WS 端口**；
- **兼容模式**：显式 `--serve=<port>` 才装配 `webserver` 行（loopback），供第三方 webServer 路由插件与浏览器并存（R-03 红线保持：默认不开）。

## 理由
1. 官方文字明示的载波插槽（layering note 子类表：`IPC bridge subclass | an Electron shell | 只换 doFetch`）与
   webserver 文档（Electron 走 file:// + IPC 桥、不用本服务器）——零实现分歧；
   > **实现注意（A3 澄清）**：「只换 doFetch」是官方抽象层说法；实际 `WebApiClient` 下行走 WebSocket（`openMux`/`openHost`），
   > 且官方 dist 硬编码 `new WebApiClient()`。桌面换载波的**唯一通路** = desktop profile 的 roster/manifest（`__DSH_BOOT__` 由 desktop-runtime 供给）
   > 把 `connection`/`client-runtime` patch 行为 IPC 载波变体（覆写 `doFetch` + `openMux` + `openHost` + rpc 四件套），**不改官方 dist**。
2. 四象限协议、zod、rpcId 纪律逐字复用，业务面零感知；
3. 安全默认值（不开口=少一条攻击面）与「桌面=超集」主张自洽。

## 后果
- 需自建桥宿主端（unary 表分发 + respond 回填 + 帧路由 per-window）；
- **前提核查（已于 2026-08-25 对照 `_harness-src` 核实，R3 解除）**：官方 `respond` / `approval/requested` **已完整实现**——
  `api-proxy.ts` 中 `respond` 全链路（pending 表 + 稳定 rpcId 帧 + 重复应答 `not-pending`，配套 `api-proxy-approval.spec.ts`）。
  桌面侧按「全量一致」实现；「展示态 + 本机确认入口」降级路径**不再作为前提依赖**（保留兜底，若基线核查发现版本差异再启用）。
- 第三方「webServer 路由类」插件（如 `dsh-terminal` 的 `/terminal/stream` + legacy `/terminal/run`）：桌面提供等价路由面（挂桥 method 表，零监听）或 `--serve` 兼容——M2 spike 定案（ADR-007）。

## 备选否决
- HTTP 透传：违背零端口红线与官方 Electron 定位
- 进程内 `InProcessApiClient`：无窗口可则不可用——需 N 窗口各自载波，IPC 才是多窗口正确解

## 复查触发
上游 `respond` 实现落地 / 官方发布 Electron carrier 参考实现 / typert 替换 apiproxy（R20）。