import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import './SearchField.css'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  onClear?: () => void
  showCancel?: boolean
  onCancel?: () => void
  autoFocus?: boolean
  className?: string
}

export function SearchField({
  value,
  onChange,
  placeholder,
  onClear,
  showCancel,
  onCancel,
  autoFocus,
  className = '',
}: Props) {
  const { t } = useTranslation()

  return (
    <div className={`dd-search-field ${className}`.trim()}>
      <div className="dd-search-input-wrap">
        <Search size={18} className="dd-search-icon" aria-hidden />
        <input
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t('common.searchPlaceholder')}
          aria-label={t('common.search')}
        />
        {value ? (
          <button
            type="button"
            className="dd-search-clear"
            onClick={() => {
              onChange('')
              onClear?.()
            }}
            aria-label={t('common.reset')}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      {showCancel ? (
        <button type="button" className="dd-search-cancel" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      ) : null}
    </div>
  )
}
