---
description: 项目当前 Sprint 激活上下文与动态任务看板（dsh-forge · 滚动窗口 ≤100 行，维护协议见 05 节）
globs: "*"
alwaysApply: true
---

# 激活上下文与任务看板 (active-context.md)

> 本文件是**滚动窗口**：只保留「活」信息；完成条目一行收口，过程细节归 docs 台账与 git log，历史全文可从 git 历史找回。

## 01. 当前迭代目标 (Current Sprint Goal)
- **阶段**：M3 代码全部完成（2026-08-26）→ **M6 全量自绘 UI 主线（D-20 · ADR-006）**；M3-b4 dogfood 进行中（= M3 收尾门禁，不阻塞自绘）；M4 分发整体延后，重启时机 = 自绘可日常使用
- **M6 主线**：逐槽位替换官方 ui-*（P1 骨架 ✅ → P2 外壳 → P3 侧栏 → P4 对话区 → P5 过程可视化 → P6 设置底座），每阶段可用可验证；数据面零新增（IPC 载波 + desktopBridge）
- **上游基线**：`dsh-v0.1.5-rc.2`（2026-09-11 人工适配升级，REVIEW 判定经用户决策：ui-primitives/ui-chat 两包差异人工内容级 diff 摸底均为呈现层、两包入口零变化，**零代码适配**，见 C-7；前基线 alpha.2 见 C-6；每日 02:00 北京时间定时任务跑 `npm run upstream:auto`；**新版判据源 = GitHub releases**，npm 仅作「是否可安装」校验，判定 safe 才动；升级后台账人工同步硬约束见 workflow.md 场景 D）
- **上游待办（pending）**：无（原 `0.1.3-alpha.1` pending 随 C-5 升级一并跨越收口）；下一版本出现时按预评→人工对照流程，破坏性变更禁 auto 硬升（坑 31）

## 02. 任务看板 (Task Kanban · 滚动窗口)

