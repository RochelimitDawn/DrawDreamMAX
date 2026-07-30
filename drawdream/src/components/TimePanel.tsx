import { Clock } from 'lucide-react'
import './TimePanel.css'

export type TimePanelData = {
  v?: number
  provider?: string
  timezone: string
  datetime: string
  weekday?: string
  weekday_zh?: string
  date?: string
  year?: string
  offset?: string
  timestamp_unix?: number
}

export function parseTimePanelBody(body: string): TimePanelData | null {
  const raw = body.trim()
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const timezone = typeof o.timezone === 'string' ? o.timezone : ''
    const datetime = typeof o.datetime === 'string' ? o.datetime : ''
    if (!timezone || !datetime) return null
    return {
      v: typeof o.v === 'number' ? o.v : 1,
      provider: typeof o.provider === 'string' ? o.provider : 'uapi',
      timezone,
      datetime,
      ...(typeof o.weekday === 'string' ? { weekday: o.weekday } : {}),
      ...(typeof o.weekday_zh === 'string' ? { weekday_zh: o.weekday_zh } : {}),
      ...(typeof o.date === 'string' ? { date: o.date } : {}),
      ...(typeof o.year === 'string' ? { year: o.year } : {}),
      ...(typeof o.offset === 'string' ? { offset: o.offset } : {}),
      ...(typeof o.timestamp_unix === 'number' ? { timestamp_unix: o.timestamp_unix } : {}),
    }
  } catch {
    return null
  }
}

export function TimePanel({ data, className = '' }: { data: TimePanelData; className?: string }) {
  const wd = data.weekday_zh || data.weekday || ''
  const [datePart, timePart] = (() => {
    const s = data.datetime.trim()
    const sp = s.indexOf(' ')
    if (sp > 0) return [s.slice(0, sp), s.slice(sp + 1)]
    return [s, '']
  })()

  return (
    <section className={`dd-time-panel ${className}`.trim()} data-provider={data.provider || 'uapi'}>
      <header className="dd-tp-head">
        <div className="dd-tp-badge">
          <Clock size={14} aria-hidden />
          世界时间
        </div>
        <div className="dd-tp-zone" title={data.timezone}>
          {data.timezone}
          {data.offset ? ` · ${data.offset}` : ''}
        </div>
      </header>
      <div className="dd-tp-body">
        <div className="dd-tp-clock">
          {timePart ? <span className="dd-tp-time">{timePart}</span> : null}
          <span className="dd-tp-date">
            {datePart}
            {wd ? ` · ${wd}` : ''}
          </span>
        </div>
        {data.year ? (
          <p className="dd-tp-hint">当前日历年 {data.year} — 检索「最新/今天」请以此为准</p>
        ) : null}
      </div>
    </section>
  )
}
