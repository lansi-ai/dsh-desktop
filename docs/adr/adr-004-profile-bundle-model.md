# ADR-004 · 装配模型：desktop 作为 profile + bundle（能力=插件行）

状态：**已接受**（2026-08）· 关联：[`05-host-plugins.md`](../05-host-plugins.md)、[`06-client-plugins.md`](../06-client-plugins.md)

## 背景
桌面能力怎么进运行时：改官方源码 / 壳层硬编码 / 官方 profile+bundle 机制注入。

## 决策
- 桌面 = 一个 **bundle**（npm 包，`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`），
  作为 `dsh.profile.bundles` 的桌面 profile 层（叠加在 base + web-app 之上）；
- **每个桌面能力一个 plugin 行**（`desktop-host-*`），用户可整行 patch 增删/改配置；
- 客户端注入走官方 slot（`ctx.slots`）+ `dsh.client` roster；
- 自有包 scope：`@lansi-ai/dsh-*`（蓝思公司 scope + dsh 生态前缀，2026-08-27 由 `@dsh-desktop/*` 更名定案，不冒用 `@deepseek-ai`）。

## 理由
1. 与官方「装配=配置」哲学同构：`--dump-config` 可见、patch 可改、HMR 可热换；
2. 桌面能力获得和官方能力相同的治理（effect 清理、审计、插件清单 UI）；
3. 官方 Web 插件（host/client）在桌面**无改动**可用的承诺由同一机制保证（R-02 判定标准）。

## 后果
- desktop patch 与上游 web-app 行的耦合（`webserver/web-runtime` 禁用、`desktop-runtime` 增补）→
  维护「行差集校验」测试（`bundle/test/patch-invariants.spec.ts`），每次上游升级跑差集；
- bundle 即分发的分发面：`dsh plugin` 可安装/卸载桌面能力 bundle——反向证明插件化主张。

## 备选否决
- 改官方源码：破坏「无特权内核」契约；升级灾难
- 壳层硬编码：不可审计、不可卸载、与 L1 社区差别不大

## 复查触发
上游 profile/bundle 面演进（如 profile v2）时同步迁移。