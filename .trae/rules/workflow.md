---
description: AI 编码与工程协作 SOP、微观业务契约对齐、上下文预检流水线与规则自我演进协议（dsh-forge）
globs: "*"
alwaysApply: true
---

# 工作流与协作 SOP (workflow.md)

## 00. 编码前的业务与契约确认 (Context Alignment)
开始编写 DTO / Schema / 插件 / 载波代码前，AI **严禁直接盲目写代码**，必须先做极简微观契约确认：
1. **主流程路径**：当前 Task 的具体动作与核心结果（Input/Output）——如 IPC 帧的 `rpcId` 绑定、`respond` 回填语义、`dsh-ui://` 装载目标。
2. **异常与逆向状态**：重复应答（`not-pending`）、未注册路径 fetch（白名单报错）、协议加载失败（退回 `--serve`）、崩溃重启熔断。
3. **数据校验规则**：所有 IPC 入参先过 `zod`；帧结构逐字遵守官方四象限协议（rpcId 纪律）。
4. **MVP 交付边界**：明确该 Task 是否属于 `active-context.md` 当前步骤；不在本次 Task 扩张无关能力。

👉 **AI 执行指令**：Step 启动时抛出【编码前契约确认】2–3 问；用户回答后**一句话总结契约并询问："确认没问题我就开始写 Schema 和代码了？"** 待肯定答复才动工。

## 01. 任务开始前的预检流水线 (Pre-execution Protocol)
契约确认后执行 3 步预检：
1. **读取 L3**：核对 `active-context.md`，确认任务符合当前 Sprint 目标与"下一步即时行动"。
2. **核对 L2**：确认创建/修改文件路径符合 `architecture.md`（`forge-shell`/`forge-host`/`forge-compat`/`forge-plugins`/`preload`/`types`）与单向依赖。
3. **检查 L1**：确认技术栈（TS `strict`、零 `any`、zod 校验）、安全红线（禁硬编码凭据、禁非 `--serve` 端口监听、禁裸 IPC 直通）。

## 02. 编码与实现 SOP (Coding & Implementation Standard)
- **契约优先 (API-First)**：
  - 先定义 `src/types/` 的 zod Schema 与 channel 常量（`dsh:*`），作为唯一类型源头；preload / 载波变体 / 测试类型均由推导获得，禁止重复手写平行类型。
  - IPC 结果统一结构：成功返回数据，失败返回 `AppError`（`code` + `message` + `details`）；错误码集中 `errno.ts`。
- **剖面约束**：renderer 仅消费 `desktopBridge` 白名单；主进程不得反向依赖 renderer；桌面能力一律 host 插件（`ctx.desktop.*`）。
- **增量实现与颗粒度控制**：按 "契约 → bridge 宿主端 → preload → renderer 载波变体 → 测试" 单向推进；单 Task 处理 **1–3 个** 关联文件；严禁一次生成大量带 `TODO` 的伪代码。
- **注释与自解释**：新增函数带极简功能注释，复杂逻辑说明设计意图（中文）；严禁遗留 `TODO` / 未完成临时代码。

## 03. 交付前的质量自检链 (Quality Check Gate)
代码完成后、向用户汇报前必须通过：
- [ ] **业务逻辑自检**：是否满足 00 节正常路径（rpcId 绑定/respond 回填/帧路由）与异常边界（not-pending/白名单报错/熔断）。
- [ ] **语法与类型自检**：`npm run typecheck` 零错误、`npm run lint` 零告警；无 `any`/裸类型；错误捕获齐全。
- [ ] **契约与响应自检**：IPC 全走 zod 校验；帧语义与官方协议一致（零改写）。
- [ ] **路径与放置自检**：新文件路径完全匹配 `architecture.md`；插件不绕 `ctx.desktop.*`。
- [ ] **安全自检**：无凭据泄漏、无未校验外部输入、无非 `--serve` 端口监听、renderer 无裸 IPC（R-03/08）。
- [ ] **Git 提交准备**：Commit Message 符合 `git-commit-guide.md`；有契约破坏性变更必须 `!` 标注。