### 里程碑索引（一行收口；历史全文找 git log）
- M1 桌面骨架 ✅ · M2 桌面能力插件化 ✅ · M3 代码侧 ✅（2026-08-25~26）
- M3-c 布局/标题栏/骨架宿主化 ✅（= M6-P1，2026-09-01 实机验证）
- M3-a4 命令面板 + M3-a5 多窗口验证 ⏸️ 用户决策挂起（Ctrl+K 已隐藏；恢复 = revert `forge-cmdpalette-client.js` 禁用壳）
- M4-a1 electron-builder 基建 ✅；v0.1.1-alpha.1~alpha.3 Win/mac 安装包发布 ✅；**v0.1.1-alpha.4 发布 ✅（2026-09-08 · CI win+mac 双平台自动构建并上传 GitHub Releases pre-release；坑 41：资产名对齐 latest.yml path 后自动更新链路匿名 HEAD 200 验证）**；**v0.1.1-alpha.5 发布（2026-09-09 · 首载 M4-a4 数据目录分层/DSH Forge 命名/规则收敛，tag 推 CI 双平台构建）**；**v0.1.1-alpha.6 发布（2026-09-09 · 载 M4-a1 根锚点入 asar 修复安装版无法聊天，坑 45）**；**v0.1.1-alpha.7 发布（2026-09-10 · 载 0.1.5-alpha.2 基线升级 + 启动报错根治/右侧栏面板恢复，坑 46/47/48；tag 推 CI 双平台构建）**；**v0.1.1-alpha.8 发布（2026-09-10 · 载 更新链诊断面 + 网络代理设置（三态）+ 手动检查结果反馈，坑 50/51/52；tag 推 CI 双平台构建）**；**v0.1.1-alpha.9 发布（2026-09-10 · 载 标题栏版本号自有化，dogfood #20；tag 推 CI 双平台构建）**；**v0.1.1-rc.1 发布 ✅（2026-09-10 · `0.1.1` 线首个 `rc` 候选：极简模式 token 修复（坑 53）+ 品牌资产 v2（坑 54）+ 创造模式修复（坑 55）+ 自研插件命名空间全量更名 `dsh-forge`（D-27）；CI 双平台出包、更新说明人工写入 Release、匿名 HEAD 200 复核通过；**open：未产出 `latest-rc.yml`（实测 404）→ 应用内 rc 渠道不自动可见**）**（打包链坑见 `docs/pitfalls.md`）
- M4-d 上游升级链：rc.8 → alpha.3（载波整链重写，方案见 `docs/m4-d3-012-alpha3-migration-plan.md`）→ alpha.4 → alpha.5（`scripts/upstream.cjs` 自动化首跑）→ rc.1（首次跨 next 线）→ 0.1.5-alpha.1（2026-09-09 人工适配 · C-5：rightbar 契约 + 官方新增 9 包全装 + boot.ts 3 host 行 + workspaces state/owningGroupKey，typecheck/lint/build/17 单测/图谱 61 条目全绿）→ **0.1.5-alpha.2（2026-09-10 人工适配 · C-6：ui-* 六包契约差异摸底无破坏 + primitives 官方内联 dist + textpreview 随官方换代 documentpreview，typecheck/lint/build 全绿）** → **0.1.5-rc.2（2026-09-11 人工适配 · C-7：ui-primitives/ui-chat 两包差异均为呈现层且两包入口零变化，零代码适配，typecheck/lint/build/30 单测全绿）**；登记 `docs/upstream-migrations.md` C-1~C-7
- M4-d6 工具修正 ✅（2026-09-07）：`check` 判据源 npm dist-tags → **GitHub releases**（npm 降级为可安装校验，新增 pending 三态），修「连续 3 天漏检 0.1.3-alpha.1」，见坑 31 / ADR-005 第 6 条
- **M4-a4 数据目录分层 ✅（2026-09-09 · ADR-008）**：sessions/storages/themes/icons/window-state 归位 `$DSH_HOME`（幂等迁移，失败保持原位）+ 应用命名统一 `DSH Forge`（旧设备目录/旧注册表键自动迁移）+ 卸载删除路径安全校验 + `--data-dir` 与注册表种子；typecheck/lint/29 单测/build 全绿 + **实机验证通过（2026-09-09）**
- 规则目录收敛 ✅（2026-09-09）：规则唯一来源 = `.trae/rules/`（6 文件，含 `rtk-usage.md`）并入 git 跟踪（`.gitignore` 加例外），陈旧副本 `.rules/` 已删（历史留 git）
- **自研插件命名空间全量自有化 ✅（2026-09-10 · D-27）**：插件 ID `@lansi-ai/dsh-desktop-*` → `@lansi-ai/dsh-forge-*`（15 个 client + host 侧命名）；目录 `src/desktop-{host,shell}` → `src/forge-{host,shell}`，`desktop-*.ts` / `desktop-*-client.js` / `desktop-patch.yml` → `forge-*`，CSS 类 `.dsh-desktop-*`、样式 ID `dsh-*-appearance-vars`、日志标签 `[dsh-desktop]`、`docs/07-desktop-shell.md` 一并更名；**迁移常量 `LEGACY_APP_DIR_NAME='dsh-desktop'` 与历史台账（pitfalls/dogfood/upstream/adr）保留原样**；typecheck/lint/build/30 单测全绿
- **M6-P3 侧栏 workspaces ✅（2026-09-08 实机验收）**：`@lansi-ai/dsh-forge-workspaces` W1 五接管+picker 承重（坑 35）→ W2 派生层 → W3 Rows/视图选项 → W4 内容搜索 → W5 实机对照点；搜索索引开启 `openAt startup+$DSH_HOME 持久化`（坑 36 探测锁定 / 坑 37 app 未定义）；单测 16 项+图谱实测，见 `docs/plugin-inventory.md`
- **官网站点 ✅（2026-09-09）**：`website/` VitePress 中文站点（首页 Landing + 用户指南 8 页：安装/快速上手/工作区/桌面能力/设置/更新/FAQ/下载）→ GitHub Pages 项目页 **已上线 `https://lansi-ai.github.io/dsh-forge/`**（Pages Source=GitHub Actions；首页与 `/guide/quickstart` 实测可达，cleanUrls/侧栏/上下篇/编辑此页均正常）；`npm run docs:dev|build|preview`；CI `deploy-pages.yml`
- **品牌 logo 自有化 ✅（2026-09-09）**：应用图标（= 标题栏品牌 logo / 窗口 / 任务栏 / 安装包）与托盘图标改用自有金标（`scripts/process-logo.cjs` 从根 `logo.png` 抽透明通道，`npm run logo`，共 10 个产物）；官网导航/首页/favicon 同步
- ⏸️ M2-c 旧插件门禁置后（载体待确认，不阻塞）；R6 技术债留 M5

