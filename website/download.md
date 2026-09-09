# 下载

DSH Forge 的安装包统一发布在 **GitHub Releases**，每个版本附带校验文件。

<a class="VPButton medium brand" href="https://github.com/lansi-ai/dsh-forge/releases">前往 Releases 下载最新版</a>

::: warning 预发布版本
当前版本号带 `-alpha` 后缀，属于预发布（pre-release）渠道。预发布不会出现在仓库首页的「Latest」标记中，请在 Releases 页面选择带 `v0.1.1-alpha.*` 标签的版本。
:::

## Windows

| 产物 | 文件名形态 | 说明 |
| :--- | :--- | :--- |
| 安装包 | `DSH-Forge-<版本>-setup.exe` | NSIS 单文件安装器，双击安装，默认安装到当前用户目录（无需管理员权限） |
| 便携包 | `DSH-Forge-<版本>-portable.exe` | 免安装单文件，适合试用；用户数据仍写入你选择的数据目录 |
| 校验文件 | `SHA256SUMS` | 上述所有 `.exe` 的 SHA256 校验和 |

系统要求：**Windows 10 / 11（x64）**。

## macOS

CI 会为每个版本构建 `dmg` 与 `zip` 两种产物，并按架构（`arm64` / `x64`）区分。当前尚未实机验证，尝鲜请留意反馈。

::: tip 未签名提示
产物未使用 Apple 开发者证书签名，首次打开可能需要在「系统设置 → 隐私与安全性」中放行，或右键选择「打开」。
:::

## 校验下载文件

Windows PowerShell：

```powershell
Get-FileHash -Algorithm SHA256 .\DSH-Forge-<版本>-setup.exe
```

将输出与 Release 页面 `SHA256SUMS` 文件中对应行的哈希逐字比对即可。

## 首次启动

1. 首次启动会询问**数据目录**（即 `DSH_HOME`）：会话、凭据、主题、图标等用户数据都会存放在这里。
2. 如果本机已经用过 `dsh web`，选择同一个目录即可直接读到既有会话历史。
3. 需要脚本化或指定固定目录时，可用命令行参数启动：

```powershell
"DSH Forge.exe" --data-dir "D:\DSH-Home"
```

更多说明见[安装与首次启动](./guide/install)。
