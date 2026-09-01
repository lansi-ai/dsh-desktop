# dsh-desktop 垂直化扩展路线指引

> **定位**：以 dsh-desktop 为底座，把通用 AI 会话客户端改造为业务垂直应用的自定义路线指引。
> **贯穿案例**：AI 视频创建工作流程序（业务输入 → 编排生成 → 视频交付）。
> **底座版本**：M3 代码完成态（多窗口/托盘/审计/自启可用），基线 `0.1.2-alpha.3`（2026-09-01 M4-d3 由 rc.8 直升，见 `m4-d3-012-alpha3-migration-plan.md`）。
> 配套阅读：`14-implementation-map.md`（架构实现地图）、`architecture-plugins.html`（完整插件清单）、`pitfalls.md`（坑档）。

---

## 0. 核心结论（先看这个）

**你不需要从零写程序。** 底座已提供完整的「宿主 + 会话 + 工具 + UI 插槽」体系，垂直化 = 在四个既定扩展面上做减法（藏通用）与加法（长业务），其中：

- **UI**：官方 Slots 槽位系统允许你在侧边栏/对话流/设置页**任意位置注入业务组件**，也可以整屏替换。
- **功能**：视频生成对底座而言只是「一个新工具（tool）+ 一个新 provider（video 域，类比 llm 域）」，Agent 循环/审批/沙箱/持久化全部白拿。
- **工作流**：上游已有 `dsh-tool-workflow`（JS 编排引擎）+ `dsh-client-ui-workflow-run`（工作流节点 UI）+ `dsh-jobs`（后台任务）+ `dsh-client-ui-deliverables`（产物展示）——**视频工作流的骨架四件套现成**。
- **分发**：electron-builder 打包链已通（M4-a1），垂直版 = 换 productName/appId + 裁剪清单。

预计路径：**阶段 A（纯注入，不动底座）→ 阶段 B（加业务域插件）→ 阶段 C（裁剪通用面）→ 阶段 D（独立分发）**。每阶段可独立交付。

---

## 1. 底座能力盘点（你已拥有什么）

| 能力 | 现状 | 垂直化价值 |
|---|---|---|
| Agent 会话循环 | ✅ dsh-agent/agent-loop | 用户自然语言驱动的业务操作入口 |
| 工具体系 | ✅ 17 个 tool 插件 + ctx.tools 注册表 | 视频生成 = 注册新 tool，模型自动可调用 |
| **工作流引擎** | ✅ dsh-tool-workflow（JS 编排脚本 over ctx.workflowEngine） | 多步骤视频流水线的编排底座 |
| **后台任务** | ✅ dsh-jobs + ui-jobs | 长耗时渲染任务 + 进度展示 |
| **产物展示** | ✅ ui-deliverables（产物文件尾注 + 可点击引用） | 视频成品交付 UI 基础 |
| 附件系统 | ✅ dsh-attachment-local + ui-attachment | 素材（图/音/脚本）上传 |
| 审批/权限 | ✅ approval + permission-presets | 高消耗视频任务前的确认闸门 |
| 持久化 | ✅ sessions JSONL + storage-json | 项目/任务历史 |
| 桌面能力 | ✅ 托盘/通知/快捷键/自启/多窗口 | 渲染完成通知、任务面板独立窗口 |
| UI 插槽系统 | ✅ dsh-client-ui-slots | 业务 UI 注入点（见 §2.1） |
| 打包分发 | ✅ electron-builder + SHA256SUMS | 垂直版独立安装包 |

**关键认知**：底座的「通用」是资产不是负担——用户仍可用自然语言驱动一切；垂直化做的是把**你的业务路径**做成一等公民（默认视图、专用工具、领域命令），而不是阉割对话能力。

---

## 2. 四层扩展面（自上而下）

### 2.1 UI 层：Slots 槽位注入（最轻，先从这里开始）

**位置**：`src/desktop-shell/web/<your-plugin>-client.js`（浏览器 bundle）
**注册**：`boot-graph.ts` 的 `desktopDecls` 数组追加条目（见文件 L328-342 现有 5 个 @dsh-desktop 条目即模板）。

```js
window.__ModuleLoader__.load({
  id: '@yourbiz/video-studio',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    exports.inject = ['slots']
    exports.apply = (ctx) => {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'video-studio', order: 20, label: () => '视频工作室',
      }, function VideoStudioSection() { /* 业务组件 */ }))
    }
  },
})
```

**可用槽位**（实机验证过的 + 契约文件可查的）：

| 槽位 | 现状 | 视频案例用法 |
|---|---|---|
| `settings.section` | ✅ 已验证（desktop-settings 在用） | 「视频供应商/API Key/默认分辨率」设置页 |
| `sidebar.footer.action` | ✅ 已验证（desktop-panel 在用） | 「新建视频任务」入口按钮 |
| `settings.general.item` | ⚠️ 已被官方 general 占用（坑 13：勿重复声明） | — |
| conversation / hero / workspace 等 | 契约见各 ui-* 包 `lib/types/client/contract/slots.d.ts` | 对话流内嵌「视频预览卡」 |

