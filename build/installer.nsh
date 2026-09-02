﻿; DSH Desktop NSIS 自定义安装脚本（electron-builder nsis.include）。
; 卸载询问（M4 · 数据目录选择配套）：卸载时读取应用运行期写入的数据目录
; 标记（HKCU\Software\DSH Desktop\DataDir，打包版由 data-home.ts applyHome 写入），
; 询问用户是否一并删除用户数据（API 凭据/会话记录/设置等）。
; 保留数据时标记也保留（重装后再次卸载仍会询问）；删除时标记一并清除。
; 注意：本文件含中文，必须保存为 UTF-8 with BOM（makensis 无 BOM 时按系统
; ANSI 代码页解析，中文会乱码——同 PS1 BOM 坑）。

!macro customUnInstall
  ReadRegStr $R0 HKCU "Software\DSH Desktop" "DataDir"
  StrCmp $R0 "" uninstall_done
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除 DSH Desktop 的用户数据？$\r$\n$\r$\n位置：$R0$\r$\n$\r$\n包含 API 凭据、会话记录与设置。选择「否」将保留数据，重装后可继续使用。" IDYES uninstall_delete_data
  Goto uninstall_done
  uninstall_delete_data:
    RMDir /r "$R0"
    DeleteRegValue HKCU "Software\DSH Desktop" "DataDir"
  uninstall_done:
!macroend
