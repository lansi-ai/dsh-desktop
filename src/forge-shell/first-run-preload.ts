/**
 * 首启窗口 preload（M4 · 数据目录选择）。
 *
 * contextBridge 白名单面：仅暴露首启决策所需三个方法（读初始状态 / 系统目录
 * 选择对话框 / 确认选择），与主 preload（desktopBridge）同守卫模型：
 * contextIsolation + sandbox + 渲染层零 Node/Electron 直达。
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('firstRunBridge', {
  /** 读首启状态（默认目录 / 旧数据存在性 / 明暗配色）。 */
  getState: (): Promise<unknown> => ipcRenderer.invoke('first-run:get-state'),
  /** 打开系统目录选择对话框；取消返回 null。 */
  browse: (): Promise<string | null> => ipcRenderer.invoke('first-run:browse'),
  /** 确认选择（含迁移开关）；失败返回 {ok:false,error}。 */
  confirm: (home: string, migrate: boolean): Promise<unknown> => ipcRenderer.invoke('first-run:confirm', home, migrate),
})