**查槽位的方法**：`node_modules/@deepseek-ai/dsh-client-ui-<域>/lib/types/client/contract/slots.d.ts` ——每个官方 UI 插件都声明了自己暴露的槽位契约。

**极限操作**：若要整屏替换（隐藏侧边栏/对话流），不要改官方 dist（R 红线：发行物只读）；用 CSS 注入（你的 client bundle 里操作 `document`）或 fork `dsh-web-frontend` 自建 dist——后者是 ADR-006 自绘 UI 路线，成本高，放阶段 C 之后。

### 2.2 Host 功能层：注册业务工具与 provider

**位置**：`src/desktop-host/` 新模块 + `boot.ts` 两处接入。

**路径一：桥方法（桌面能力型，不走模型）** —— 适合「点按钮调 API」的业务动作：
```ts
// src/desktop-host/video-studio.ts
import { registerMethod } from './bridge.js'
export function installVideoStudio(opts): () => void {
  registerMethod('videoStudio.submit', async (params) => {
    // zod 校验 → 调视频供应商 API → 建 job → 返回任务 ID
  })
  // main.ts bootstrap 第 9 步装配
}
```
preload 侧在 `src/desktop-shell/preload.ts` 白名单加一个 `videoStudio` 命名空间（照抄 `audit` 三行模板）。

**路径二：Agent 工具（模型可调用）** —— 适合「自然语言驱动」：
新建 Cordis 插件（可先项目内模块，参照 desktop-api.ts 的 Service 形态），向 `ctx.tools` 注册 `video_generate` 工具：
```ts
// 工具定义：name/description/parameters(zod 或 schemastery)
// handler：接收模型参数 → 校验 → 提交渲染任务（走 dsh-jobs）→ 返回任务句柄
```
**这带来最大红利**：模型自己会在用户说「帮我把这段脚本做成 30 秒视频」时调用 `video_generate`，中途参数用 `user-questions` 插件追问，高消耗前用 `approval` 弹审批——这些交互链全部白拿。

**路径三：视频 provider 域**（类比 llm 域）—— 多供应商时才需要：
定义 `ctx.video` 服务 + 若干 provider 插件（Runway/可灵/Seedance…），结构照抄 `dsh-llm` + `dsh-llm-deepseek` 的注册面。MVP 阶段先跳过，路径二里写死单供应商即可。

### 2.3 数据层：配置与存储

| 需求 | 用法 | 位置 |
|---|---|---|
| 用户偏好（供应商/分辨率） | `settings` 服务注册 namespace（照抄 desktop-api.ts `lazySettingsScope`） | `ctx.settings.register('video-studio', schema)` |
| 业务对象（项目/任务清单） | `ctx.storageDomain`（JSON 后端已在装）或直接桥方法读写 userData | `boot.ts` §4 storage 链 |
| 任务状态 | 复用 `dsh-jobs`（session/jobs 帧已通 UI） | 勿自造 |

### 2.4 系统层：桌面集成

- **渲染完成通知**：`desktop-notify.ts` 消费的是 `events.mux` 流——你的 job 事件只要走官方 jobs 通道，通知自动生效。
- **任务面板独立窗口**：`WindowManager.createSessionWindow` 泛化出的会话窗口机制，可加一种 `windowKind` 分支绑定业务窗口。
- **`dsh://` 协议**：`dsh-protocol.ts` 加 action（如 `dsh://newvideo?template=x`）供外部系统唤起建单。

---

## 3. 案例路线：AI 视频创建工作流

### 阶段 A · MVP：纯注入（不动底座内核，1-2 周粒度）

**目标**：在现有 UI 里跑通「上传素材 → 对话生成脚本 → 提交渲染 → 收到成品」。

1. **A1 业务设置页**（§2.1 settings.section 槽）：视频供应商 API Key（经环境注入，遵守 core-standards 红线：禁止硬编码凭据）、默认参数。
2. **A2 侧边栏入口**（§2.1 sidebar.footer.action）：「视频工作室」面板（desktop-panel-client.js 直接抄壳）。
3. **A3 `video_generate` 工具**（§2.2 路径二）：单供应商写死；内部用 `dsh-jobs` 起后台任务，轮询供应商 API。
4. **A4 产物交付**：渲染产物落工作区目录 → `ui-deliverables` 自动展示成品引用；通知走 jobs 事件白拿。
5. **验收**：一句话「把 input/script.md 做成 720p 视频」→ 审批 → 后台渲染 → 托盘通知 → 对话流里点开成品。

### 阶段 B · 垂直化：业务域一等公民