### M3-b4 · dogfood 门禁（🔄 进行中）
- [ ] 全量回归（M1+M2+M3 全链）+ `netstat` 零监听再验证 + 崩溃恢复/多窗口组合测试（多窗口仅验「不崩不干扰」）
- [ ] **待实机点验（2026-09-04 批次）**：外观 section V2（#8）· 图标需求清单+新建包（#9）· 图标光学归一（#10）· 标题栏图标主题化（#11）· 全局图标分层 D-23（#12）· 工作区图标槽位 4 项（搜索/视图选项/新建/文件夹两态；`ICON_SLOTS` 增 match 官方 path 特征，上传自动并写包内 ui-overrides.json，ui-icons 覆盖层升级 themeIcon 内联上色 + img 兜底）
- [ ] 上游 0.1.5-rc.2 实机冒烟随 dogfood 合并观察（重点：交付文件卡片排版/对话间距、代码文件图标换全彩 artwork、会话统计 cacheWrite=0 隐藏该行、反馈弹窗确认；0.1.5 系 session 域与 roster 装配无回归；**工作区侧栏内联图标槽位 match 特征基于 dist 探测、未被 assess 覆盖，需一并点验**）
- [x] **#15 安装版无法聊天 ✅（2026-09-09 · 坑 45）**：根锚点 cordis.yml 移入 asar（copy-web 生成 `dist/cordis.yml` + boot 打包分支改 `app.getAppPath()/dist/cordis.yml`），win-unpacked 实机验证预设 4 个无 broken + `session/prompt` 通 + 会话落盘；**待发 alpha.6 方可到达存量安装版**
- [x] **#16 启动期 rightbar 崩溃（`usePanelInfo is not a function`）✅（2026-09-10 · 坑 46/47）**：0.1.5 rightbar 契约——自研 layout 补齐官方 `panelInfo` root hook（实机验证该类报错消失）；附带根治 index.html 无缓存头致注入图谱陈旧（入口 URL 加启动版本 query + no-store）
- [x] **#17 `sessions in inactive context` 启动刷屏 ✅（2026-09-10 · 坑 48）**：真因＝自研 layout 只声明 `conversation` 而漏官方语义的 `main`（keyed+root），致上游 ui-conversation 自建该槽位并继承 `session-maybe` → agent-preset 条目随会话状态反复重建、踩 Cordis 激活窗口；单变量对照（官方 web 版无此错 / 换回官方 ui-layout 报错消失）锁定，补齐 `main` 槽位后启动零报错
- [x] **#21 极简模式 token 远超官方 ✅（2026-09-10 · 坑 53）**：宿主 roster 抄了官方 `dsh-base` 全量 insert，却漏抄官方 web profile 的 **23 行「模型可见」关停表** → 全局层工具渗进所有预设（`view(scope) = global + 链`，`persona.complete` 只裁提示词段落）；已补 `boot.ts` §3b 24 行 disabled + 删除被 shipped 根永久遮蔽的自带 standard 预设（预设来源回归官方 shipped 根）；typecheck/lint/build/30 测试全绿 + **实机验证通过（2026-09-10 · 用户确认）**
- 问题登记 `docs/dogfood-issues.md`（跨会话移交锚点，新会话按 #N 直取）；排障 `$env:DSH_VERBOSE='1'`
- [x] **#23 创造模式（`cordis` 预设）挂载失败 ✅（2026-09-10 · 坑 55）**：预设行 `tool-cordis` 静态 inject `dynamicCordisRunner`/`cordisInspect`，而宿主半 `cordis-host-runner` **从未 insert**（§3 那条 `disabled` 是「禁用未插入行」的空操作）；已按官方 web profile 回填三处——§1 insert 宿主半 + boot-graph 回填 client 两半（cordis-client-runner / ui-cordis）+ 自绘侧栏补声明并渲染 `sidebar.footer.action`；`cordis-inventory` 兼容面退役 `dynamicCordisRunner/inventory`（只留 `pluginInventory/list`，防遮蔽官方实现）；安全口径登记 `docs/08-security.md` §4；typecheck/lint/build 全绿 + **实机验证通过（2026-09-10 · 用户确认）**

