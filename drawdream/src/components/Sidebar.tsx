import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  IdCard,
  Layers3,
  MessageSquareText,
  Puzzle,
  Settings,
} from 'lucide-react'
import './Sidebar.css'

type NavItem = {
  to: string
  key: 'cards' | 'chat' | 'library' | 'forge' | 'settings' | 'extensions'
  icon: typeof IdCard
  end?: boolean
}

const items: NavItem[] = [
  { to: '/', key: 'cards', icon: IdCard, end: true },
  { to: '/chat', key: 'chat', icon: MessageSquareText },
  { to: '/library', key: 'library', icon: Layers3 },
  { to: '/novel-forge', key: 'forge', icon: BookOpen },
  { to: '/settings', key: 'settings', icon: Settings },
  { to: '/extensions', key: 'extensions', icon: Puzzle },
]

export function Sidebar() {
  const { t } = useTranslation()
  const location = useLocation()

  return (
    <>
      <aside className="dd-sidebar" aria-label={t('common.primaryNav')}>
        <div className="dd-sidebar-inner">
          <div className="dd-logo" title="DrawDream">
            <img className="dd-logo-mark" src="/brand/logo-mark.svg" alt="" width={28} height={28} />
            <span className="dd-logo-text">DrawDream</span>
          </div>

          <nav className="dd-nav">
            {items.map((item) => {
              const Icon = item.icon
              const active =
                item.key === 'cards'
                  ? location.pathname === '/' || location.pathname.startsWith('/cards')
                  : item.key === 'library'
                    ? location.pathname.startsWith('/library') ||
                      location.pathname.startsWith('/persona') ||
                      location.pathname.startsWith('/world-info') ||
                      location.pathname.startsWith('/presets')
                  : item.end
                    ? location.pathname === item.to
                    : location.pathname.startsWith(item.to)
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end ?? false}
                  className={`dd-nav-item ${active ? 'is-active' : ''}`}
                >
                  <span className="dd-nav-icon">
                    <Icon size={20} strokeWidth={2.1} />
                  </span>
                  <span className="dd-nav-label">{t(`nav.${item.key}`)}</span>
                </NavLink>
              )
            })}
          </nav>
        </div>
      </aside>

      <nav className="mobile-bottom-nav dd-mobile-nav" aria-label={t('common.mobileNav')}>
        {items.map((item) => {
          const Icon = item.icon
          const active =
            item.key === 'cards'
              ? location.pathname === '/' || location.pathname.startsWith('/cards')
              : item.key === 'library'
                ? location.pathname.startsWith('/library') ||
                  location.pathname.startsWith('/persona') ||
                  location.pathname.startsWith('/world-info') ||
                  location.pathname.startsWith('/presets')
              : item.end
                ? location.pathname === item.to
                : location.pathname.startsWith(item.to)
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              className={`dd-mobile-item ${active ? 'is-active' : ''}`}
            >
              <Icon size={20} strokeWidth={2.1} />
              <span>{t(`nav.${item.key}`)}</span>
            </NavLink>
          )
        })}
      </nav>
    </>
  )
}
