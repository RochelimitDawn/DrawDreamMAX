import { useEffect, useSyncExternalStore } from 'react'
import { sessionStore, type SessionSnapshot } from './session-store'

/** 订阅 DrawDream 会话 store，并在挂载时启动 WS */
export function useSession(): SessionSnapshot & {
  store: typeof sessionStore
} {
  const snap = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot, sessionStore.getSnapshot)

  useEffect(() => {
    sessionStore.start()
    return () => {
      /* 保持连接跨路由；仅页面卸载整个 app 时关闭 */
    }
  }, [])

  return { ...snap, store: sessionStore }
}