1. **B1 工作流编排**：把多步流水线（脚本→分镜→TTS→合成）写为 `dsh-tool-workflow` 的 JS 编排脚本，模型经 workflow 工具驱动；复杂交互可沉淀为 skill（`dsh-skill-filesystem`，放 `resources/skills/video-pipeline/`）。
2. **B2 专用 UI**：对话流内嵌视频预览卡（conversation 槽位）+ 任务列表 Tab（抄 desktop-audit-viewer 的独立 Tab 模式：bridge 查询方法 + client 插件渲染）。
3. **B3 多供应商**（§2.2 路径三）：`ctx.video` 域 + provider 插件矩阵。
4. **B4 斜杠命令**：`/newvideo`、`/render` —— 往 `dsh-commands` 注册表添加（Host 侧 insert 一个 command 插件，照抄 dsh-command-goal 形态）。

### 阶段 C · 裁剪通用面（做减法）

1. **C1 隐藏不相关 UI**：boot-graph `CLIENT_EXCLUDE_IDS` 追加要藏的官方插件（现成机制，directory-picker-browse 就是这么排除的）——如 `ui-trajectory`（轨迹视图）、`ui-settings-plugins`（插件面板）。
2. **C2 persona 定制**：`boot.ts` §2 `system-prompt` persona 覆写为视频导演角色（现成机制，一行改动）。
3. **C3 agent-presets**：`resources/agent-presets/` 加 `videographer` 预设（绑定工具子集 + 提示词），用户开箱即用。
4. **C4 默认视图**：若确需「非对话式」主界面（如看板型），启用 ADR-006 自绘 UI 路线——fork web-frontend 或新 dist，代价大，仅在注入方案确证不满足后启动。

### 阶段 D · 独立分发

1. **D1 品牌分离**：复制工程 → 改 `package.json` name/version、`electron-builder.yml` 的 appId/productName/icon。
2. **D2 裁剪依赖**：垂直版不需要的域（如 subagent/workflow 之外的实验工具）从 §1 insert 删除，减小体积。
3. **D3 更新通道**：复用 M4-b 更新描述符机制（当前为规划态，先手动发包）。
4. **注意**：垂直仓库与底座同步升级时，走 `docs/upstream-migrations.md` 的 sync-upstream SOP（rc.8 → 0.1.1-rc.2 时登记 diff）。

---

## 4. 扩展方式决策表

| 需求形态 | 选择 | 成本 |
|---|---|---|
| 设置项 / 小面板 | Slots 槽位注入 | 低（1 个 client bundle 文件） |
| 按钮触发的业务 API 调用 | bridge unary 方法 + preload 命名空间 | 低（host 模块 + preload 各几行） |
| 自然语言可驱动的业务动作 | Agent 工具（ctx.tools 注册） | 中 |
| 多步骤流水线 | dsh-tool-workflow 编排脚本 / skill | 中 |
| 多供应商抽象 | provider 域插件（仿 llm 域） | 高 |
| 整屏改造主界面 | fork web-frontend（ADR-006） | 高（最后手段） |

**判断口诀**：先槽位、再工具、再域、最后换脸。

---

## 5. 避坑清单（垂直化高频雷区）

| # | 坑 | 出处 |
|---|---|---|
| 1 | 假 slot：向不存在的槽位注册是静默 no-op，无报错 | 坑 13：先用 slots.d.ts 核对槽位契约 |
| 2 | client bundle 里 `exports.inject` 写服务名会 PENDING（服务等待） | 坑 15：`inject: []`，服务用 `ctx.get` 软查找 |
| 3 | 非 insert 补丁对空根配置是静默 no-op | 坑 16：Host 插件必经 `boot.ts` insert 数组 |
| 4 | React in bundle：用 `createElement` 不用 jsx-runtime；children 放 props | desktop-settings-client.js 头注 |
| 5 | 通道常量 preload 内联与 types/channels.ts 人工同步 | preload.ts 头注 |
| 6 | 图标/资源随 nativeTheme 黑白双版 | desktop-tray.ts |
| 7 | 供应商 API Key 走环境变量，禁硬编码 | core-standards R-红线 |
| 8 | 大文件产物走 spill-local，勿塞会话上下文 | boot.ts spill 配置 |

---

## 6. 起步清单（今天就做）

- [ ] 通读 `docs/14-implementation-map.md` §7（载波）+ §11（renderer 注入插件）
- [ ] 打开 `docs/architecture-plugins.html` 认领要复用/要排除的插件
- [ ] 复制 `desktop-panel-client.js` → `video-studio-client.js`，`boot-graph.ts` 登记条目，跑通第一个槽位注入
- [ ] 复制 `desktop-audit-viewer.ts`（host）+ `desktop-audit-viewer-client.js`（client）双件套模板，改名做「视频任务列表」
- [ ] 写 `video_generate` 工具（先项目内模块，插件包化留后）
- [ ] 验收：一句话生成一条占位视频（mock 供应商）走完全链

---

## 7. 本文维护约定

- 垂直化推进中每发现新雷区 → 追加 §5 并同步 `docs/pitfalls.md`。
- 底座里程碑演进（M4 分发/M6 基线动态化）影响本路线时更新 §1/§3-D。
- 与 `architecture-guide.md` 一样，本文为派生文档：代码是唯一真源，机制描述过时即修订。
