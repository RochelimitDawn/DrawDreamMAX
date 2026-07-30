import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, ScrollText, UserRound, Layers3 } from 'lucide-react'
import { Reveal } from '../motion'
import './Secondary.css'
import './Library.css'

const hubs = [
  {
    key: 'persona',
    to: '/persona',
    icon: UserRound,
    titleKey: 'secondary.persona.title',
    descKey: 'library.personaDesc',
    inject: 'config.userName / userPersona → system「用户扮演」',
  },
  {
    key: 'world',
    to: '/world-info',
    icon: BookOpen,
    titleKey: 'secondary.worldInfo.title',
    descKey: 'library.worldDesc',
    inject: 'constant lore → system；scan 命中 → 每轮【相关设定】',
  },
  {
    key: 'presets',
    to: '/presets',
    icon: ScrollText,
    titleKey: 'secondary.presets.title',
    descKey: 'library.presetDesc',
    inject: 'system 块 → systemPrompt；postHistory → 末端注入',
  },
] as const

/** 资料枢纽：人设 / 世界书 / 预设统一入口 */
export function LibraryPage() {
  const { t } = useTranslation()

  return (
    <div className="page secondary-page library-page">
      <Reveal className="secondary-head library-hero" y={16}>
        <div className="library-hero-icon" aria-hidden>
          <Layers3 size={28} />
        </div>
        <div>
          <h1>{t('library.title')}</h1>
          <p>{t('library.subtitle')}</p>
        </div>
      </Reveal>

      <div className="library-grid">
        {hubs.map((h, i) => {
          const Icon = h.icon
          return (
            <Reveal key={h.key} className="library-card surface" delay={i * 0.05} y={18}>
              <div className="library-card-icon">
                <Icon size={22} />
              </div>
              <h3>{t(h.titleKey)}</h3>
              <p className="library-card-desc">{t(h.descKey)}</p>
              <code className="library-card-inject">{h.inject}</code>
              <Link to={h.to} className="btn btn-primary btn-sm library-card-go">
                {t('library.open')}
              </Link>
            </Reveal>
          )
        })}
      </div>
    </div>
  )
}
