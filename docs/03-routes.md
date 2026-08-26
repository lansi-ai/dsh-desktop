# 03 · 路线分析 — 从套壳到真桌面的路线深度

> 当前主线（2026-08 用户确认）：**L2 — Electron 主进程内嵌 Host + 复用官方 Web UI**。
> L2+（自绘 UI）与 L3（SDK 自研）均**降为未来可选**，本轮不纳入主线；但路线深度仍列全，便于日后切换。

## 0. 结论先行

**当前推荐：L2（Electron 内嵌 Host + 官方 UI 复用 + IPC 载波 + 桌面能力宿主插件化）**。
它同时满足：与官方架构同构（零移植）、成本可控（复用官方 UI 与客户端插件生态）、**深度可观**（宿主同进程、能力可插件化、可审批、
零端口）、有官方文档背书（GUI layering 说明明示 Electron 即此类插槽）。
**自绘 UI / SDK 自研**作为差异化升级位，留到 M5+（ADR-006 暂缓）。

## 1. 路线深度定义

| 级别 | 名称 | 结构 | 能力增量 | 状态 |
| --- | --- | --- | --- | --- |
| L0 | 纯套壳 | BrowserWindow 套 `http://127.0.0.1:3080`；Harness 在壳外子进程 | ≈0 | 排除 |
| L1 | 分发套壳 | 官方 Web profile + 打包运行时 + Electron IPC 提供 UI（不开口）；附加管理功能 | 安装简单、桌面体验；宿主外置、能力未插件化 | 社区 `sdkwork-ai/deepseek-harness-desktop` |
| **L2** | **内嵌宿主 + 官方 UI 复用** | **Host 跑进 Electron 主进程**；renderer=官方 UI dist；fetch 走 IPC 桥；桌面能力全是 host 插件 | 生命周期合一、能力插件化/可审批、多窗口 | **本轮主线** |
| L2+ | 内嵌宿主 + 自绘 UI | 同上，但 renderer=自研 Desktop UI（样式差异化）；官方 UI 作兼容窗口 | 增加界面差异化 | **二期可选**（ADR-006/13） |
| L3 | 自研 UI 面 + SDK | SDK（stdio JSON-RPC）驱动 runtime 子进程；前端完全自绘 | 最大自由度；丢官方插件生态与内嵌 | 远期（不采用） |
| L4 | PWA | 浏览器「安装为应用」 | 无托盘/热键/沙箱；非真桌面 | 排除 |

## 2. 候选路线详评

### 路线 A：Electron 内嵌 Host + 官方 UI 复用（L2，推荐·本轮主线）

**结构**：
```
┌─ Electron 主进程（Node）─────────────────────────────┐
│  Cordis Host（boot() 装配 desktop profile）            │
│   ├─ base bundle（模型/会话/工具/沙箱/审批/存储…）      │
│   ├─ web 子集（去 webserver/web-runtime 的 HTTP 面）    │
│   ├─ desktop bundle（托盘/热键/通知/剪贴板/compat…）    │
│   └─ api 网关（进程内 or IPC 桥）+ desktopRoutes 兼容面 │
│  BrowserWindow（官方 UI dist, file:///dsh-ui:// + 桥） │
└──────────────────────────────────────────────────────┘
```

- **为什么可行（官方背书）**：
  - GUI layering 说明 Checklist：自定义 transport 子类（例如未来的 Electron IPC）；不需要 HTTP 则零端口
  - webserver 文档：「Electron 通过 file:// 加载已构建文件，并经 IPC 桥接发送 fetch 请求，不使用本服务器」
  - 客户端加载模型的 `BootSeams.loadBundle` 钩子 = file:// 环境下的 client 插件加载官方扩展点
- **优势**：宿主即进程（生命周期/崩溃恢复/资源可管）；零端口；官方 UI/client 插件生态无缝；`ctx.desktop.*` 可被工具/模型调用
- **代价**：Electron 体积（~100MB）；需自建 Bridge 载波（只写 `doFetch`）+ 零端口 bundle 服务（自定义协议/`BootSeams`）；上游 rc 漂移耦合
- **风险控制**：耦合收敛在 3 处（载波、bundle 服务、desktop profile 装配）；其余全是官方机制；旧插件走 ADR-007 兼容

