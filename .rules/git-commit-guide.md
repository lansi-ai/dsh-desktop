---
description: Git 约定式提交规范与颗粒度控制（dsh-desktop）
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
git add src/types/ipc-schema.ts src/desktop-host/bridge/respond.ts
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