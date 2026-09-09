---
layout: home

hero:
  name: DSH Forge
  text: 把桌面操作系统锻造成 DeepSeek Harness 的可插拔能力层
  tagline: 一包安装即用 · 零 HTTP 端口 · 与官方 Web 同内核、同数据目录
  image:
    src: /logo-light.png
    alt: DSH Forge
  actions:
    - theme: brand
      text: 快速上手
      link: /guide/quickstart
    - theme: alt
      text: 下载安装包
      link: /download

features:
  - icon: >-
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
    title: 一包安装即用
    details: 安装包内含运行时与官方 UI 发行物，无需自行准备 Node、pnpm 或插件环境，装完即可开始对话。
  - icon: >-
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    title: 宿主内嵌、零端口
    details: Electron 主进程内嵌 Cordis Host，界面经自定义协议加载，默认不监听任何 HTTP 端口。
  - icon: >-
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/></svg>
    title: 与官方同内核
    details: 同一套会话、轨迹与沙箱语义，共享 DSH_HOME 数据目录，与 dsh web 的会话历史互通。
  - icon: >-
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
    title: 桌面原生能力
    details: 托盘驻留、全局热键唤出、系统通知（点击定位会话）、开机自启，全部以 host 插件形态注入。
  - icon: >-
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
    title: 关窗不杀宿主
    details: 关闭窗口后任务继续在后台运行，完成时经系统通知提醒，随时唤起继续。
  - icon: >-
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
    title: 三通道自动更新
    details: 稳定版 / 预发布 / 关闭自动检查可在设置中随时切换，更新描述符随 GitHub Releases 发布。
---

## 三步开始

<div class="feature-cards">
  <a href="./download">
    <strong>1 · 下载安装包</strong>
    <span>从 GitHub Releases 获取 Windows 安装包或便携包，双击安装即可。</span>
  </a>
  <a href="./guide/quickstart">
    <strong>2 · 配置模型</strong>
    <span>在设置 → 模型 中填入 DeepSeek API 密钥并保存，无需重启。</span>
  </a>
  <a href="./guide/workspace">
    <strong>3 · 选择工作区</strong>
    <span>添加一个项目目录并选中，然后新建会话开始你的第一个任务。</span>
  </a>
</div>

## 它是什么

DSH Forge 是一个面向个人的 **DeepSeek Harness 桌面客户端**。它不是给网页套一层浏览器外壳，而是把 Electron 主进程直接内嵌进 Harness 的插件树：桌面能力（托盘、热键、通知、自启、协议唤起）都以 host 插件形态注册，可被列出、可被增删、可被审查。

界面主面复用**官方 Web UI 发行物**，因此你的插件、会话与工作流无需迁移即可继续使用；桌面侧只做增强，不改写任何官方协议语义。

## 与官方 Web 版的关系

| 维度 | 说明 |
| :--- | :--- |
| 数据目录 | 共享同一 `DSH_HOME`（可在首次启动时选择），会话、凭据、主题全部互通 |
| 会话历史 | 与 `dsh web` 使用同一份持久化格式，切回浏览器可无缝继续 |
| 传输方式 | 桌面端走自定义协议 + IPC 载波，默认零端口；`dsh web` 仍按官方方式监听端口 |
| 并存使用 | 两者可同时安装，默认不会互相抢端口 |

## 当前状态

项目处于 **alpha 预发布** 阶段，Windows 10/11（x64）为主要平台，macOS 产物随 CI 构建。功能与界面仍在快速迭代，欢迎在 [GitHub Issues](https://github.com/lansi-ai/dsh-forge/issues) 反馈问题。

本项目为独立社区项目，与 DeepSeek 官方无附属关系。