### M6 · 全量自绘 UI（🔥 主线）
- [x] P1 骨架 = M3-c ✅；sidebar 壳 `@lansi-ai/dsh-forge-sidebar` ✅（2026-09-01 实机验证）；`@lansi-ai/dsh-forge-session-export` ✅（2026-09-02）；**2026-09-10 补齐接管面：官方 ui-layout 的 `panelInfo` root hook（坑 46）+ `main`(keyed/root) 槽位语义（坑 48 —— 缺它致上游 ui-conversation 的注册被隐式降为 session-maybe scope）**
- ✅ **标题栏版本号自有化（2026-09-10 · 用户指定 · dogfood #20）**：`.dsh-forge-titlebar-brand-version` 由上游基线（`__DSH_BASE_VERSION__`）改显自有版本 `v${__DSH_APP_VERSION__}`（协议层新增注入 = `app.getVersion()`，与基线合成同一 script）；上游基线降为悬停 `title`，关于页两者仍并存
- ✅ **品牌资产 v2 · 黑底（2026-09-10 · 用户指定 · dogfood #22 · 坑 54）**：应用/托盘/Dock 图标改「纯黑 `#000000` + 22% 圆角实底 + 金标」（`process-logo.cjs`，浅深两版同形）；标题栏品牌标记**独立为透明底 `brand-mark-{light,dark}.png`**（新 global 槽位，revert dogfood #14 的复用口径）；存量安装靠**品牌修订号 `BRAND_REVISION` + 哈希标记**自动刷新（`syncGlobalBrandAssets` 取代只增不改的包根迁移）；typecheck/lint/30 测试/build 全绿 + **任务栏/托盘实机确认（2026-09-10 · 用户点验）**；桌面快捷方式/安装包图标已随 v0.1.1-rc.1 重新打包（待点验）
- [ ] **P2 外壳小件 · 当前焦点 = `@lansi-ai/dsh-forge-brand`（sidebar.brand.mark + sidebar.brand.name 洞）**，会话 header 重排评估（✅ 前置：标题栏品牌标记已独立为 `brand-mark-*.png` 全局槽位，见 dogfood #22）
- [ ] **P3 侧栏已全量完成 ✅（2026-09-08 实机验收）**：workspaces W1–W5（含 picker 承重、派生层、行组件/视图选项、内容搜索 + 索引开启），见里程碑索引
- [ ] P4 对话主区（最大单件）：ui-conversation/ui-renderer/ui-input-trigger/ui-attachment/ui-reference → 自研 dsh-forge-conversation 族
- [ ] P5 过程可视化：ui-tool/ui-subagent/ui-plan/ui-goal/ui-jobs/ui-skill/ui-workflow-run/ui-trajectory
- ✅ **P6 首件 · 插件列表全自研（2026-09-10）**：界面件 `@lansi-ai/dsh-forge-plugin-inventory` 接管 `settings.plugins.tab`（桌面定制口径 v3：两级分组「全局插件 / 预设组成」+ 承载面筛选 chips + 精简两行、点行展开详情；预设组成组带**预设切换器**并照列已停用/条件行——对齐官方「会话插件 · N 个」（极简模式 = 6 行）；官方同名 Tab 入 `CLIENT_EXCLUDE_IDS`，「插件」section 外壳仍官方）；数据面 `cordis-inventory.ts` 由「仅客户端图谱」升级为**三源合并**（Cordis 真实 Loader 条目 ∪ 客户端图谱 ∪ 预设组成；新增 `bindCordisInventoryHost` 于 boot 后绑定），根治「forge 搜不到 tool-pwsh」——官方读 Loader 真实树、forge 旧实现只读图谱致宿主侧插件全缺，见坑 57；typecheck/lint/build/30 单测全绿 + **实机验证通过（2026-09-11 · 用户确认：极简模式 6 行、预设切换器与分组均正确）**
- [ ] P6 设置与底座（余）：ui-settings 余下 section + ui-theme/ui-locale/ui-model-selection/ui-permission-presets
- [ ] M6 门禁：每阶段对照官方不回归 + dogfood 无感切换；全部完成后功能性 ui-* 全量入 CLIENT_EXCLUDE_IDS；M6-x harness 基线动态化（前置 M4-b，随 M4 延后）

