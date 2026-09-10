# ADR-008 · 用户数据与设备数据分层（$DSH_HOME 归位 + 应用命名统一）

状态：**已接受**（2026-09-09）· 关联：[`07-forge-shell.md`](../07-forge-shell.md)、[`pitfalls.md`](../pitfalls.md) 坑 42、`src/forge-shell/data-migration.ts`

## 背景

M4 引入「首启选择用户数据存储位置」（`data-home.ts`，`$DSH_HOME` 指向用户选定目录）后，实际落点呈现三个问题：

1. **承诺只兑现一半**：官方 16 包（凭据/设置/附件/技能/预设）跟随 home，但会话记录与 workspace 域数据被硬编码在设备目录 —— 用户勾选「迁移旧数据」只搬走一半，换机后历史丢失。
2. **兜底理由已过期**：`boot.ts` 旧注释称「dshHomePath 服务可用前以硬编码兜底」，但 `sessionQueryIndexPatch()` 早已在装配期读 `process.env.DSH_HOME` 拼路径，证明 DSH_HOME 在 `buildPatches` 阶段就绪，硬编码无必要。
3. **命名三套并存**：`appId=deepseek-harness.forge` / `productName=DSH Forge` / `name=dsh-desktop`（userData 目录名）/ AUMID `deepseek-harness.desktop` / 注册表键 `Software\DSH Desktop`，排查时找不到数据。

另有卸载安全缺口：`installer.nsh` 对注册表 `DataDir` 直接 `RMDir /r`，无任何校验 —— home 若被指到盘根或含其他数据的目录，卸载会递归删除整个目录。

## 事实盘点（归位前的三根）

| 根 | 打包态路径 | 内容 |
| --- | --- | --- |
| 安装目录（只读） | `%LOCALAPPDATA%\Programs\DSH Forge` | asar + `app.asar.unpacked`（node-pty） |
| 设备目录 | `%APPDATA%\dsh-desktop` | 指针 `data-location.json`、Chromium 运行时（Cache/GPUCache/Local Storage/…）、`audit.jsonl`、**sessions/storages/themes/icons/window-state.json** |
| 用户目录 | `$DSH_HOME`（默认 `~/.dsh`） | `settings.yaml`、`.credentials.yaml`、`search/`、`attachments/`、`skills/`、`.agent-presets/` |

`%LOCALAPPDATA%\dsh-desktop`（Electron `userCache` 默认位）实测不存在，Chromium 数据全在设备目录内。

## 决策

### 1) 分界线：这份数据离开本机还有没有价值

- **跟随 `$DSH_HOME`（用户资产，可迁移）**：`sessions/`、`storages/`、`themes/`、`icons/`、`window-state.json`，以及官方已收敛的 settings/凭据/搜索索引/附件/技能/预设。
- **留在设备目录（可重建或设备绑定）**：`data-location.json`（指针，放进 home 是鸡生蛋）、Chromium 运行时缓存、`audit.jsonl`（本机审计与用户数据分离）。

判定口诀：**能重建的、跟硬件绑定的、指向别人位置的 → 设备目录；其余 → home。**

### 2) 命名统一为 `DSH Forge`

`package.json` 增 `productName: "DSH Forge"`、`name` 改为 `dsh-forge`（Electron 以 productName 优先决定 `app.getName()` → 设备目录变为 `%APPDATA%\DSH Forge`）；AUMID 对齐 `deepseek-harness.forge`；注册表键改为 `Software\DSH Forge`；安装器文案同步。旧值一律**只读兼容**：旧设备目录、旧注册表键读到即迁移/清理。

### 3) 迁移策略（`data-migration.ts`）

- **设备目录更名**：`migrateLegacyUserDataSync()` 在 `app.whenReady()` **之前**同步执行（否则 Chromium 已在旧路径建好 profile，形成「数据在旧、缓存在新」的裂脑）；`rename` 失败回退「复制 + 删源」，两者皆失败保持原状并告警。
- **用户数据归位**：`migrateRuntimeDataIntoHome()` 在 boot 之前执行，目标已存在即跳过（幂等、重启安全），单条失败只告警并保持原位，绝不半搬。

### 4) 数据目录决策优先级（高 → 低）

`--data-dir=<path>`（企业静默部署，新增）> `userData/data-location.json`（用户在应用内选定）> 注册表 `DataDir`（安装器/部署脚本写入的**种子**，仅在无持久化选择时生效）> 默认 `~/.dsh`。

注册表定位为种子而非强制策略：应用内重新选择后写回文件与注册表，避免「注册表把用户选择顶回去」。

### 5) 卸载删除安全校验（`installer.nsh`）

删除前逐项校验：路径长度 ≥6、不等于 `$PROFILE`/`$DOCUMENTS`/`$DESKTOP`/`$APPDATA`/`$LOCALAPPDATA`/`$TEMP`、且目录必须含 DSH 痕迹（`settings.yaml` / `.credentials.yaml` / `sessions` / `storages`）。任一不满足 → 跳过删除并提示手动清理，注册表标记保留。

## 未采纳

- **把设备目录物理合并进 home**：需把指针外移到注册表/plist（macOS 无注册表）、`setPath('userData')` 必须早于 `whenReady` 而首启窗口必须晚于它（首次运行要多一次重启）、Chromium 的 LevelDB/SQLite 落进用户可选目录（网盘/同步盘会锁竞争与索引损坏）。收益仅「用户少看到一个隐藏目录」，不值。
- **向导式安装器选数据目录**：需关掉 `oneClick`（安装体验变向导）、`customPageAfterChangeDir` 更新时不会被 `skipPageIfUpdated` 跳过、macOS/便携包仍必须保留首启窗口（双入口长期并存）。企业部署走 `--data-dir` + 注册表种子即可，延后评估。

## 后果

- 正面：卸载选「删除数据」真正删干净；换机只需拷 home 一个目录；会话不再落在 `%APPDATA%`（Roaming）被域漫游同步；R7 硬编码实质收口；命名与安装目录一致。
- 负面：首启窗口的「迁移旧数据」现在会搬走全部用户数据，数据量大时耗时更长（无进度提示）。
- 遗留：便携包仍写 `%APPDATA%`（未处理 `PORTABLE_EXECUTABLE_DIR`，真便携模式待定）；GitHub repo 名已改 `dsh-desktop → dsh-forge`（2026-09-09，`electron-builder.yml` publish.repo 与本地 remote 同步）；**2026-09-10 补做**：`@lansi-ai/dsh-desktop-*` 插件 ID 与 `src/desktop-*` 目录/文件名全量更名为 `dsh-forge`。

## 验证

`npm run typecheck` / `npm run lint` / `npm test`（29 项）/ `npm run build` 全绿；**实机验证通过（2026-09-09）**——首启选目录、会话落 home、重启历史可读、搜索索引对账、旧设备目录自动更名。
