import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Download, QrCode, X } from 'lucide-react'
import { copyText } from '../utils/clipboard'
import { downloadDataUrl, fetchQrcodeDataUrl, qrcodeImageUrl } from '../utils/qrcode'
import { toast } from '../utils/toast'
import './ShareSheet.css'

export type ShareSheetProps = {
  open: boolean
  url: string
  title?: string
  /** 与设置里 smartSearch.baseUrl 对齐时可传入 */
  apiBase?: string
  onClose: () => void
}

export function ShareSheet({ open, url, title, apiBase, onClose }: ShareSheetProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [dataUrl, setDataUrl] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  const imgFallback = url
    ? qrcodeImageUrl({ text: url, size: 512, baseUrl: apiBase })
    : ''

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !url) {
      setDataUrl('')
      setErr('')
      setLoading(false)
      return
    }
    const ac = new AbortController()
    setLoading(true)
    setErr('')
    setDataUrl('')
    void fetchQrcodeDataUrl({ text: url, size: 512, baseUrl: apiBase }, ac.signal)
      .then((d) => {
        if (!ac.signal.aborted) setDataUrl(d)
      })
      .catch((e) => {
        if (!ac.signal.aborted) setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [open, url, apiBase])

  if (!open) return null

  const copyLink = async () => {
    try {
      await copyText(url)
      setCopied(true)
      toast(t('common.copied'), 'success')
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast(t('share.copyFailed'), 'error')
    }
  }

  const saveQr = () => {
    const src = dataUrl || imgFallback
    if (!src) return
    if (src.startsWith('data:')) {
      downloadDataUrl(src, 'share-qrcode.png')
      toast(t('common.saved'), 'success')
      return
    }
    // 跨域 img URL：开新页或用 a 下载可能受限，仍尝试
    const a = document.createElement('a')
    a.href = src
    a.download = 'share-qrcode.png'
    a.target = '_blank'
    a.rel = 'noopener'
    a.click()
  }

  return createPortal(
    <div className="dd-share-root" role="presentation">
      <button type="button" className="dd-share-mask" aria-label={t('common.close')} onClick={onClose} />
      <div
        ref={panelRef}
        className="dd-share-panel"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
      >
        <div className="dd-share-head">
          <h3 id={titleId}>
            <QrCode size={18} aria-hidden />
            {title || t('common.share')}
          </h3>
          <button type="button" className="dd-share-close" onClick={onClose} aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </div>

        <div className="dd-share-qr">
          {loading && !dataUrl ? (
            <div className="dd-share-qr-ph">{t('common.loading')}</div>
          ) : (
            <img
              className="dd-share-qr-img"
              src={dataUrl || imgFallback}
              alt={t('share.qrAlt')}
              width={220}
              height={220}
              onError={() => {
                if (!err) setErr(t('share.qrFailed'))
              }}
            />
          )}
          {err ? <p className="dd-share-err">{err}</p> : null}
        </div>

        <p className="dd-share-hint">{t('share.scanHint')}</p>

        <div className="dd-share-url-row">
          <input className="field-input dd-share-url" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyLink()}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {t('common.copy')}
          </button>
        </div>

        <div className="dd-share-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="button" className="btn btn-primary" onClick={saveQr} disabled={!dataUrl && !imgFallback}>
            <Download size={16} />
            {t('share.saveQr')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
