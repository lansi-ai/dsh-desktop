# 指南总览

DSH Forge 把 DeepSeek Harness 做成了一个真正的桌面应用：与官方 Web 版同内核、同数据，同时补上托盘驻留、全局热键、系统通知等桌面能力。

## 从零开始

<div class="feature-cards">
  <a href="./install">
    <strong>安装与首次启动</strong>
    <span>下载安装包、选择数据目录、了解用户数据存放位置。</span>
  </a>
  <a href="./quickstart">
    <strong>快速上手</strong>
    <span>配置模型 → 选择工作区 → 运行第一个任务。</span>
  </a>
  <a href="./workspace">
    <strong>工作区与会话</strong>
    <span>添加工作区、管理会话列表、搜索历史会话。</span>
  </a>
</div>

## 深入使用

| 主题 | 你能了解到 |
| :--- | :--- |
| [桌面能力](./desktop) | 托盘驻留、全局热键、系统通知、开机自启、`dsh://` 协议唤起 |
| [设置](./settings) | 桌面与外观设置项、图标包切换、关于页 |
| [更新与渠道](./update) | 自动更新三通道（稳定版 / 预发布 / 关闭）与手动检查 |
| [常见问题](./faq) | 数据目录、与 Web 版共存、端口占用、卸载与数据保留 |

## 前置条件

- 一台 Windows 10/11（x64）机器；
- 一个可用的 DeepSeek API 密钥（用于模型调用）；
- 一个你想交给 Agent 处理的项目目录。

不需要自行安装 Node.js、pnpm 或任何插件环境——安装包已包含运行时。
