# 10 · 开发与验证指南

## 1. 仓库与依赖策略

- 独立仓库（本目录或其 git 初始化），**以 pnpm workspace 管理**；上游 `deepseek-ai/deepseek-harness` 作为 **git 子模块或 pnpm 固定依赖**
  （推荐：子模块 + 锁 tag，理由见 ADR-005）
- 所有与上游的耦合点收敛在极少文件（`apps` 层语义）：
  `shell/ipc-fetch.ts`（载波）、`shell/protocol.ts`（协议/资产面）、`shell/compat.ts`（兼容层）、`bundle/desktop/cordis.patch.yml`（装配）
- **镜像但不出包**：上游源码检出只读；desktop 项目自身源码按 `04-architecture.md §2` 布局（shell/、renderer/、compat/、bundle/、packages/）

## 2. 构建链路

```
① 自绘 renderer build（主面）         vite build（renderer/）→ resources/ui   [主面不依赖上游 dist]
② 兼容面 dist  build（跟随 tag）      pnpm run build (apps/web) → apps/web/dist → resources/legacy  [由脚本产出，冻结基线]
③ shell 构建                          electron-builder / 多步：main+preload 单包
④ desktop 插件构建（每包）             tsdown（与官方同 preset 对齐）→ lib/ + client.js（若有 client 半）
⑤ 运行时组装                          resources/（ui + legacy + deps）-> 打进包；deps 以 pnpm --prod 冻结清单
⑥ 开发工具                            scripts/dsh-desktop-dev（主面 vite dev server + shell --dev 直连）
```

- 开发模式（主面）：`renderer/` 跑 vite dev server → shell `--dev` 加载 dev URL（HMR 全量）；
  兼容面：`--dev` 直读上游 `apps/web/dist`（watch 由上游 `pnpm run dev:web` 提供；桌面兼容窗口复用 `client-hmr` 行，
  **注意**：官方 web-app 默认 disabled `hmr`（TODO 注释），兼容面同样先禁后按需开）
- 生产模式：`resources/ui` + `resources/legacy` 内嵌，零外部路径依赖

## 3. 运行方式（开发期）

```bash
pnpm --filter @lansi-ai/dsh-shell start -- --dev --profile desktop        # 或直接 electron .
dsh --help 等价物：startup args: --serve={port} | --user-data-dir | --no-retry
```
- 多实例：单实例锁；调试可用 `--user-data-dir` 隔离

## 4. 测试体系

| 层 | 工具 | 覆盖 |
| --- | --- | --- |
| 单测 | vitest（对齐上游） | desktop-api schema、IPC 信封编解码、host 插件 effect 清理 |
| 组件 | vitest + fixture | 自绘面组件（对话流/时间线/命令面板）与 desktop-client-* 插件（无宿主） |
| 集成 | 内存 profile + `InProcessApiClient` | 桥→apiProxy→session 全链（对齐上游 carrier 测试思路） |
| 兼容层 | vitest + e2e | desktopRoutes 映射、SSE→帧、旧插件 host 半零改动（`/rules/*`、`/terminal/run`） |
| e2e | Playwright + `_electron` | 主面：启动→对话→命令面板→托盘→通知→协议唤起→崩溃恢复；兼容窗口：旧插件回归 |
| 静态 | oxlint / tsc 双程序（host/client 聚合，对齐上游 tsconfig 双 aggregate） | 方向纪律、类型安全 |

- **关键测试文件计划**：`shell/test/ipc-fetch.spec.ts`（象限完整性）、`bundle/test/patch-invariants.spec.ts`
  （desktop patch 与上游 web-app 行集合的差集校验）、`packages/desktop-client-*/test/*.spec.tsx`

## 5. 与上游同步节奏

- 每 rc：跑 `scripts/sync-upstream.sh <tag>`（拉子模块→diff 耦合面文件→更新基线常量→迁移登记表）
- 强制门禁：耦合面文件的 diff 必须人工 review 后合入；`dsh--version` 基线校验进 CI
- 破坏性变更登记：`docs/adr/adr-005.md` 挂的表 + `docs/11-risks.md` 更新

## 6. 调试技巧

- **协议诊断**：官方 envelope tap（`subscribeEnvelopes`）→ 桌面版桥两端各留开关（`--debug-wire`）
- **Host 状态**：`--dump-config` 等价物（`boot` 前 `renderConfigDump`）验证 desktop patch 合成结果；
  `plugin-inventory` 行在 UI 侧可见桌面插件装载状态
- **renderer**：Electron devtools（仅 `--dev` 开放）；`?fixture` 模式无宿主调试 UI
- **Windows 特例**：toast/托盘 dev 行为差异（见 07§10）；子进程闪窗根因在上游 `dsh-subprocess-local`（不修，规避或打补丁 upstream patch 到子模块 overlay）

## 7. CI（建议）

- 分支：main（可发布）→ rc/*（预览构建）→ ci 门禁：lint + typecheck + unit + integration + e2e(Win runner) + patch 差集 + 上游基线检查
- 产物：CI 产出安装包 + SHA256SUMS + 更新描述符（M4 起）
- 平台矩阵：Win x64 必跑；mac/linux 延后（M5）

## 8. 编码约定（对齐官方仓库纪律）

- 双面插件命名与 `dsh.client` 声明、`inject` 纪律同官方（见 dsh-terminal 先例）
- 客户端包禁止 import 宿主运行时（只 type-import /client 子路径）；跨包 value 协作走服务
- 错误用开放 code 字符串 + zod schema（对齐 `RpcErrorDetailsMap` 思路）
- 文档即成品的一部分：改动必须同步本文档集与 ADR