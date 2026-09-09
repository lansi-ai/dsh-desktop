---
description: 项目当前 Sprint 激活上下文与动态任务看板（dsh-desktop · 滚动窗口 ≤100 行，维护协议见 05 节）
globs: "*"
alwaysApply: true
---

# 激活上下文与任务看板 (active-context.md)

> 本文件是**滚动窗口**：只保留「活」信息；完成条目一行收口，过程细节归 docs 台账与 git log，历史全文可从 git 历史找回。

## 01. 当前迭代目标 (Current Sprint Goal)
- **阶段**：M3 代码全部完成（2026-08-26）→ **M6 全量自绘 UI 主线（D-20 · ADR-006）**；M3-b4 dogfood 进行中（= M3 收尾门禁，不阻塞自绘）；M4 分发整体延后，重启时机 = 自绘可日常使用
- **M6 主线**：逐槽位替换官方 ui-*（P1 骨架 ✅ → P2 外壳 → P3 侧栏 → P4 对话区 → P5 过程可视化 → P6 设置底座），每阶段可用可验证；数据面零新增（IPC 载波 + desktopBridge）
- **上游基线**：`dsh-v0.1.2-rc.1`（每日 02:00 北京时间定时任务跑 `npm run upstream:auto`；**新版判据源 = GitHub releases**，npm 仅作「是否可安装」校验，判定 safe 才动；升级后台账人工同步硬约束见 workflow.md 场景 D）
- **上游待办（pending）**：`dsh-v0.1.3-alpha.1`（2026-09-04 19:34 已 release）**npm 未发行 → 装不了**；预评 **REVIEW**（S2 载波 4 文件 / S3 `app-boot/index.ts` / ui-primitives·conversation·theme·chat 契约 / 官方 roster 新增 `dsh-client-file-upload`），且含破坏性变更（SessionHandle、`agentLoop.create()` 转异步、session 锁、session format v2）。npm 发行后人工对照适配，禁 auto 硬升（坑 31）

## 02. 任务看板 (Task Kanban · 滚动窗口)

### 里程碑索引（一行收口；历史全文找 git log）
- M1 桌面骨架 ✅ · M2 桌面能力插件化 ✅ · M3 代码侧 ✅（2026-08-25~26）
- M3-c 布局/标题栏/骨架宿主化 ✅（= M6-P1，2026-09-01 实机验证）
- M3-a4 命令面板 + M3-a5 多窗口验证 ⏸️ 用户决策挂起（Ctrl+K 已隐藏；恢复 = revert `desktop-cmdpalette-client.js` 禁用壳）
- M4-a1 electron-builder 基建 ✅；v0.1.1-alpha.1~alpha.3 Win/mac 安装包发布 ✅；**v0.1.1-alpha.4 发布 ✅（2026-09-08 · CI win+mac 双平台自动构建并上传 GitHub Releases pre-release；坑 41：资产名对齐 latest.yml path 后自动更新链路匿名 HEAD 200 验证）**；**v0.1.1-alpha.5 发布（2026-09-09 · 首载 M4-a4 数据目录分层/DSH Forge 命名/规则收敛，tag 推 CI 双平台构建）**（打包链坑见 `docs/pitfalls.md`）
- M4-d 上游升级链：rc.8 → alpha.3（载波整链重写，方案见 `docs/m4-d3-012-alpha3-migration-plan.md`）→ alpha.4 → alpha.5（`scripts/upstream.cjs` 自动化首跑）→ rc.1（首次跨 next 线）；全部零破坏性变更，登记 `docs/upstream-migrations.md` C-1~C-4
- M4-d6 工具修正 ✅（2026-09-07）：`check` 判据源 npm dist-tags → **GitHub releases**（npm 降级为可安装校验，新增 pending 三态），修「连续 3 天漏检 0.1.3-alpha.1」，见坑 31 / ADR-005 第 6 条
- **M4-a4 数据目录分层 ✅（2026-09-09 · ADR-008）**：sessions/storages/themes/icons/window-state 归位 `$DSH_HOME`（幂等迁移，失败保持原位）+ 应用命名统一 `DSH Forge`（旧设备目录/旧注册表键自动迁移）+ 卸载删除路径安全校验 + `--data-dir` 与注册表种子；typecheck/lint/29 单测/build 全绿 + **实机验证通过（2026-09-09）**
- 规则目录收敛 ✅（2026-09-09）：规则唯一来源 = `.trae/rules/`（6 文件，含 `rtk-usage.md`）并入 git 跟踪（`.gitignore` 加例外），陈旧副本 `.rules/` 已删（历史留 git）
- **M6-P3 侧栏 workspaces ✅（2026-09-08 实机验收）**：`@lansi-ai/dsh-desktop-workspaces` W1 五接管+picker 承重（坑 35）→ W2 派生层 → W3 Rows/视图选项 → W4 内容搜索 → W5 实机对照点；搜索索引开启 `openAt startup+$DSH_HOME 持久化`（坑 36 探测锁定 / 坑 37 app 未定义）；单测 16 项+图谱实测，见 `docs/plugin-inventory.md`
- **官网站点 ✅（2026-09-09）**：`website/` VitePress 中文站点（首页 Landing + 用户指南 8 页：安装/快速上手/工作区/桌面能力/设置/更新/FAQ/下载）→ GitHub Pages 项目页 `https://lansi-ai.github.io/dsh-forge/`；`npm run docs:dev|build|preview`；CI `deploy-pages.yml`
- **品牌 logo 自有化 ✅（2026-09-09）**：应用图标（= 标题栏品牌 logo / 窗口 / 任务栏 / 安装包）改用自有金标（`scripts/process-logo.cjs` 从根 `logo.png` 抽透明通道，`npm run logo`）；官网导航/首页/favicon 同步；托盘图标仍为官方鲸鱼
- ⏸️ M2-c 旧插件门禁置后（载体待确认，不阻塞）；R6 技术债留 M5

