# 11 · 风险登记

> 格式：ID / 风险 / 概率×影响 / 缓解 / 状态。状态：`open`（待处理）· `watch`（持续观察）· `closed`（已消除）。

## 上游相关

| ID | 风险 | 评级 | 缓解 | 状态 |
| --- | --- | --- | --- | --- |
| R1 | 上游 developer preview 破坏性变更（API/协议/装配） | 高×高 | 版本钉死 + 耦合收敛 3 文件 + `sync-upstream` 迁移登记（ADR-005） | watch |
| R2 | 官方未来发布「官方桌面」，社区桌面先发优势稀释 | 中×中 | 深度差异化（内嵌宿主/能力插件化）而非壳本身；持续贡献上游（把 IPC 桥、BootSeams 需求 upstream 化） | watch |
| R3 | 审批帧 wire（`approval/requested` → `respond`）为 stub / 未实现 | 高×高（阻塞 M1-T3） | ✅ 2026-08-25 已核实：基线源码 `respond` 已完整实现（pending 表 + 稳定 rpcId + not-pending，ADR-003），按「全量一致」实现 | closed |
| R4 | dist 构建产物不可得（上游脚本链变化） | 中×中 | ✅ 2026-08-25 已核实：官方 npm 包 `@deepseek-ai/dsh-web-frontend@0.1.0-rc.8` 直接携带 dist 发行物（`dist/` index.html+assets 分块齐全，与 `apps/web` vite 布局一致），无需自建构建脚本 | closed |
| R5 | `BootSeams`/自定义协议在真实 file:// 环境行为未验证 | 高×中 | M1-T4 双案 spike，2 天出结论；最坏回退只装官方 roster client 插件 + 提上游 issue | open |

## 架构与实现

| ID | 风险 | 评级 | 缓解 | 状态 |
| --- | --- | --- | --- | --- |
| R6 | Electron 多进程与 Host 同进程：退出竞态/异步残留导致状态丢失 | 中×高 | 优雅退出三态 + 崩溃安全持久化（append-only JSONL）+ e2e 杀进程矩阵 | open |
| R7 | 多窗口载波 rpcId 路由冲突/时序 | 中×中 | 载波注册表按 sender 路由 + 官方 rpcId 纪律 + 针对性测试矩阵 | open |
| R8 | Windows 平台差异（toast dev 模式、托盘、全局热键冲突） | 中×中 | Win 优先开发实测；热键冲突检测与提示；toast 兜底气泡 | open |
| R9 | 内存/启动性能不达标（Chromium+Host） | 中×中 | 性能预算表（07§8）+ 延迟装载 + 空闲冻结 + 实测门禁 | open |
| R10 | 客户端插件在桌面环境的兼容偏差（官方 UI 对窗口宽高/媒体查询假设） | 低×中 | 仅槽位注入不改布局；e2e 快照对比 Web 面 | watch |
| R11 | 自研 UI 面/皮肤与主题 token 演进漂移 | 低×低 | token 只做覆盖不改语义；皮肤升为 P2 | open |

## 安全与分发

| ID | 风险 | 评级 | 缓解 | 状态 |
| --- | --- | --- | --- | --- |
| R12 | 插件供应链（恶意 bundle） | 中×高 | 装载=信任（官方立场）+ approval/fs 沙箱兜底 + P2 签名校验 | open |
| R13 | 签名/notarization 成本与流程（Win EV/mac） | 中×中 | Win OV 起（便宜可行），EV 延后；mac 延后到扩展期 | open |
| R14 | 更新通道被中间人/回滚攻击 | 低×高 | HTTPS + SHA256 强校验 + 防回滚；描述符签名（P2） | open |
| R15 | 未签名 dev 构建的「假证书」诱导 | 低×低 | 发布页引导校验 SHA256SUMS 步骤（对齐社区桌面） | open |

## 项目与生态

| ID | 风险 | 评级 | 缓解 | 状态 |
| --- | --- | --- | --- | --- |
| R16 | 单人维护摊薄（dist/更新/插件多面） | 中×中 | 三平台延后（Win 首发）；M2 不依赖外部协作；复用上游产物最大化 | open |
| R17 | 与社区桌面项目功能重叠导致方向失焦 | 中×低 | 红线清单（README）锚定「非套壳深度 + 自绘 UI」；roadmap 聚焦能力插件化 | watch |
| R18 | 许可/商标边界（`@deepseek-ai` scope 使用） | 低×中 | 自有包用 `@lansi-ai/dsh-*` scope（蓝思公司 scope + dsh 生态前缀，2026-08-27 定名）；官方案例代码 MIT 引用注明 | closed（设计期内规避） |

## 自绘 UI 与兼容层（v2 新增）

| ID | 风险 | 评级 | 缓解 | 状态 |
| --- | --- | --- | --- | --- |
| R21 | 自绘 UI 工程量侵蚀主线（对话流/时间线/设置/命令面板） | 高×高 | 渐进式自绘（13§6 三波）：M1 只做对话流最小集；重管理面先进兼容窗口 | open |
| R22 | 样式主观性：自绘 UI 是否「好用/好看」取决于用户口味，存在返工 | 中×中 | M0 静态原型走查（D1–D8 差异清单）先确认方向；M1 后 dogfood 迭代 | open |
| R23 | 双 UI 面（主面+兼容窗口）维护与漂移：官方 UI 槽位/机制演进 | 中×高 | 兼容窗口 dist 随基线冻结（ADR-005）；槽位 shim 三期慎用；兼容面持续收缩（M5 迁移） | open |
| R24 | 旧插件 `inject: ['webServer']` 兼容处理未定（同名服务 vs patch 改指） | 中×中 | M2 spike 定案二选一；兼容层测试把三个旧插件 host 半全部覆盖 | open |
| R25 | 兼容窗口「零端口同源 bundle 面」实现风险（官方 dist 依赖同源 script） | 中×高 | M2 spike；最坏回退：兼容窗口走 `--serve`（loopback，仅兼容窗口绑定） | open |

## 升级基线

| ID | 风险 | 评级 | 缓解 | 状态 |
| --- | --- | --- | --- | --- |
| R19 | 本地检出与 GitHub 最新 rc 差异导致文档假设过期 | 中×中 | ✅ 2026-08-25 已决策钉基线本地检出 `dsh-v0.1.0-rc.8`（事实表全部可复核）；**2026-09-01 已实测上游最新稳定为 `0.1.1-rc.2`（旧载「rc.12」系臆测项，无 `0.1.0-rc.12`）**，差异 diff 登记 sync-upstream 迁移表 C 区（结论：3 类拴合面无破坏性变更）；**2026-09-01 已按 M4-d3 实际升级采用 `0.1.2-alpha.3`**（载波整链重写） | closed |
| R20 | 上游将 apiproxy 迁移/合并至 typert 等新协议面 | 中×高 | ✅ **0.1.2-alpha.3 已实际发生**（M4-d3 迁移消化）：`dsh-host-apiproxy` 删除，RPC 改 `connection`(createSharedFetchHandler) + `typertGateway`(wireStream.open) 双通道，`__DSH_TRANSPORT__` 自持传输接管；详见 `m4-d3-012-alpha3-migration-plan.md` | closed（2026-09-01） |

---

> 登记表随实现滚动更新；每个里程碑评审时过一遍 `open` 项，未缓解的 `open` 项该里程碑不可宣「完成」。