## 04. 特殊场景：规则自我演进与重构协议 (Rule Maintenance Protocol)
发生以下场景时 AI **必须主动提醒并同步更新对应规则文件**，禁止"规则与代码脱节"：
- 🔄 **场景 A：技术栈/规范变更（更新 L1 `core-standards.md`）**
  - 触发：引入新核心库/SDK（如换构建器）、更改安全要求、调整代码风格。
- 🏗️ **场景 B：目录/架构重构（更新 L2 `architecture.md`）**
  - 触发：新增业务子模块目录、拆分服务、调整数据流向（新 plugin 包/DTO 层）。
- ⚙️ **场景 C：协作流程调整（更新 `workflow.md` 自身）**
  - 触发：新增 CI 门禁、改变 Commit/Review 规范、修改 SOP 节点。
- 🔄 **场景 D：上游基线变更（更新 `docs/` 与 ADR）**
  - 触发：`dsh-v0.1.0-rc.x` 升级；动作 = 先 `build(upstream)` 迁移登记 diff，再刷新 01/11/ADR 事实表。
  - **自动化工具（2026-09-03 新增 · 2026-09-07 判据源改为 GitHub releases）**：`scripts/upstream.cjs` 提供 `check`（**以 GitHub `dsh-v*` releases 判上游新版**；npm dist-tags 降级为「该版本是否可安装」的发行校验，输出三态 = 无新版 / 可安装候选 / pending〔上游已 release、npm 未发行〕）/ `assess <ver>`（拴合面 diff + roster 存在性评估破坏性）/ `upgrade <ver>`（判定 safe 则自动 bump+install+typecheck/lint/build+迁移登记；目标版 npm 未发行直接 ABORT）/ `auto`（全自动流水线）。npm 脚本 `upstream:check` / `upstream:auto`。**判定 blocked / review / pending 时一律禁止自动升级**，须人工对照 diff 走本 SOP（坑 31）。
  - **⚠️ 台账同步硬约束（2026-09-04 补，防漏）**：脚本**只自动写** `docs/upstream-migrations.md` 的 C 区节，其余台账升级后**必须人工同步**才算升级闭环（脚本会在升级成功时打印 `[TODO]` 清单）：① `docs/upstream-migrations.md` 表头「基线版本」行；② `docs/upstream-contracts.md` 标题 + 复核标注行；③ `docs/12-references.md` 版本时点；④ `.trae/rules/active-context.md` 的 01 节「上游基线」行 + 02 节里程碑索引的「M4-d 上游升级链」行（追加新版本，一行收口），以及 `docs/active-context.html` 对应处。台账日期一律取**北京时区**。
- 📦 **场景 F：看板膨胀治理（瘦身 `active-context.md`）⚠️ 硬约束（2026-09-04 新增）**
  - 触发：`active-context.md` 正文超过 100 行；或里程碑收尾、任务条目收口时顺手执行。
  - 动作：按该文件 05 节维护协议执行——完成条目压缩为**一行收口**（标题 + 日期 + 坑号/台账链接），过程细节归 docs 台账（`pitfalls.md`/`dogfood-issues.md`/`upstream-migrations.md` + commit message）；里程碑整节压缩并入「里程碑索引」；删除线、被覆盖项、已 closed 风险一律清除；同步重绘 `docs/active-context.html`。
  - 原则：看板只存「活」信息（当前目标 + 未完成任务 + 下一步），历史全文永远可从 git 历史找回；**触发即执行，无需用户提醒**。
- 🩹 **场景 E：Bug 修复沉淀（追加 `docs/pitfalls.md`）⚠️ 硬约束**
  - 触发：AI 修复任何 Bug 之后——无论来源是**自己写代码引入的**、**用户贴报错提供的**、还是排查中发现的历史遗留——必须在汇报前立即写入坑档。
  - 格式：沿既有四段式 **现象（报错原文+日志标签）→ 根因（精确到代码行/库内部行为）→ 解法（修复后代码形态）→ 复盘要点（可迁移教训）**，编号顺延（坑 N）；一次修复一条，禁止延后补记或合并无关坑。
  - 若揭示可复用排障手法，同步补入该文件「通用排障方法论」小节。
  - **例外（D-17 · 2026-08-27）**：dogfood 小 bug（定义见 05 节轻量分级）的坑档落盘可延迟到**当日批次末**统一执行（不得跨日）；但 `docs/dogfood-issues.md` 台账必须**即时登记**（现象 + 第一现场 + 状态），作为跨会话移交锚点。

