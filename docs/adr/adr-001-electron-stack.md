# ADR-001 · 技术栈：选 Electron，弃 Tauri 2

状态：**已接受**（2026-08）· 关联：[`03-routes.md`](../03-routes.md)

## 背景
需要桌面壳承载 Cordis Host 与官方 Web UI。候选：Electron、Tauri 2、纯 PWA。

## 决策
**Electron**（主进程即 Node，renderer 用官方 UI dist）。

## 理由
1. **Host 就是 Node**：dsh 宿主 = Cordis 插件树跑在 Node；Electron 主进程可*同进程*装配（`dsh-app-boot.boot()`），
   Tauri 必须把 Node 塞进 sidecar 子进程，深度退回 L1.5；
2. **官方预留插槽是 Node 语义**：`AbstractApiClient` 子类（IPC carrier）、`boot()` + `prepare`、`BootSeams.loadBundle`——
   全部面向 Node/Chromium 系；Electron 逐字复用，Tauri 全部要桥接重做；
3. **renderer 一致性**：Chromium = 官方 Vite dist 的测试面；系统 WebView（WebView2/WKWebView）存在特性/兼容风险；
4. 社区桌面（sdkwork-ai）已验证 Electron 路径可行（IPC 提供 UI 不开口）。

## 后果
- 代价：安装包体积（~100MB）、内存基线（Chromium）、Windows 平台 API 差异需自行处理。
- 缓解：Win 首发、性能预算（07§8）、`dsh-ui://` 协议裁剪。

## 备选否决
- Tauri 2：侧车外置、WebView 兼容风险（见 [03-routes.md](../03-routes.md) Route B）
- PWA：无托盘/热键/沙箱，非真桌面

## 复查触发
上游发布官方 Electron 壳、或 Tauri 官方出 Node 宿主托管方案时，重估一次。