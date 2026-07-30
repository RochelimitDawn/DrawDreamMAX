import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './HotSearchChips.css'

interface Props {
  tags: string[]
  active?: string
  onPick: (tag: string) => void
  titleKey?: string
}

export function HotSearchChips({ tags, active, onPick, titleKey = 'common.searchDiscover' }: Props) {
  const { t } = useTranslation()
  const [seed, setSeed] = useState(0)

  const shown = useMemo(() => {
    if (!tags.length) return []
    const start = seed % tags.length
    return [...tags.slice(start), ...tags.slice(0, start)].slice(0, 10)
  }, [tags, seed])

  const hotSet = useMemo(() => new Set(shown.slice(0, 2)), [shown])

  return (
    <section className="dd-hot-search">
      <div className="dd-hot-search-head">
        <h3>{t(titleKey)}</h3>
        <button
          type="button"
          className="dd-hot-refresh"
          onClick={() => setSeed((s) => s + 3)}
          aria-label={t('common.refresh')}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="dd-hot-chips">
        {shown.map((tag) => (
          <button
            key={tag}
            type="button"
            className={`dd-hot-chip ${hotSet.has(tag) ? 'is-hot' : ''} ${active === tag ? 'is-active' : ''}`}
            onClick={() => onPick(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
    </section>
  )
}
