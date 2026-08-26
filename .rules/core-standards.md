---
description: 核心代码规范、安全红线与语法准则（dsh-desktop）
globs: "*"
alwaysApply: true
---

# 静态代码规范 (core-standards.md)

## 01. 核心技术栈与环境约束
- **基础 Runtime 与语言版本**：Node.js >= 20.0.0 / npm >= 10；TypeScript `strict` 全程（主进程 + preload + host 插件 + renderer）。
- **核心框架与依赖**：Electron（主进程内嵌 Cordis Host，基线 `dsh-v0.1.0-rc.8`）；`dsh-app-boot` 装配；`zod` 做协议校验；**npm 单包工程**（沙箱环境限制 pnpm store 写入，依赖统一项目内 `node_modules` 安装）。
- **配置与环境隔离**：API 密钥、Token、模型凭据一律经 profile/环境变量注入，禁止写死在源码；`.env` 不提交；开发/测试/生产三态隔离。

## 02. 代码风格与语法规范
- **类型安全底线**：
  - 严格开启 `strict` 模式，严禁使用 `any`；不确定类型统一 `unknown` 并做类型收窄。
  - 所有 IPC 契约、帧结构、API 请求/响应必须先用 `zod` 定义 Schema，禁止手写无校验的平行类型。
  - 严禁使用 `@ts-ignore` / `as unknown as T` 绕过类型系统；特殊情况必须附注释说明。
- **并发与异步范式**：统一 `async/await`；主进程禁止 `.then` 链式裸奔与同步阻塞（禁用 `.Result`/`waitFor`）；`ipcMain.handle` 必须全部为 async handler。
- **命名范式**：组件/类/接口 `PascalCase`；函数/变量 `camelCase`；常量 `UPPER_SNAKE_CASE`；IPC channel 名统一 `dsh:*` 前缀小写短横线；避免缩写与单字母变量（唯 `i`/`j` 索引例外）。
- **代码量约束**：单文件建议 ≤ 200 行（高复杂度 ≤ 300）；超出必须拆模块/提取 Helper。

## 03. 绝对禁区与安全红线 (Red Lines)
- 🚫 **严禁硬编码凭据**：API Keys、Tokens、数据库密码、模型密钥禁止出现在任何源码/配置文件；必须经 profile 或环境变量注入。
- 🚫 **严禁逃避类型与静态检查**：禁止 `@ts-ignore`、`#pragma warning disable` 等规避；必须通过 `pnpm typecheck` + ESLint 零告警。
- 🚫 **严禁注入式安全漏洞**：
  - renderer：禁止未过滤字符串动态构建 DOM/HTML（防 XSS）；`preload` 仅暴露白名单 API，禁止 `ipcRenderer.send` 裸通。
  - 主进程：禁止把 renderer 传入的任意路径直接拼接文件操作（需 path 规范化 + 白名单校验）。
- 🚫 **严禁绕过载波**：默认零端口——禁止非 `--serve` 显式模式监听任何 TCP/HTTP 端口（R-03 红线）。
- 🚫 **严禁未授权系统操作**：剪贴板写、文件删除、外链跳转必须过 `approval` 服务（R-11/08）。

## 04. 错误处理与日志规范
- **异常捕获范式**：所有 IPC handler、网络请求、文件 I/O、插件装载必须 `try-catch`；失败返回结构化 `{ code, message, details }` 而非裸 throw。
- **结构化异常类型**：自定义 `AppError`（`code` + `message` + `details`），错误码集中定义（`errno.ts`），禁止散落魔法字符串。
- **日志脱敏与控制**：统一 Logger（主进程）与 `console` 白名单（renderer 走 dev 通道）；日志严禁含 Token、凭据、密钥；敏感操作留结构化审计记录（R-15）。

## 05. 性能与安全底线
- **边界 Schema 强制校验**：所有 IPC 入参、帧负载、插件注入数据必须先过 `zod` 强校验再进业务逻辑。
- **高频事件与渲染控制**：窗口 Resize、滚动、搜索输入等必须 Debounce/Throttle；`webContents` 大帧发送避免阻塞主线程（分批/合并）。
- **资源释放保障**：`app.on('will-quit')`/`before-quit` 统一释放：Host 关闭、ipcMain 移除、单例锁、托盘销毁；定时器/订阅必须随生命周期清理。
- **崩溃自愈**：主进程异常退出经 relaunch 自愈链路恢复（M1 初版）；阻止无限重启（计数上限 + 熔断）。

## 06. 规则自我演进维护
本文件为静态硬约束。若后续引入新核心库/SDK、更改安全要求或调整代码风格，AI 必须按 `workflow.md` 场景 A 规则更新协议，同步正向重构本文件，禁止「规范与代码脱节」。