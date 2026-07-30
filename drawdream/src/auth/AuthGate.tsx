import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { BanterLoader } from '../components/BanterLoader'
import { useTranslation } from 'react-i18next'

/**
 * 单机优先：仅等待本地会话就绪，不再跳转登录页。
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const { t } = useTranslation()

  if (loading || !user) {
    return <BanterLoader label={t('common.loading')} />
  }

  return <>{children}</>
}
