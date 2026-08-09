import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  ensureLocalSession,
  fetchAuthStatus,
  fetchUserSettings,
  putUserSettings,
  type PublicUser,
} from './auth-api'
import { applyClientSettings, parseSettingsBackup } from '../utils/settings-backup'
import { collectClientSettings } from '../utils/settings-backup'

type AuthState = {
  loading: boolean
  user: PublicUser | null
  /** 固定 single：移动端主线无账号体系 */
  authMode: string
  refresh: () => Promise<void>
  pushSettings: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function pullServerSettings() {
  try {
    const { settings } = await fetchUserSettings()
    if (settings && typeof settings === 'object') {
      const parsed = parseSettingsBackup(settings)
      applyClientSettings(parsed)
    }
  } catch {
    /* 无设置 */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<PublicUser | null>(null)
  const [authMode, setAuthMode] = useState('single')

  const refresh = useCallback(async () => {
    let st = await fetchAuthStatus()
    setAuthMode(st.mode || 'single')
    // 无会话则建立本地静默会话（APK / 单机）
    if (!st.user) {
      try {
        await ensureLocalSession()
        st = await fetchAuthStatus()
        setAuthMode(st.mode || 'single')
      } catch {
        /* AuthGate 继续等待 */
      }
    }
    setUser(st.user)
    if (st.user) {
      await pullServerSettings()
    }
  }, [])

  useEffect(() => {
    void refresh()
      .catch(() => {
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [refresh])

  const pushSettings = useCallback(async () => {
    if (!user) return
    const payload = collectClientSettings()
    await putUserSettings(payload)
  }, [user])

  const value = useMemo(
    () => ({
      loading,
      user,
      authMode,
      refresh,
      pushSettings,
    }),
    [loading, user, authMode, refresh, pushSettings],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
