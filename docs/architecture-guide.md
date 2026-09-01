# HTML 版架构图 · 使用与维护说明

> 对象文件：`docs/architecture.html`（纯静态 HTML + CSS，**零 JavaScript、零外部依赖**，浏览器直接打开即用）
> 二级页面：`docs/architecture-plugins.html`（完整插件清单可视化，与主图互链）；MD 真源：`docs/plugin-inventory.md`（Host 78 条 + Client 36 个 + 桌面注入，命名 @lansi-ai/dsh-*）
> 配套：位图版 `docs/architecture-diagram.jpg`、文字版 `docs/14-implementation-map.md`

---

## 1. 打开方式

| 方式 | 操作 |
|---|---|
| 本地双击 | 直接双击 `docs/architecture.html`（file:// 协议即可，无跨域限制） |
| 浏览器打开 | 拖入任意现代浏览器（Chrome / Edge / Firefox / Safari 均可） |
| 打印 / 导出 PDF | `Ctrl+P` → 已内置 `@media print` 适配（自动转白底、去阴影、隐藏返回顶部按钮） |
| 嵌入其他页面 | 整文件为一个自包含 `<html>`，可 iframe 引用或整体拷贝 `<style>` + `<div class="wrap">` 部分 |

## 2. 页面结构与阅读顺序

自上而下共 5 个区块，建议按序阅读：

```
① 头部（标题 + 4 枚徽章）        —— 一眼看清 4 条核心决策（D-1/D-2/D-3 + 基线）
② Renderer 层（浅蓝容器）        —— Cordis Client 插件系统
   ├─ 双装配机制卡片 ×2           —— __DSH_BOOT__ 图谱（机制 A）/ 官方 Slots（机制 B）
   ├─ 官方 ui-* 插件 chip 行      —— 自动扫描装载 + 2 个排除项（虚线幽灵样式）
   ├─ 桌面注入插件 chip 行        —— @lansi-ai/dsh-* 载波与 UI 插件
   └─ preload 安全边界            —— desktopBridge 白名单
③ IPC 载波带（中部窄条）         —— 双向箭头 + 8 通道名悬浮卡片
④ 主进程层（浅绿容器）           —— 内嵌 Cordis Host
   ├─ 左列：desktop-shell 外壳
   ├─ 中列：插件树（视觉核心）     —— ctx 根 → 三组插件域（Agent / 工具沙箱 / 载波聚合）
   ├─ 右列：bridge + 桌面能力
   └─ 底部：userData 持久化条（圆柱图标 ×3）
⑤ 关键数据流（三栏卡片）          —— 上行 RPC / 下行帧 / 插件装配双通道
```

## 3. 颜色图例（chip 左侧色点 + 边框）

| 颜色 | 语义 | 典型元素 |
|---|---|---|
| 🔵 蓝 `--blue` | Renderer 侧 / 官方客户端插件 / 载波服务 | ui-\* 插件、api-gateway、ipc-connection |
| 🟢 绿 `--green` | Host 侧插件树成员 / 外壳模块 | llm/session/sandbox、main.ts |
| 🟣 紫 `--purple` | 桌面聚合与等价面（本项目自研注入层） | ctx.desktop、webServer compat、@lansi-ai/dsh-\* 插件 |
| 🟠 橙 `--orange` | bridge 方法域 / 协议路由 | desktop.\* 方法、dsh://、session-rewarm |
| 🩵 青 `--cyan` | 安全边界 | preload desktopBridge |
| ⚪ 虚线幽灵样式 | **已禁用 / 已排除** 的条目 | cmdpalette（禁用壳）、client-connection（D-9 不入图谱）、directory-picker-browse（互斥排除） |

## 4. 交互行为说明

本页面交互全部为**纯 CSS**（无 JS），行为如下：

| 交互 | 触发 | 效果 |
|---|---|---|
| chip 悬停高亮 | 鼠标悬停任意插件 chip | 上浮 2px + 对应主题色发光阴影 + 边框点亮——用颜色快速辨认该 chip 归属的域 |
| 区块悬停高亮 | 悬停 tier / tree-group / col-box / asm / flow / db | 边框变亮；插件树分组（tree-group）额外内描一圈绿色——定位某组插件时用 |
| 数据流卡片悬停 | 悬停底部三张 flow 卡 | 卡片浮起 + 阴影加深，便于逐条阅读时序编号列表 |
| 返回顶部 | 右下角圆形 ↑ 按钮 | 跳转回页面顶部（唯一锚点链接） |
| 响应式折叠 | 窗口 < 1080px | 插件树三组改单列、host-grid 三列改单列——手机/分屏阅读不破版 |
| 打印适配 | Ctrl+P | 白底化 + 去阴影/动效 + 隐藏浮动按钮，直接打印或存 PDF |

