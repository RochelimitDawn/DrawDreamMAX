import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import './ConfirmDialog.css'

export type ConfirmDialogProps = {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  panelClassName?: string
  /** 点击遮罩是否关闭（默认 true） */
  closeOnMask?: boolean
  /** Escape 是否关闭（默认 true） */
  closeOnEscape?: boolean
  /** 是否隐藏左下角取消按钮（默认 false，仅保留右上角关闭） */
  hideCancel?: boolean
  /** busy 时右上角关闭按钮是否仍可点击（默认 false，用于下载中允许取消） */
  closeWhileBusy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  busy = false,
  panelClassName,
  closeOnMask = true,
  closeOnEscape = true,
  hideCancel = false,
  closeWhileBusy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && closeOnEscape) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open, busy, closeOnEscape, onCancel])

  useEffect(() => {
    if (open) return
    // 关闭时清除残留焦点，避免历史列表按钮出现 focus 高亮环
    const active = document.activeElement as HTMLElement | null
    active?.blur()
  }, [open])

  if (!open) return null

  // 挂到 body，避免被侧栏/主栏 stacking context 裁切，遮罩统一盖住整页
  return createPortal(
    <div className="dd-confirm-root" role="presentation">
      <button
        type="button"
        className="dd-confirm-mask"
        aria-label={cancelLabel}
        onClick={() => !busy && closeOnMask && onCancel()}
      />
      <div
        ref={panelRef}
        className={`dd-confirm-panel ${danger ? 'is-danger' : ''}${panelClassName ? ` ${panelClassName}` : ''}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
      >
        <div className="dd-confirm-head">
          <h3 id={titleId}>{title}</h3>
          <button
            type="button"
            className="dd-confirm-close"
            onClick={() => (!busy || closeWhileBusy) && onCancel()}
            aria-label={cancelLabel}
          >
            <X size={16} />
          </button>
        </div>
        {description ? (
          <div id={descId} className="dd-confirm-body">
            {description}
          </div>
        ) : null}
        <div className="dd-confirm-actions">
          {!hideCancel ? (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
              {cancelLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