### M4 · 分发与更新（⏸️ 剩余项延后）
- ✅ M4-a2 R10 协议安全白名单（dsh:// 来源校验 + zod 强校验）· ✅ M4-b 三通道稳定自动更新（stable/rc/off + 运行时切换，v0.1.1-alpha.4 链路验证）· M4-a3 零依赖实机验证 🔄（首轮已验，待新包复验）
- ✅ **发版脚本 + 坑 41 根治（2026-09-09）**：`npm run release -- <version> [--local] [--clean] [--push]`（预检→门禁→bump→commit/tag→push 一条链，push 以 `ls-remote` 回验避坑 44）+ `scripts/align-release-assets.cjs` 产物名对齐 latest.yml path（本地与 CI 共用，win/mac workflow 已插入该步）；用法见 `docs/10-development.md` §9 + README「发版（维护者）」
- ✅ **#18 更新失败零可观测性 → 诊断面已验证（2026-09-10 · 坑 50/51）**：updater 关键相位落 `audit.jsonl`（`downloading` 进度帧拦截，含 channel / errorStack）+ 关于页 error 相位显示 `status.error` 原文；顺带修 `error` 字段从不重置。**open：① `rc` 渠道名与 tag `-alpha.N` 不匹配（预发布渠道必然失败）② 更新源依赖 `github.com`，国内呈 IP 级不可达（Gitee 备选已实测链路，待验 132MB 上传上限）**；实机验证已闭环：真因捕获 = `net::ERR_CONNECTION_RESET`（关于页显示原文 + 审计落盘 `checking`/`error`）
- ✅ **网络代理设置（通用设置「网络设置」）✅（2026-09-10 · M4-b 配套）**：三态 direct/system/manual —— host 模块 `src/forge-host/forge-proxy.ts` + 自研插件 `@lansi-ai/dsh-forge-network`（注入 `settings.general.item`）；**关键点：updater 走独立 session 分区 `electron-updater`，必须对其单独 `setProxy`（只设 defaultSession 会静默失效）**；作用域限 Chromium 栈（模型 API 等 Node 栈请求不在内，UI 已标注）；立即生效无需重启，配置落 settings `desktop`；typecheck/lint/30 单测/build 全绿 + **实机验证通过（2026-09-10 · 用户确认）**；拴合面已登记 `docs/upstream-contracts.md` §7.1/§7.2
- ✅ **#19 手动「检查更新」结果零反馈 ✅（2026-09-10 · 坑 52）**：`check()` 拆 `checkInternal(manual)` 分流手动/静默；手动检查的 `not-available`/`error` 补系统通知（**仅主窗口未聚焦**，错误取首行摘要）+ `manual` 随 `app-update:status` 下行 → 关于页 6 秒结果提示；静默自检与渠道/开关联动保持安静（无契约破坏，payload 本为 `z.unknown()`）
- ✅ **检查更新链路端到端已验证（2026-09-10 · dogfood #18 收口）**：安装版 **alpha.7 → 自更新至 alpha.8 → 再自更新至 alpha.9**，检查更新 / 自动下载 / 重启安装 / 新版运行**全通**（`latest.yml` 匿名 HEAD 200 + 注册表版本号随升级更新）
- [ ] M4-c 离线 e2e · M4-e 门禁（≥3 人安装即用 + SHA256SUMS 外部可验证）