### M3-b4 · dogfood 门禁（🔄 进行中）
- [ ] 全量回归（M1+M2+M3 全链）+ `netstat` 零监听再验证 + 崩溃恢复/多窗口组合测试（多窗口仅验「不崩不干扰」）
- [ ] **待实机点验（2026-09-04 批次）**：外观 section V2（#8）· 图标需求清单+新建包（#9）· 图标光学归一（#10）· 标题栏图标主题化（#11）· 全局图标分层 D-23（#12）· 工作区图标槽位 4 项（搜索/视图选项/新建/文件夹两态；`ICON_SLOTS` 增 match 官方 path 特征，上传自动并写包内 ui-overrides.json，ui-icons 覆盖层升级 themeIcon 内联上色 + img 兜底）
- [ ] 上游 0.1.2 系列实机冒烟随 dogfood 合并观察（重点：session 域重构后对话流/历史分页/审计无回归；rc.1 首次跨线验 UI 发行物装载与 roster 装配）
- 问题登记 `docs/dogfood-issues.md`（跨会话移交锚点，新会话按 #N 直取）；排障 `$env:DSH_VERBOSE='1'`

### M6 · 全量自绘 UI（🔥 主线）
- [x] P1 骨架 = M3-c ✅；sidebar 壳 `@lansi-ai/dsh-desktop-sidebar` ✅（2026-09-01 实机验证）；`@lansi-ai/dsh-desktop-session-export` ✅（2026-09-02）
- [ ] **P2 外壳小件 · 当前焦点 = `@lansi-ai/dsh-desktop-brand`（sidebar.brand.mark + sidebar.brand.name 洞）**，会话 header 重排评估（✅ 前置：标题栏 logo 复用 app-icon PNG 已落地，见 dogfood #14）
- [ ] **P3 侧栏已全量完成 ✅（2026-09-08 实机验收）**：workspaces W1–W5（含 picker 承重、派生层、行组件/视图选项、内容搜索 + 索引开启），见里程碑索引
- [ ] P4 对话主区（最大单件）：ui-conversation/ui-renderer/ui-input-trigger/ui-attachment/ui-reference → 自研 dsh-desktop-conversation 族
- [ ] P5 过程可视化：ui-tool/ui-subagent/ui-plan/ui-goal/ui-jobs/ui-skill/ui-workflow-run/ui-trajectory
- [ ] P6 设置与底座：ui-settings 6 section + ui-theme/ui-locale/ui-model-selection/ui-permission-presets
- [ ] M6 门禁：每阶段对照官方不回归 + dogfood 无感切换；全部完成后功能性 ui-* 全量入 CLIENT_EXCLUDE_IDS；M6-x harness 基线动态化（前置 M4-b，随 M4 延后）

### M4 · 分发与更新（⏸️ 剩余项延后）
- ✅ M4-a2 R10 协议安全白名单（dsh:// 来源校验 + zod 强校验）· ✅ M4-b 三通道稳定自动更新（stable/rc/off + 运行时切换，v0.1.1-alpha.4 链路验证）· M4-a3 零依赖实机验证 🔄（首轮已验，待新包复验）
- ✅ **发版脚本 + 坑 41 根治（2026-09-09）**：`npm run release -- <version> [--local] [--clean] [--push]`（预检→门禁→bump→commit/tag→push 一条链，push 以 `ls-remote` 回验避坑 44）+ `scripts/align-release-assets.cjs` 产物名对齐 latest.yml path（本地与 CI 共用，win/mac workflow 已插入该步）；用法见 `docs/10-development.md` §9 + README「发版（维护者）」
- [ ] M4-c 离线 e2e · M4-e 门禁（≥3 人安装即用 + SHA256SUMS 外部可验证）