### 路线 A'：Electron 内嵌 Host + 自绘 UI（L2+，二期可选）
- 同 A，只把 renderer 换成自研组件与 token（见 [`13-ui-design.md`](13-ui-design.md)、ADR-006）
- 差异点：主面不复用官方 UI，需维护自绘对话流/时间线/设置（渐进式，13§6）；官方 UI 降为可选兼容窗口
- **本轮不启用**；M5+ 若用户仍要 UI 差异化再切换（宿主与协议不变，切换成本主要在 renderer 侧）

### 路线 B：Tauri 2（L2'）
- 主进程 Rust + Node sidecar 跑 Host → 宿主外置（深度掉回 L1.5）；系统 WebView 对官方 UI 兼容风险
- **结论**：不选（理由见 [ADR-001](adr/adr-001-electron-stack.md)）

### 路线 C：SDK + 全自研（L3）
- `@deepseek-ai/dsh-sdk-client`/Python SDK 驱动 runtime 子进程；UI 全自绘。丢审批/取消（SDK 未实现）与插件生态
- **结论**：不采用；未来若需独立于 Electron 的工具形态可单独评估

### 路线 D：纯套壳 / PWA（L0/L4，排除）

## 3. 决策矩阵

| 准则（权重） | A 内嵌+官方UI (L2) | A' 内嵌+自绘 (L2+) | B Tauri 2 | C SDK 全自研 | D 套壳/PWA |
| --- | --- | --- | --- | --- | --- |
| 与官方架构对齐（30%） | ★★★ 零移植 | ★★★ 宿主/协议零移植 | ★★ 侧车外置 | ★★ 协议级 | ★ |
| 成本（工期/维护）（25%） | ★★★ 复用官方 UI 与插件生态 | ★★ 自绘+兼容双面 | ★★ | ★ 高 | ★★★ |
| 集成深度/能力增量（20%） | ★★★ 宿主插件化 | ★★★ 宿主插件化+UI 差异 | ★★ | ★★★（缺审批/取消） | ☆ |
| 界面差异化/体验（15%） | ★★ 官方 UI 原有 | ★★★ 自设计 | ★★★ | ★★★（自绘） | ☆ |
| 旧插件/生态保持（10%） | ★★★ 无缝 | ★★ 兼容层 | ★★ | ★ 重做 | ★★★ |
| **加权总分** | **≈2.95** | **≈2.7** | **≈2.2** | **≈2.4** | **≈1.8** |

> 当前以「成本 + 对齐」优先（权重 30/25），故 **A（L2）胜出**；若用户明确要 UI 差异，则权重调向 A'。

## 4. 风险前置审查（选定路线后仍要确认的事）

1. **上游破坏性变更**：版本钉死 + 迁移登记（ADR-005，持续项）
2. **dist 构建依赖**：官方 UI dist 来自上游 vite build；需维护「跟随版本」的 dist 构建脚本或直接打包上游 release 构件（M1 验证）
3. **零端口 bundle 面**：`file://`/自定义协议下没有同源 `/plugins/<id>/client.js`；需自定义协议或 `BootSeams` 覆写（M1 spike）
4. **旧插件宿主语义**：「重启」类（dsh-restart）在桌面语义不同（桌面重启=应用 relaunch）→ 桥接后原生化
5. **进程模型/性能**：内嵌 Host ⇒ 退出竞态、内存预算（07§8、R6/R9）

## 5. 决策记录

- ADR-001：技术栈选 **Electron**（弃 Tauri 2）
- ADR-002：**Host 内嵌主进程**（弃侧车/子进程外置）
- ADR-003：传输载波 = **IPC fetch 桥**（禁 HTTP 端口，可选 `--serve` 兼容）
- ADR-004：桌面能力 = **desktop bundle + host 插件**（进 `dsh plugin` 生态，可 patch）
- ADR-005：上游**版本钉死** + 升级迁移
- ADR-006：**（暂缓·可选）** 自绘主面——本轮不启用
- ADR-007：**旧 Web 插件兼容策略**（host 全兼容；client 零端口 bundle 兼容）

（各决策的完整论证见 [`docs/adr/`](adr/)）