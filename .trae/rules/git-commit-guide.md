---
description: Git 约定式提交规范与颗粒度控制（dsh-forge）
globs: "*"
alwaysApply: true
---

# Git 提交规范与协作指南 (git-commit-guide.md)

## 01. Commit Message 核心格式
所有提交严格遵循 Conventional Commits：

```text
<type>(<scope>): <short summary>

[optional body]
```

### 1. 提交类型 (`<type>`)
| 类型 | 适用场景 | 示例 |
| :--- | :--- | :--- |
| **feat** | 新增功能 / IPC 契约 / 插件 / 协议 | `feat(carrier): 实现 IPC 载波 doFetch 与 openMux 覆写` |
| **fix** | 修复 Bug / 边界异常 / 崩溃 | `fix(shell): 修复 relaunch 冒烟导致无限重启问题` |
| **docs** | 仅修改文档 / 规则 / 看板落盘 | `docs(board): 更新 active-context 看板为步骤2已完成` |
| **refactor** | 重构（不改变功能与接口） | `refactor(host): 桥分发抽离为 unary/frame 两个模块` |
| **style** | 格式化 / 注释 / 错别字 | `style(types): 为 ipc-schema 补充字段注释` |
| **chore** | 构建 / 依赖 / 脚手架 / 基线升级 | `chore(deps): 安装 Electron 与 pnpm workspace 基线` |
| **test** | 单元 / 集成 / 差集测试 | `test(compat): 补全 desktopRoutes 路由等价面测试` |
| **build** | 上游基线 diff / sync-upstream 登记 | `build(upstream): 同步 dsh-v0.1.0-rc.8 迁移登记表` |

### 2. 作用域 (`<scope>`)
用简短模块名：`shell`（Electron 外壳）/ `host`（装配与桥）/ `carrier`（IPC 载波）/ `compat`（旧插件兼容）/ `plugins`（桌面能力插件）/ `preload` / `types`（契约）/ `protocol`（dsh-ui:// 与零端口 bundle）/ `board`（看板）/ `upstream`（上游基线）。

### 3. 主题 (`<short summary>`)
- 清晰动名词短语，**≤ 50 字符**；明确交付了什么，严禁 `修改代码`、`bugfix`、`update` 等模糊词。

## 02. 编码与提交 SOP
### 1. 提交颗粒度控制
- 小步快跑与原子化：**每完成 `active-context.md` 的一个子任务节点（处理 1–3 个关联文件）即触发一次 Commit**；严禁整个 Sprint 或无关步骤合并为巨型提交。
- 职责单一：一次 Commit 只做一件事；`docs(board)` 看板更新可伴随（同节点收尾），但严禁 `feat(host)` 与 `fix(compat)` 混提。

### 2. 契约变更提交强提示
- 涉及 `src/types/` 中 IPC 契约 / zod Schema / DTO **破坏性变更**时：type/scope 后加 `!` 并显式注明。
  `feat(carrier)!: 修改 respond 帧结构 (破坏性变更/需同步 preload 与 renderer 载波变体)`

### 3. 看板状态更新同步提交
- 完成阶段性步骤并更新看板后，提交信息显式绑定看板节点：
  `docs(board): 完成步骤 4 (IPC 载波四件套)，同步更新 active-context (MD+HTML)`

### 4. 上游基线升级 SOP（ADR-005）
- 升级 `dsh-v0.1.0-rc.x` 时：先提交 `build(upstream)` 迁移登记表 diff（3 类拴合文件 diff + 事实刷新），再提交代码适配；契约破坏性变更必须 `!` 标注。

## 03. AI 提交触发命令模板
用户提示"提交代码"/"Git Commit"/"完成当前 Task"时，先检查 `git status` 与 `git diff`，再生成符合本规范的命令：

### 场景 A：日常增量 Task 提交
```bash
git add src/types/ipc-schema.ts src/forge-host/bridge/respond.ts
git commit -m "feat(carrier): 实现 respond 回填与 pending 表分发"
```

### 场景 B：步骤节点完成 + 看板双落盘同步提交
```bash
git add src/ .rules/active-context.md docs/active-context.html
git commit -m "docs(board): 完成步骤 4 IPC 载波四件套，更新任务看板"
```

### 场景 C：上游基线升级
```bash
git add docs/upstream-migrations.md package.json
git commit -m "build(upstream): 同步 dsh-v0.1.0-rc.8 拴合面 diff 迁移登记"
```

## 04. 多窗口并行开发规范（branch + worktree）

### 1. 总原则
同时开发多个功能（多窗口/多 IDE）时，**严禁直接在基线（主）分支上改**。一条功能线 = 一个分支 + 一个独立工作目录，物理隔离、互不干扰，且不污染稳定基线。

### 2. 基线约定
- 基线分支（`main`/`dev`）只收**已完成并通过验收的合入**；半成品/中间态一律不进基线。
- 一条功能线合并回基线后，才从基线拉下一阶段新线，避免多线交叉污染基线。

### 3. 核心机制：`git worktree`
同一仓库同一目录只能 checkout 一个分支，多窗口共用会互相覆盖。用 `git worktree` 为每条功能线生成**独立目录 + 独立分支**：

```bash
# 每功能一线一目录
git worktree add ./dsh-workspaces -b feat/workspaces
git worktree add ./dsh-p2-brand  -b feat/brand
git worktree add ./dsh-dogfood   -b fix/dogfood-issues

# 完成后清理（合并回基线并验证后）
git worktree remove ./dsh-workspaces
git branch -d feat/workspaces
```

### 4. 分支命名
`<type>/<module>-<topic>`（type 复用提交类型）：`feat/workspaces`、`fix/dogfood-issues`、`chore/upstream-rc2`。命名与 scope 语义一致，便于按模块检索。

### 5. 并行度与文件域约束
- **同时并行 ≤ 3 条**；过多则 merge 冲突与心智负担陡增。
- 各功能线尽量**改不同文件域**；若两条并行线都要改同一批核心文件，改为**串行**。

### 6. 冲突敏感文件（并行红线，禁止进功能分支）
以下"共享改动"文件**只在基线更新**，功能分支不重复改，避免并行冲突与看板被多线改写：
- `src/types/`（IPC 契约 / zod / DTO）：三方共享唯一源头；破坏性变更须先串行对齐再并行。
- `.trae/rules/active-context.md` + `docs/active-context.html`：看板为唯一跟踪，单独收口，功能线不碰。
- `.trae/rules/*.md` 与 `docs/adr/`：规则演进（场景 A~D）只在基线做，不混入功能线。

### 7. 完成收口协议（每条功能线）
1. 功能分支内**原子提交**（遵守 02 节颗粒度）。
2. `git checkout <基线>` → `git merge <feat-branch>`（先 rebase 到最新基线避免冲突）。
3. 从基线清理：`git worktree remove` + `git branch -d`。
4. **看板收口、合并后回归在基线做**，不散落在功能分支。

### 8. 与既有契约衔接
- 原子提交 / 契约破坏性变更 `!` 标注 / 上游升级 SOP：均在**功能分支内**遵守。
- 看板双落盘（MD+HTML）：仅在**基线合并后**执行，避免并行分支各自更新看板造成冲突。