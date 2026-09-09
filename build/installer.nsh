; DSH Forge NSIS 自定义安装脚本（electron-builder nsis.include）。
; 卸载询问（M4 · 数据目录选择配套）：卸载时读取应用运行期写入的数据目录
; 标记（HKCU\Software\DSH Forge\DataDir，打包版由 data-home.ts applyHome 写入；
; 更名前旧键 HKCU\Software\DSH Desktop\DataDir 兜底），询问用户是否一并删除
; 用户数据（API 凭据/会话记录/设置等）。
; 安全校验：路径过短、盘根、系统目录一律拒删，且目录必须带 DSH 痕迹文件——
; 防「home 被指到 E:\ 或别的目录」时 RMDir /r 误删整个目录。
; 保留数据时标记也保留（重装后再次卸载仍会询问）；删除时标记一并清除。
; 注意：本文件含中文，必须保存为 UTF-8 with BOM（makensis 无 BOM 时按系统
; ANSI 代码页解析，中文会乱码——同 PS1 BOM 坑）。

!macro customUnInstall
  ReadRegStr $R0 HKCU "Software\DSH Forge" "DataDir"
  StrCmp $R0 "" 0 uninstall_have_home
  ReadRegStr $R0 HKCU "Software\DSH Desktop" "DataDir"
  uninstall_have_home:
  StrCmp $R0 "" uninstall_done

  StrLen $R1 $R0
  IntCmp $R1 6 uninstall_refuse uninstall_refuse uninstall_len_ok
  uninstall_len_ok:
  StrCmp $R0 "$PROFILE" uninstall_refuse
  StrCmp $R0 "$DOCUMENTS" uninstall_refuse
  StrCmp $R0 "$DESKTOP" uninstall_refuse
  StrCmp $R0 "$APPDATA" uninstall_refuse
  StrCmp $R0 "$LOCALAPPDATA" uninstall_refuse
  StrCmp $R0 "$TEMP" uninstall_refuse
  IfFileExists "$R0\settings.yaml" uninstall_ask
  IfFileExists "$R0\.credentials.yaml" uninstall_ask
  IfFileExists "$R0\sessions" uninstall_ask
  IfFileExists "$R0\storages" uninstall_ask
  Goto uninstall_refuse

  uninstall_ask:
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除 DSH Forge 的用户数据？$\r$\n$\r$\n位置：$R0$\r$\n$\r$\n包含 API 凭据、会话记录与设置。选择「否」将保留数据，重装后可继续使用。" IDYES uninstall_delete_data
  Goto uninstall_done

  uninstall_delete_data:
    RMDir /r "$R0"
    DeleteRegValue HKCU "Software\DSH Forge" "DataDir"
    DeleteRegValue HKCU "Software\DSH Desktop" "DataDir"
  Goto uninstall_done

  uninstall_refuse:
    MessageBox MB_OK|MB_ICONEXCLAMATION "已跳过删除用户数据：$\r$\n$\r$\n位置：$R0$\r$\n$\r$\n该路径不在预期范围（盘根/系统目录或缺少 DSH 数据痕迹），为防误删已自动跳过；如确需清理请手动删除。"
  uninstall_done:
!macroend
