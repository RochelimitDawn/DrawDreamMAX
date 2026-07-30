import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import './UsageStatsCard.css'

export type UsageDayBar = {
  day: string
  /** 0–1 relative height */
  value: number
  /** absolute for tooltip */
  count?: number
}

export type UsageReading = {
  label: string
  value: string
}

export type UsageStatsCardProps = {
  title?: string
  rangeValue: string | number
  rangeUnit?: string
  dateRange?: string
  bars: UsageDayBar[]
  readings?: UsageReading[]
  fullStatsLabel?: string
  onFullStats?: () => void
  className?: string
}

export function UsageStatsCard({
  title,
  rangeValue,
  rangeUnit = '',
  dateRange,
  bars,
  readings = [],
  fullStatsLabel,
  onFullStats,
  className = '',
}: UsageStatsCardProps) {
  const { t } = useTranslation()
  const avg = useMemo(() => {
    if (!bars.length) return 0.45
    const sum = bars.reduce((s, b) => s + (b.value || 0), 0)
    return Math.min(0.92, Math.max(0.12, sum / bars.length))
  }, [bars])

  return (
    <div className={`usage-stats-card ${className}`.trim()}>
      <div className="usage-stats-header">
        <span className="usage-stats-title">{title ?? t('stats.activity')}</span>
        {onFullStats ? (
          <button type="button" className="usage-stats-full-btn" onClick={onFullStats}>
            {fullStatsLabel ?? t('stats.fullStats')}
          </button>
        ) : null}
      </div>
      <div className="usage-stats-range">
        <span className="usage-stats-range-value">{rangeValue}</span>
        {rangeUnit ? <span className="usage-stats-range-unit">{rangeUnit}</span> : null}
      </div>
      {dateRange ? <div className="usage-stats-date">{dateRange}</div> : null}

      <div className="usage-stats-chart-wrap">
        <div className="usage-stats-chart">
          <div className="usage-stats-avg-line" style={{ top: `${(1 - avg) * 100}%` }}>
            <span className="usage-stats-avg-label">{t('stats.avg')}</span>
          </div>
          {bars.map((b) => {
            const h = Math.max(8, Math.round((b.value || 0) * 72))
            return (
              <div key={b.day} className="usage-stats-bar-col" title={b.count != null ? String(b.count) : undefined}>
                <div className="usage-stats-bar-track">
                  <div className="usage-stats-bar" style={{ height: h }}>
                    <span className="usage-stats-dot usage-stats-dot-top" />
                    <span className="usage-stats-dot usage-stats-dot-bottom" />
                  </div>
                </div>
                <span className="usage-stats-day">{b.day}</span>
              </div>
            )
          })}
        </div>
      </div>

      {readings.length > 0 ? (
        <div className="usage-stats-readings">
          {readings.map((r) => (
            <div key={r.label} className="usage-stats-reading">
              <span className="usage-stats-reading-label">{r.label}</span>
              <span className="usage-stats-reading-value">{r.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
