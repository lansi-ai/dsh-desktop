/**
 * dsh-desktop host 会话事件 → renderer 下行帧中继（Step 7·攻坚第 2 批）。
 *
 * 固定 Cordis Host 的 apiProxy 已把 session/event、session/jobs、approval/question
 * requested 等事件装配为 mux/host 事件流（每帧产出 `{rpcId, payload: frame}`）：
 *   ctx.apiProxy.events.mux({}, signal)
 *     ├─ mux：session/event、session/projection、session/jobs、approval/question requested 等
 *     └─ host：host/session-added、workspace 变更等宿主流
 *
 * 本模块把这两条流逐帧转发到 renderer（webContents.send('dsh:frame', payload)），
 * 即 IPC 载波的「下行 server-request 帧」路径。renderer 端 ipc-connection 的
 * readIpFrames 经 desktopBridge.onFrame 接收后，用自身 streamRpcId 重包为
 * `{rpcId, payload}` 交 ConnectionController 分发到各 sink。
 *
 * 仅转发 `payload`（host mux 帧本体），而非外层信封：renderer 端按 `frame.type`
 * 判类（session/event 等），外层的 rpcId 由 readIpFrames 自铸即可。
 */

import type { WebContents } from 'electron'
import { IPC_CHANNELS } from '../types/channels.js'

/** host apiProxy 事件流接口（`events.mux` / `events.host` 的公共形状）。 */
export interface DownlinkEventStream {
  events: {
    mux(request: unknown, signal: AbortSignal): AsyncIterable<{ rpcId: string; payload: unknown }>
    host(request: unknown, signal: AbortSignal): AsyncIterable<{ rpcId: string; payload: unknown }>
  }
}

/** 下行帧中继句柄（app 退出时调用 stop 释放监听与信号）。 */
export interface DownlinkRelay {
  /** 停止中继：中止事件流、移除窗口销毁监听。 */
  stop(): void
}

/**
 * 启动下行帧中继：把 host apiProxy 的 mux/host 事件流逐帧推给指定窗口。
 *
 * @param apiProxy 已就绪 Cordis Host 的 ctx.apiProxy。
 * @param webContents 目标窗口的 WebContents；窗口销毁时自动停止。
 * @returns 中继句柄。
 */
export function startDownlinkRelay(apiProxy: DownlinkEventStream, webContents: WebContents): DownlinkRelay {
  const ac = new AbortController()
  let stopped = false

  const stop = (): void => {
    if (stopped) return
    stopped = true
    ac.abort()
  }
  const live = (): boolean => !stopped && !webContents.isDestroyed()

  async function pump(stream: AsyncIterable<{ rpcId: string; payload: unknown }>): Promise<void> {
    if (!live()) return
    try {
      for await (const envelope of stream) {
        if (!live()) break
        // 只下发帧 payload（renderer 端 readIpFrames 用自身 rpcId 重包）
        webContents.send(IPC_CHANNELS.FRAME, envelope.payload)
      }
    } catch {
      // 流关闭（窗口销毁/应用退出）——保持静默。
    } finally {
      stop()
    }
  }

  // mux（会话事件）+ host（宿主流）双流并行前推
  pump(apiProxy.events.mux({}, ac.signal))
  pump(apiProxy.events.host({}, ac.signal))

  // 窗口销毁 → 自动停止中继
  const onDestroyed = (): void => stop()
  webContents.once('destroyed', onDestroyed)

  return {
    stop: () => {
      webContents.removeListener('destroyed', onDestroyed)
      stop()
    },
  }
}