## 03. 活跃决策与风险（一行索引；全文找 git 历史 / `docs/adr/`）
- **活跃决策**：D-18 布局接管 root 槽位 · D-19 scope=`@lansi-ai/dsh-*` · D-20 全量自绘 · D-21 骨架宿主化（`--dsd-*` 外观契约）· D-22 启动即时响应 · D-23 图标资产 global（`userData/icons/`）/pack（包内 `icons/`）分层 · **D-24 用户数据跟随 `$DSH_HOME`、设备数据（指针/Chromium 缓存/审计）留 userData（ADR-008）** · **D-25 品牌 logo 自有化（2026-09-09）**：应用图标（标题栏品牌 logo/窗口/任务栏/安装包）为自有金标（`logo.png` → `scripts/process-logo.cjs`），托盘图标保留官方标识
- **基座决策**：D-1 主进程内嵌 Cordis Host · D-2 IPC fetch 载波零端口 · D-5 roster/manifest 覆盖不改 dist · D-6 `ctx.webServer` 等价面 · D-8 第三方经 `buildThirdPartyBundleDecl` 装载（详见 `docs/adr/`）
- **铁律**：绝不改官方代码；官方未自有化处只走适配器；官方 `#root` 保留原生自适应，只用 padding/圆角垫层（坑 20）；自绘样式一律 important 化（坑 19）
- **风险 open**：R6 `!!js` 不求值 · R9 多窗口内存（M5 验）；R10 协议安全已收口（M4-a2 白名单+降级，2026-09-08）· 原「R7 `.runtime` 硬编码」已由 ADR-008 收口；全录见 `docs/11-risks.md`
- **技术债**：`dsh-cordis-host-runner` 未装载 → 动态插件运行不支持（客户端半已清噪，插件清单经 cordis-inventory 兼容面查看；M5 评估装载链）

## 04. 下一步即时行动 (Next Immediate Actions)
- **当前焦点**：M6-P2 外壳小件 `@lansi-ai/dsh-desktop-brand`（sidebar.brand.mark + sidebar.brand.name 洞）→ 会话 header 重排评估；同期梳理 P4 对话主区（ui-conversation 族）摸底
- **数据面（2026-09-09 已收口）**：ADR-008 数据根分层落地——用户数据跟随 `$DSH_HOME`、设备目录只剩指针+Chromium 缓存+审计；实机验证通过（首启选目录、会话落 home、重启历史可读、旧 `dsh-desktop` 目录自动更名）
- **待手动（官网上线）**：GitHub 仓库 Settings → Pages → Source 选「GitHub Actions」；之后 push `website/**` 即自动部署 `https://lansi-ai.github.io/dsh-forge/`
- dogfood 问题按 `docs/dogfood-issues.md` #N 直取；上游升级 `npm run upstream:auto`（每日 02:00 自动，**判据源=GitHub releases**；升级成功后按脚本打印的 `[TODO] 台账待人工同步` 清单收口）。当前上游 pending：待 `0.1.3-alpha.1` 上 npm 后先 `assess` 再人工适配，勿硬升
- **按需查阅台账**：`docs/pitfalls.md`（坑 1~N 排障档案）· `docs/dogfood-issues.md`（dogfood 现场）· `docs/upstream-contracts.md`（拴合面速查 + 升级 SOP）· `docs/upstream-migrations.md`（升级台账 C 区）· `docs/11-risks.md`（风险全录）· `docs/adr/`（架构决策全文）
- ⚠️ **环境红线（省 token 用）**：`npm start` / `npm run dev` / `npm run dist` 在**沙箱内必失败**——运行时数据目录 `E:\Projects\DSHPath`（凭据 `.lock` / 搜索索引 `-shm`）与 `AppData` 缓存在工作区外；表现可能是业务错误壳（如 `loader entries failed to apply`），**先看输出尾部 `TRAE Sandbox Error` 再动手**，直接授权沙箱外运行即可；`git push` 报 `unable to write credential store` 属伪失败（推送已完成，坑 44）。见坑 0 / 38 / 42 / 44

## 05. 看板维护协议（防膨胀硬约束 · workflow.md 场景 F）
- 本文件是**滚动窗口 ≤100 行正文**：任务完成 = 一行收口（标题 + 日期 + 坑号/台账链接），**过程细节不进看板**——归 `docs/pitfalls.md`（坑档）/ `dogfood-issues.md`（现场）/ `upstream-migrations.md`（升级）/ commit message
- 里程碑收尾：整节压缩并入「里程碑索引」；删除线、被覆盖项、已 closed 风险一律清除
- **触发即执行**：看板正文超 100 行 → 立即瘦身，无需用户提醒
- 同步要求不变：MD 更新后必须同步重绘 `docs/active-context.html`（workflow.md 05 节 4 步闭环）
