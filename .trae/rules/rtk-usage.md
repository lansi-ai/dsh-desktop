---
description: RTK Token-Killer 正确用法与沙箱修复指引（dsh-desktop）
globs: "*"
alwaysApply: true
---

# RTK Token-Killer 使用与沙箱修复指引 (rtk-usage.md)

## 01. 正确用法（子命令式）

RTK 是**子命令式** CLI，正确调用为 `rtk <子命令> [参数]`。**不是** `rtk -u <命令>`——`-u` 会被当成一个不存在的子命令去解析，报 `Binary '-u' not found`。

常用映射（含本项目场景）：

| 期望执行 | 正确写法 |
| --- | --- |
| `git status` / `git diff` / `git log` / `git show` / `git branch` | `rtk git status` / `rtk git diff` / `rtk git log` / ... |
| `npm run build` / `npm test` | `rtk npm run build` / `rtk npm test` |
| `tsc --noEmit` | `rtk tsc --noEmit` |
| `eslint .` | `rtk lint` |
| `cargo build` / `cargo test` | `rtk cargo build` / `rtk cargo test` |
| `go test` | `rtk go test` |
| `pytest` | `rtk pytest` |
| `dotnet build` | `rtk dotnet build` |
| 目录 / 文件查看 | `rtk ls` / `rtk tree` / `rtk grep` / `rtk rg` |
| 容器 / 云 | `rtk docker ps` / `rtk kubectl get pods` |
| 包管理列表 | `rtk npm list` / `rtk pip list` |
| 其它预期长输出的命令 | `rtk <对应子命令>`（用 `rtk --help` 查子命令） |

## 02. 沙箱拦截故障与根因

现象：执行 `rtk <子命令>`（如 `rtk git status`）报

```
TRAE Sandbox Error: hit restricted
  Not allow operate files: C:\Users\Administrator\AppData\Local\rtk\history.db-wal
```

（报错文件可能是 `history.db` / `history.db-wal` / `history.db-shm`），退出码非 0。

根因：RTK 每次执行真实命令都会把本次调用写入历史库
`C:\Users\Administrator\AppData\Local\rtk\history.db*`。该路径位于工作区之外，被 TRAE 沙箱的
`operate files` 限制拦截。`rtk --version` / `--help` / `--config` 不写历史库，所以能正常返回。

## 03. 修复：沙箱白名单（唯一生效路径）

**已实测**：写 `AppData\Roaming\rtk\config.toml` 设 `[tracking] enabled = false` **无法**阻止
RTK 写历史库——无论 tracking 开关为何，RTK 都会写 `history.db*`。因此关闭 tracking 的
修复方式无效，且会丢失 `gain` / `session` / `discover` 使用统计，**不要采用**。

唯一修复 = 在 IDE 放行沙箱白名单，步骤如下：

1. 打开 **Settings → Permission & Approval → Custom Configuration**。
2. 放行 RTK 历史库目录（三选一）：
   - 整目录：`C:\Users\Administrator\AppData\Local\rtk\`（推荐）
   - 或精确到：`C:\Users\Administrator\AppData\Local\rtk\history.db`、`history.db-wal`、`history.db-shm`
3. 保存后立即生效，对**所有窗口全局生效**；此后直接用 `rtk <子命令>` 即可，无需回退裸命令。

## 04. 未放行前的回退（例外）

在沙箱未放行 `AppData\Local\rtk\` 期间，RTK 执行真实命令必然因写历史被拦（退出码 1）。
按本规则"例外情况"：此时**回退到裸命令**（如 `git status`、`npm run build`），直到沙箱放行。

## 05. 勿做

- ❌ 不用 `rtk -u <命令>`——RTK 无 `-u` 子命令，会误报 `Binary '-u' not found`。
- ❌ 不通过写 `config.toml` 关 tracking 规避沙箱——已验证无效，且丢统计。
- ❌ 不通过沙箱外路径自行"提权"或绕过限制——这是 IDE 安全边界，只能由用户在自定义配置中放行。