> 注：页面不含点击展开 / 折叠 / tab 切换等 JS 交互——刻意保持零脚本，保证 file:// 直开、离线、打印三种场景均无兼容性问题。

## 5. 元素 ↔ 代码映射（chip 去哪找源码）

| 图中元素 | 源码位置 |
|---|---|
| __DSH_BOOT__ 图谱卡片 | `src/desktop-host/boot-graph.ts`（generateBootGraph / generateFullBootScript） |
| 官方 ui-\* 扫描 | 同上 `scanClientPackages()`（读 `dsh.client` 声明） |
| ipc-connection chip | `src/desktop-shell/web/ipc-connection.js` |
| desktop-settings / panel / audit-viewer / cmdpalette chips | `src/desktop-shell/web/desktop-*-client.js` |
| preload 安全边界 | `src/desktop-shell/preload.ts` |
| IPC 通道卡片 | `src/types/channels.ts`（IPC_CHANNELS 8 通道） |
| overlay patches 装配说明 | `src/desktop-host/boot.ts`（§1–§4 四段补丁） |
| 插件树三组 | `boot.ts` DESKTOP_OVERLAY_PATCHES §1 insert 数组（按域分组呈现） |
| api-gateway / typert-gateway | `@deepseek-ai/dsh-host-apiproxy` / `dsh-api-gateway`（经 main.ts callApi 消费） |
| ctx.desktop 聚合 | `src/desktop-host/desktop-api.ts` |
| webServer compat | `src/desktop-host/compat-webserver.ts` |
| bridge 右列 | `src/desktop-host/bridge.ts` + `desktop-*.ts` 各能力模块 |
| dsh:// 协议 | `src/desktop-host/dsh-protocol.ts` |
| session-rewarm | `src/desktop-host/session-rewarm.ts` |
| 持久化条 | `userData/audit.jsonl`、`window-state.json`、`RUNTIME_ROOT`（boot.ts） |
| 三条数据流卡片 | 对应 `docs/14-implementation-map.md` §5.1 / §7.3 / §7.1 详细文字版 |

## 6. 维护指南（架构变更时如何更新）

1. **新增 Host 插件**：在「插件树」对应 `tree-group` 内追加一个 `<span class="chip c-green">`（模板：`<span class="chip c-green"><span class="dot"></span>插件名</span>`）。
2. **新增桌面能力模块**：右列 `col-box` 追加 chip，颜色用 `c-orange`；若属于聚合注入层则用 `c-purple`。
3. **新增 renderer 插件**：Renderer 层对应 chip 行追加；若是被排除/禁用项，追加 `ghost` class。
4. **新增 IPC 通道**：更新 `src/types/channels.ts` 后，同步 `.ipc-channels .c` 内的通道清单（每行 4 个，`<br>` 分隔）。
5. **配色微调**：改 `:root` CSS 变量即可全局生效（如 `--green` 换色，插件树整体跟随）。
6. **新增数据流**：在 `.flows` 网格追加 `.flow` 卡片（≤3 列建议保持，超出自动换行）。
7. 变更完成后请与 `docs/14-implementation-map.md` 的对应章节同步修订，防止图文脱节（场景 B 规则）。

## 7. 二级页面：完整插件清单（architecture-plugins.html）

主图插件树仅列约 30 个代表项，全量细节在二级页：

- **导航入口（2 处）**：主图头部徽章行「完整插件清单 →（二级页）」；插件树底部「查看完整清单 →」。二级页右上角「← 返回架构总图」回链。
- **Host 侧 12 个分组**：LLM 与凭据 / 会话与持久化 / Agent 循环 / 压缩与 Token / 沙箱与执行 / 工具集（17 条）/ 子代理与工作流 / 技能与提示 / API 载波与网关 / 配置与存储 / 权限与审批 / Web 与搜索 + 基础设施 + prepare 注入服务表，每条含包名/作用/装载状态。
- **Client 侧 7 个分组**：模块系统核心 / 布局与导航 / 对话主区 / Agent 过程可视化 / 设置页 / 其他 UI 域 / 互斥与排除。
- **桌面注入**：Client 半 6 个（@lansi-ai/dsh-\*）+ Host 半 11 个模块。
- **状态图例**：已装载（绿）/ 已禁用（灰虚线）/ 被排除（红，directory-picker-browse）/ 预载注册（橙，client-connection D-9）。
- **维护真源**：Host 树 = `src/desktop-host/boot.ts` §1+§4 insert 数组；Client 图谱 = `src/desktop-host/boot-graph.ts` scanClientPackages()；本页为派生视图，架构变更时需同步更新。

## 8. 已知限制

- 主图插件树仅按**域分组**呈现约 30 个代表插件，完整 78+36+5 清单见二级页（§7）。
- 数据流卡片为简化时序（省略 zod 校验细节、per-window 中继复用等），完整链路见实现地图。
- 悬停交互在触屏设备上不可用（纯 hover，无 tap 态）。