## 03. 活跃决策与风险（一行索引；全文找 git 历史 / `docs/adr/`）
- **活跃决策**：D-18 布局接管 root 槽位 · D-19 scope=`@lansi-ai/dsh-*` · D-20 全量自绘 · D-21 骨架宿主化（`--dsd-*` 外观契约）· D-22 启动即时响应 · D-23 图标资产 global（`userData/icons/`）/pack（包内 `icons/`）分层 · **D-24 用户数据跟随 `$DSH_HOME`、设备数据（指针/Chromium 缓存/审计）留 userData（ADR-008）** · **D-25 品牌 logo 自有化（2026-09-09）**：应用图标（标题栏品牌 logo/窗口/任务栏/安装包）与托盘图标均为自有金标（`logo.png` → `scripts/process-logo.cjs`；托盘为圆角实底 + 放大金标，保 16px 可辨识）· **D-26 cordis 双半启用（2026-09-10 · 创造模式）**：宿主半 `cordis-host-runner` insert + 客户端两半（cordis-client-runner / ui-cordis）回填 + 侧栏 `sidebar.footer.action` 槽位（dogfood #23）；安全口径 = 动态包 ≈ bash 访问、vm 非安全边界（`docs/08-security.md` §4）· **D-27 自研插件命名空间统一 `dsh-forge`（2026-09-10）**：插件 ID / 目录 / 文件名 / CSS 前缀全量更名，迁移常量与历史台账保留
- **基座决策**：D-1 主进程内嵌 Cordis Host · D-2 IPC fetch 载波零端口 · D-5 roster/manifest 覆盖不改 dist · D-6 `ctx.webServer` 等价面 · D-8 第三方经 `buildThirdPartyBundleDecl` 装载（详见 `docs/adr/`）
- **铁律**：绝不改官方代码；官方未自有化处只走适配器；官方 `#root` 保留原生自适应，只用 padding/圆角垫层（坑 20）；自绘样式一律 important 化（坑 19）；**宿主 roster 抄官方必须连官方 profile 的 `disabled` 关停表一起抄——模型可见能力（工具/指令/计划段）归 agent 预设所有，宿主平面残留会渗进所有预设（坑 53）**；**客户端资源图谱 ≠ Cordis 真实插件树——凡「已装载插件」语义的清单必须读 `ctx.loader.entries()`，图谱只含界面半（坑 57）**
- **风险 open**：R6 `!!js` 不求值 · R9 多窗口内存（M5 验）；R10 协议安全已收口（M4-a2 白名单+降级，2026-09-08）· 原「R7 `.runtime` 硬编码」已由 ADR-008 收口；全录见 `docs/11-risks.md`
- **技术债**：无新增待记项（原「`dsh-cordis-host-runner` 未装载 → 动态插件运行不支持」已随 dogfood #23 / 坑 55 收口）

