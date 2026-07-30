import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChapterAnchor } from '../utils/chapter-anchors'
import './StickyChapterBar.css'

export function StickyChapterBar({
  anchors,
  rootRef,
  enabled,
  /** 状态账本 chapter 字段：优先展示；无 DOM 锚点时作唯一来源 */
  ledgerChapter = '',
  /** 账本 location：chapter 为空时的次级回退 */
  ledgerLocation = '',
}: {
  anchors: ChapterAnchor[]
  rootRef: React.RefObject<HTMLElement | null>
  enabled: boolean
  ledgerChapter?: string
  ledgerLocation?: string
}) {
  const { t, i18n } = useTranslation()
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const sorted = useMemo(
    () => [...anchors].sort((a, b) => a.order - b.order),
    [anchors],
  )

  const byKey = useMemo(() => {
    const m = new Map<string, ChapterAnchor>()
    for (const a of sorted) m.set(a.key, a)
    return m
  }, [sorted])

  const ledgerTitle = (ledgerChapter || ledgerLocation || '').trim()
  const hasAnchors = sorted.length > 0
  const hasLedger = ledgerTitle.length > 0

  useEffect(() => {
    if (!enabled || !hasAnchors) {
      setActiveKey(null)
      return
    }
    const root = rootRef.current
    if (!root) return

    const visible = new Map<string, number>()
    const pick = () => {
      if (visible.size === 0) return
      let best: string | null = null
      let bestTop = Infinity
      for (const [k, top] of visible) {
        if (top < bestTop) {
          bestTop = top
          best = k
        }
      }
      if (best) setActiveKey(best)
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).dataset.readAnchor
          if (!key) continue
          if (e.isIntersecting) visible.set(key, e.boundingClientRect.top)
          else visible.delete(key)
        }
        pick()
      },
      // 放宽相交带：原 -72% 过窄导致长气泡内锚点难命中
      { root, rootMargin: '-4% 0px -55% 0px', threshold: [0, 0.05, 0.2, 0.5, 1] },
    )

    const observeAll = () => {
      io.disconnect()
      visible.clear()
      const nodes = root.querySelectorAll<HTMLElement>('[data-read-anchor]')
      nodes.forEach((n) => io.observe(n))
      if (nodes.length) {
        let best: string | null = null
        let bestTop = Infinity
        const rootTop = root.getBoundingClientRect().top
        nodes.forEach((n) => {
          const key = n.dataset.readAnchor
          if (!key) return
          const top = n.getBoundingClientRect().top - rootTop
          if (top >= -8 && top < bestTop) {
            bestTop = top
            best = key
          }
        })
        setActiveKey(best || sorted[0]?.key || null)
      }
    }

    observeAll()

    // 流式插入新锚点时重新绑定
    const mo = new MutationObserver(() => observeAll())
    mo.observe(root, { childList: true, subtree: true })

    return () => {
      io.disconnect()
      mo.disconnect()
    }
  }, [enabled, hasAnchors, sorted, rootRef])

  if (!enabled) return null
  if (!hasAnchors && !hasLedger) return null

  const active = (activeKey && byKey.get(activeKey)) || sorted[0] || null
  // 展示优先级：账本 chapter > 当前 DOM 锚点 > 账本 location
  const displayTitle = (ledgerChapter || '').trim() || active?.title || (ledgerLocation || '').trim()
  if (!displayTitle) return null

  const fromLedgerOnly = !active || Boolean((ledgerChapter || '').trim())
  const kindLabel = fromLedgerOnly
    ? i18n.language?.startsWith('zh')
      ? '章节'
      : 'Chapter'
    : active.kind === 'scene'
      ? i18n.language?.startsWith('zh')
        ? '场景'
        : 'Scene'
      : i18n.language?.startsWith('zh')
        ? '章节'
        : 'Chapter'

  const idx = active ? Math.max(0, sorted.findIndex((a) => a.key === active.key)) + 1 : 0

  return (
    <div
      className={`sticky-chapter-bar${hasAnchors ? '' : ' is-ledger'}`}
      role="status"
      aria-live="polite"
      aria-label={t('settings.readStickyChapter')}
    >
      <span className="sticky-chapter-kind">{kindLabel}</span>
      <span className="sticky-chapter-title" title={displayTitle}>
        {displayTitle}
      </span>
      {hasAnchors && sorted.length > 1 && idx > 0 ? (
        <span className="sticky-chapter-meta">
          {idx}/{sorted.length}
        </span>
      ) : null}
    </div>
  )
}
