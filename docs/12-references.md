# 12 · 参考资料

> 全部依据。本地路径相对 `E:\Projects\DSH\`；网络来源附访问日期（调研于 2026-08 时点）。

## A. 官方仓库与产品

| 来源 | 链接/路径 | 用途 |
| --- | --- | --- |
| 官方仓库 deepseek-ai/deepseek-harness | https://github.com/deepseek-ai/deepseek-harness | 版本、许可证（MIT）、开发者预览声明 |
| 官方开发者预览页 | https://deepseek.com/harness/en/ | product 定位 |
| 官方中文 README 摘要 | 本机 `_harness-src/README.zh.md`（等同官方 master） | 安装方式、社区 |
| 本地源码检出 | `E:\Projects\DSH\_harness-src\`（git 子模块，`dsh-v0.1.0-rc.x`） | 一切架构结论的事实源 |
| npm 包（本机安装） | `C:\Users\Administrator\AppData\Local\npm-cache\_npx\...\node_modules\@deepseek-ai\dsh`（`0.1.0-rc.7`） | CLI 依赖树、bin 入口 |

## B. 本地源码权威文档（_harness-src/docs 与 .agents/notes）

| 文档 | 贡献 |
| --- | --- |
| `docs/architecture.md`（+zh） | 插件树、profile/bundle/patch、事件域、turn 流程、错误分类 |
| `docs/cordis-primer.md`、`docs/cordis-tutorial/` | Cordis 服务/事件/效果 |
| `docs/subsystems/web-server.md`（+zh） | **「Electron 用 file:// 加载 dist、fetch 走 IPC 桥，不使用本服务器」** |
| `.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md` | 分层模型、四象限协议、`AbstractApiClient` 载波子类表（含 Electron IPC 假设行）、**新增应用 Checklist**、方法/帧表 |
| `.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md` | web client 架构（壳、模块表、uiRenderer） |
| `.agents/notes/implemented/architecture/2026-07-23-client-plugin-loading-model.md` | `__DSH_BOOT__` 图谱、`/plugins/<id>/client.js`、**`loadBundle` 唯一可替换钩子**、`BootSeams` |
| `.agents/notes/implemented/architecture/2026-08-15-client-shells-and-dynamic-packages.md` | client 包类别、构建面（加载模型文档引用） |
| `.agents/notes/implemented/architecture/2026-08-04-websocket-downlink-carrier.md` | 下行载波物理边界（web 侧；桌面换 IPC 帧下行） |
| `packages/sdk/README.md` + `packages/sdk/client/README.md` | TS SDK（`DeepSeekHarness` / `HarnessClient`）、stdio JSON-RPC、限制 |
| `packages/boot/app-boot/README.md` | `boot()` / `prepare` / profile 机制 / patch 应用顺序 |
| `packages/host/webserver/README.md` | webserver 职责边界（routes/upgrade/fallback/tapIndex） |
| `packages/host/apiproxy`（src/api/） | 四象限类型、`RpcMethodMap`、`RpcErrorDetailsMap` |
| `packages/bundle/base|web-app|headless/cordis.patch.yml` | 各层插件行清单（web-app 行即桌面基线的参照） |
| `apps/cli/composition.md` | base 组合全图 |
| `apps/cli/src/`（profile-boot.ts / plugin.ts 等） | 装配与插件管理命令 |
| `packages/client/web/README.md` | `AppWebEntry(el, seams?)`、`PLATFORM_MODULES`、**BootSeams 参数 = loadBundle 传输覆写** |
| `packages/extensions/cordis-host-runner/README.md` | 动态 cordis 包信任立场（≈bash 访问） |
| `E:\Projects\DSH\plugins\dsh-terminal\`（src/index.ts、src/client/index.ts、package.json、cordis.patch.yml、README.md） | 双面插件先例：host 路由 + `conversation.view` 槽 + locale + 样式注入 |

## C. 社区桌面项目与文章

| 来源 | 链接 | 用途 |
| --- | --- | --- |
| sdkwork-ai/deepseek-harness-desktop | https://github.com/sdkwork-ai/deepseek-harness-desktop | 社区桌面主项目（Electron、IPC UI 不开口、三平台、更新） |
| 其安装指南（中文） | https://raw.githubusercontent.com/sdkwork-ai/deepseek-harness-desktop/master/docs/user/guide/desktop.zh.md | 桌面运行 Web profile + Electron IPC 细节 |
| 中文教程（博客园） | https://www.cnblogs.com/wlor/articles/22579705 | 社区桌面功能综述（任务看板/Git 工作树/cron 等，v2.6.0） |
| fendouai/deepseek-harness-desktop | https://github.com/fendouai/deepseek-harness-desktop | 同类社区 fork（对照） |
| kyorakuyk/dsh-desktop | https://github.com/kyorakuyk/dsh-desktop | 同类社区项目（对照） |
| 插件生态文章（jimo.studio） | http://www.jimo.studio/blog/fast-and-powerful-essential-plugins-for-deepseek-harness/ | 生态观察（辅助） |
| 插件开发教程（第三方） | https://www.ai-indeed.com/encyclopedia/29678.html | 生态文章（辅助，非权威） |

## D. 用户现有插件 API 面盘点（兼容分析依据，2026-08 实读源码）

| 插件 | host 半（`src/index.ts`） | client 半（`src/client/index.ts`） | 兼容结论 |
| --- | --- | --- | --- |
| `dsh-terminal` | `inject: ['webServer']`；`ctx.webServer.register` 注册 `POST /terminal/stream`（SSE 流式隐藏 PowerShell，UI 主用）+ legacy `POST /terminal/run`（一次性） | `conversation.view` 槽（tab `terminal`）+ `fetch('/terminal/stream')` | host 半→desktopRoutes 等价面（SSE→帧）；client 半随官方 UI 主面 |
| `dsh-rule-manager` | `inject: ['webServer']`；`/rules/*` REST 四路由 + `ctx.fs`/workspace/shell 服务聚合 AGENTS.md | `settings.section` 槽 + `fetch('/rules/*')` | host 半→desktopRoutes；client 半→兼容窗口（或二期 shim） |
| `dsh-restart` | `inject: ['webServer']`；`POST /restart`（spawn 自身 argv 重启） | `sidebar.footer.action` 槽 + `fetch('/restart')` | host 半→desktopRoutes + 桌面化语义（relaunch 应用）；client 半→兼容窗口 |

> 共同点：三个插件全部是「host 半 = webServer 路由；client 半 = 官方槽位 + 同源 fetch」——这正是社区插件的**标准模式**，
> 因此我们的兼容层（ADR-007）按此模式设计即可覆盖绝大多数第三方插件。

## E. 环境事实（本机）

- GUI 地址：`http://127.0.0.1:3081`（本环境 web profile 配置值；官方默认 3080）
- 工作区：`E:\Projects\DSH\plugins\`（本插件项目 `dsh-desktop/` 所在）；上游源码 `E:\Projects\DSH\_harness-src\`
- 现有插件先例：`dsh-terminal`（隐藏 PowerShell + SSE）、`dsh-rule-manager`、`dsh-restart`
- 网络代理：`127.0.0.1:7890`（用户确认可用；境外抓取经其 CONNECT 隧道）

## F. 调研方法说明

- 本地优先：所有架构结论以 `_harness-src` 权威文档为准（官方 GitHub master 与本地检出同源）
- 网络为辅：web_search + 经代理的 Node 抓取（仅提取关键段落，未全文搬运）
- 版本时点：本文档集基线原钉**本地检出 `dsh-v0.1.0-rc.8`**（2026-08-25 决策，权威事实源为 `_harness-src` 检出；**2026-09-01 实测上游最新稳定为 `0.1.1-rc.2`，差异 diff 登记 sync-upstream 迁移表 C 区，旧载 rc.12 系臆测项**）；**2026-09-01 已按 M4-d3 实际升级采用 `0.1.2-alpha.3`**（破坏性载波重写，见 `m4-d3-012-alpha3-migration-plan.md`）；**2026-09-02 已升级 `0.1.2-alpha.4`**（无破坏性变更零适配，见迁移表 C-2）；**2026-09-03 自动工具升级 `0.1.2-alpha.5`**（无破坏性变更零适配，见迁移表 C-3）