## 04. 下一步即时行动 (Next Immediate Actions)
- **当前焦点**：M6-P6 首件「插件列表」数据面 + 界面面已全自研并**实机验证通过（2026-09-11）**→ 回到 M6-P2 外壳小件 `@lansi-ai/dsh-forge-brand`（sidebar.brand.mark + sidebar.brand.name 洞）→ 会话 header 重排评估；同期梳理 P4 对话主区（ui-conversation 族）摸底
- **待实机点验（2026-09-10 批次）**：**品牌资产 v2 黑底**（dogfood #22）—— 任务栏/托盘已确认（用户点验）；启动日志有 `[dsh-theme] 品牌资产已同步到全局图标目录（修订号 legacy → 2…）`；**仍待**：外观页「品牌标记」独立上传项、桌面快捷方式/安装包图标（已随 v0.1.1-rc.1 打包，待点验）
- **待实机点验（命名空间改名后）**：`dsh-forge` 全量更名后需一次实机启动，确认 15 个自研 client 插件按新 ID 装载、侧栏/设置/外观/工作区无回归（旧 rev 缓存的 index.html 已由启动版本 query + no-store 兜住）；**载体已就绪 = v0.1.1-rc.1（win setup/portable + mac dmg/zip 双架构）**
- **更新链待决策（2026-09-10 · 坑 50 / dogfood #18）**：诊断面已补（审计落盘 + 关于页显示失败原文），用户侧排障不再靠猜；**open 三项**——① 渠道命名对齐（**进展 2026-09-10：已真出 `-rc.1` tag + 预发布 Release，但 CI 未产出 `latest-rc.yml`（匿名探针实测 404）→ 应用内 rc 渠道仍不自动可见；剩余方案 B = `electron-builder` 配 `channel: rc` + CI 一并上传该描述符**）② 更新源去 `github.com` 依赖（Gitee 已实测：无 `releases.atom` → 必须 generic provider、raw 可作 yml 固定宿主、`releases/download/{tag}` 匿名可读；待验 132MB 单文件上传上限；或国内对象存储 + 自有域名，或就在可用代理下使用）③ 手动检查在阻断环境下挂起约 24 秒且无进度反馈（实测 12:49:33→12:49:57），待定是否加显式超时；**新增可用路径**：通用设置→网络设置→手动设置（如 127.0.0.1:7890）可让更新与页面请求走本地代理；**链路本身已端到端验证通过**（alpha.7→alpha.8→alpha.9 连续自更新跑通），①② 属面向陌生环境的加固、③ 仅在无代理的阻断环境下出现
- **数据面（2026-09-09 已收口）**：ADR-008 数据根分层落地——用户数据跟随 `$DSH_HOME`、设备目录只剩指针+Chromium 缓存+审计；实机验证通过（首启选目录、会话落 home、重启历史可读、旧 `dsh-desktop` 目录自动更名）
- dogfood 问题按 `docs/dogfood-issues.md` #N 直取；上游升级 `npm run upstream:auto`（每日 02:00 自动，**判据源=GitHub releases**；升级成功后按脚本打印的 `[TODO] 台账待人工同步` 清单收口）。当前上游基线 0.1.5-rc.2 待实机冒烟（重点：交付文件卡片排版/对话间距、代码文件图标换全彩 artwork、会话统计 cacheWrite=0 隐藏该行、反馈弹窗；工作区侧栏内联图标槽位 match 特征需一并点验）；新版出现时按预评→人工对照流程，破坏性变更禁 auto 硬升
- **按需查阅台账**：`docs/pitfalls.md`（坑 1~N 排障档案）· `docs/dogfood-issues.md`（dogfood 现场）· `docs/upstream-contracts.md`（拴合面速查 + 升级 SOP）· `docs/upstream-migrations.md`（升级台账 C 区）· `docs/11-risks.md`（风险全录）· `docs/adr/`（架构决策全文）
- ⚠️ **环境红线（省 token 用）**：`npm start` / `npm run dev` / `npm run dist` 在**沙箱内必失败**——运行时数据目录 `E:\Projects\DSHPath`（凭据 `.lock` / 搜索索引 `-shm`）与 `AppData` 缓存在工作区外；表现可能是业务错误壳（如 `loader entries failed to apply`），**先看输出尾部 `TRAE Sandbox Error` 再动手**，直接授权沙箱外运行即可；`git push` 报 `unable to write credential store` 属伪失败（推送已完成，坑 44）。见坑 0 / 38 / 42 / 44

## 05. 看板维护协议（防膨胀硬约束 · workflow.md 场景 F）
- 本文件是**滚动窗口 ≤100 行正文**：任务完成 = 一行收口（标题 + 日期 + 坑号/台账链接），**过程细节不进看板**——归 `docs/pitfalls.md`（坑档）/ `dogfood-issues.md`（现场）/ `upstream-migrations.md`（升级）/ commit message
- 里程碑收尾：整节压缩并入「里程碑索引」；删除线、被覆盖项、已 closed 风险一律清除
- **触发即执行**：看板正文超 100 行 → 立即瘦身，无需用户提醒
- 同步要求不变：MD 更新后必须同步重绘 `docs/active-context.html`（workflow.md 05 节 4 步闭环）
