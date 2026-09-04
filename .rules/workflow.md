---
description: AI 编码与工程协作 SOP、微观业务契约对齐、上下文预检流水线与规则自我演进协议（dsh-desktop）
globs: "*"
alwaysApply: true
---

# 工作流与协作 SOP (workflow.md)

## 00. 方案先行：改动前方案确认与契约对齐 (Plan-First Gate & Context Alignment)

**硬性门禁（用户 2026-09-03 确认固化）**：任何代码 / 资源 / 规则文件 / 配置的改动，AI **严禁未经用户确认直接动手**。必须先产出【改动方案】并等待用户明确确认（如"同意 / 可以 / 按方案改"），确认前不得执行任何写入操作（含"顺手"的小改动）。

【改动方案】必须包含（按需求规模可精简，但范围与影响面不可省）：
1. **改动范围与文件清单**：拟新增/修改/删除哪些文件，各自改什么。
2. **可选方案与推荐**：存在多种实现时给出对比与推荐理由；只有一种合理解法时说明为何。
3. **影响面与风险**：波及的模块/契约/兼容性；已知脆弱点如实声明，禁止隐瞒设计妥协。
4. **验证方式**：编译/lint 之外，用户如何实机验证效果。

执行纪律：
- 实施中若发现**方案外的问题**，先停下向用户说明并给出处置建议，**严禁顺手扩大改动范围**。
- 方案被用户调整后，按调整后的口径重新确认再动工。
- 仅用户明确授权的单一动作按授权执行；其附带性连带改动（看板/文档同步等）仍需单独确认。

在方案确认后、编写 DTO / Schema / 插件 / 载波代码前，继续完成微观契约确认：
1. **主流程路径**：当前 Task 的具体动作与核心结果（Input/Output）——如 IPC 帧的 `rpcId` 绑定、`respond` 回填语义、`dsh-ui://` 装载目标。
2. **异常与逆向状态**：重复应答（`not-pending`）、未注册路径 fetch（白名单报错）、协议加载失败（退回 `--serve`）、崩溃重启熔断。
3. **数据校验规则**：所有 IPC 入参先过 `zod`；帧结构逐字遵守官方四象限协议（rpcId 纪律）。
4. **MVP 交付边界**：明确该 Task 是否属于 `active-context.md` 当前步骤；不在本次 Task 扩张无关能力。

👉 **AI 执行指令**：接到需求先抛【改动方案】；用户确认后，编码类任务再抛【编码前契约确认】2–3 问，用户回答后**一句话总结契约并询问："确认没问题我就开始写 Schema 和代码了？"** 待肯定答复才动工。

## 01. 任务开始前的预检流水线 (Pre-execution Protocol)
契约确认后执行 3 步预检：
1. **读取 L3**：核对 `active-context.md`，确认任务符合当前 Sprint 目标与"下一步即时行动"。
2. **核对 L2**：确认创建/修改文件路径符合 `architecture.md`（`desktop-shell`/`desktop-host`/`desktop-compat`/`desktop-plugins`/`preload`/`types`）与单向依赖。
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
  - **自动化工具**：`scripts/upstream.cjs`（`npm run upstream:check` / `upstream:auto`）查新版本 → 评估破坏性 → 判定 safe 才自动升级；blocked/review 停下走人工 SOP。定时任务每日 02:00（北京时间）自动执行。
  - **⚠️ 台账同步硬约束**：脚本只自动写 `docs/upstream-migrations.md` 的 C 区节，其余台账（该表表头基线行、`docs/upstream-contracts.md` 标题+复核行、`docs/12-references.md` 版本时点、`.trae/rules/active-context.md` 与 `docs/active-context.html`）须人工同步才算闭环；日期取北京时区。

## 05. 任务完成后的状态闭环 (Post-execution Synchronization)
任务完成并通过质量自检后，AI **必须自动执行状态同步**：
1. **更新 L3 文本看板**：`active-context.md` 中完成项标记 `[x]`，更新"下一步即时行动"。
2. **同步 L3 美化看板**：重新渲染并覆盖 `docs/active-context.html`，保持与 MD 100% 一致。
3. **输出 Git Commit 指令**：按 `git-commit-guide.md` 生成可复制执行的 `git add <files> && git commit -m "..."` 命令。
4. **输出变更汇报**：汇报改动文件列表；若触发规则变更（场景 A/B/C/D）明确告知规则文件修改内容。