## 05. 任务完成后的状态闭环 (Post-execution Synchronization) ⚠️ 硬约束

任务完成并通过质量自检后，AI **必须按以下顺序逐项执行 1-4 步闭环**，**严禁合并或跳过任何一项**。这 4 步视为**一个原子操作**，全部完成后才能向用户汇报"任务已完成"。

### 强制检查清单（必须逐项执行 + 在最终汇报中显式勾选）

| 步骤 | 内容 | 完成标志 |
|------|------|----------|
| ✅ **1. MD 看板更新** | 修改 `.trae/rules/active-context.md`：完成项标记 `[x]` 并**按滚动窗口协议压缩为一行收口**（过程细节归 docs 台账，场景 F），更新"下一步即时行动"，保持正文 ≤100 行 | 执行 `git diff` 确认 MD 文件有正确的 `[x]` 与"下一步行动"变更 |
| ✅ **2. HTML 看板重绘** | **必须同步重新渲染 `docs/active-context.html`**，与 MD 100% 对齐（章节结构、任务状态、决策/风险、下一步即时行动全部一致） | 执行 `Grep` 比对 MD 与 HTML 中的关键字段（如"步骤 N"、"[x]"、"下一步即时行动"），确保两端一致 |
| ✅ **3. Git Commit 指令** | 按 `git-commit-guide.md` 生成可复制执行的 `git add <files> && git commit -m "..."` 命令 | 在汇报中完整输出该命令 |
| ✅ **4. 变更汇报** | 汇报改动文件列表；若触发规则变更（场景 A/B/C/D）明确告知规则文件修改内容 | 在汇报中明确标注 "MD + HTML 双落盘已同步" 作为收尾标志 |

### 汇报必答项（缺一项即视为未完成）
最终汇报中必须包含以下内容：
- "✅ MD 看板已更新"（列出具体更新的章节/项）
- "✅ HTML 看板已重绘"（列出与 MD 对齐的要点）
- 完整的 Git 提交指令
- 变更文件清单

### 反例（禁止的行为）
- ❌ 只更新 MD、忘记或跳过 HTML 重绘（本轮已出现，视为违反硬约束）
- ❌ 把 MD 和 HTML 当成两个独立可选项，按"时间紧张时只做一个"处理
- ❌ 没有在汇报中明确声明双落盘已完成
- ❌ 声称"HTML 已经同步"但实际未执行 `Grep` 比对验证

### 轻量分级（D-17 · 2026-08-27）：dogfood 小 bug 按日合并闭环

**适用条件**（须全部满足）：M3-b4 dogfood 期间的**单一 bug 修复**，且非里程碑节点、无契约/架构变更、单次代码改动 ≤ 3 文件。

**合并规则**：
- 坑档（pitfalls.md）落盘 + 看板 MD/HTML 双落盘：可延迟到**当日批次末统一执行一次**（不得跨日、不得遗漏）；
- `docs/dogfood-issues.md` 台账：**即时登记**（修前登记现象 + 第一现场，修后改状态 + 坑号）——这是跨会话移交的唯一锚点，不得延迟；
- Git 提交：仍按 bug **原子提交**（commit 颗粒度不放宽，遵守 git-commit-guide.md）。

**不适用**（仍走全量 4 步闭环）：里程碑节点完成、契约破坏性变更（`!` 标注类）、规则演进（场景 A/B/C/D）、dogfood 清单外的新功能开发。

**排障提效配套**：新会话处理 dogfood 问题时优先读 `docs/dogfood-issues.md`（第一现场）与 `docs/upstream-contracts.md`（上游拴合面速查），免重新摸排。