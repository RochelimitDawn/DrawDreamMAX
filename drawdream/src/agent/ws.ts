import type { ClientFrame, ServerFrame } from './wire.types'

export type ConnState = 'connecting' | 'open' | 'closed'

export interface WireClient {
  send: (frame: ClientFrame) => void
  close: () => void
  getState: () => ConnState
}

/**
 * 建立与 DrawDream Agent 的 WebSocket（同源 /ws，由 Agent :7620 托管）。
 * 断线自动重连：1.5s 起指数退避，封顶 10s。
 */
export function connectWire(
  onFrame: (frame: ServerFrame) => void,
  onState: (s: ConnState) => void,
): WireClient {
  let closed = false
  let retryMs = 1500
  let timer: ReturnType<typeof setTimeout> | undefined
  let ws: WebSocket | null = null
  let state: ConnState = 'connecting'

  const setState = (s: ConnState) => {
    state = s
    onState(s)
  }

  const connect = () => {
    if (closed) return
    setState('connecting')
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${proto}//${location.host}/ws`)
    ws = socket

    socket.onopen = () => {
      retryMs = 1500
      setState('open')
    }
    socket.onmessage = (ev) => {
      try {
        onFrame(JSON.parse(String(ev.data)) as ServerFrame)
      } catch {
        /* ignore */
      }
    }
    socket.onclose = (ev) => {
      if (closed) return
      if (ev.code === 4401) {
        setState('closed')
        if (typeof window !== 'undefined') {
          void fetch('/api/auth/local-session', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
            .then((r) => {
              if (r.ok) window.location.reload()
            })
            .catch(() => {
              /* AuthGate 会继续尝试 local-session */
            })
        }
        return
      }
      setState('closed')
      timer = setTimeout(connect, retryMs)
      retryMs = Math.min(retryMs * 2, 10_000)
    }
    socket.onerror = () => socket.close()
  }

  connect()

  return {
    send: (frame) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
    },
    close: () => {
      closed = true
      if (timer) clearTimeout(timer)
      ws?.close()
      ws = null
    },
    getState: () => state,
  }
}
