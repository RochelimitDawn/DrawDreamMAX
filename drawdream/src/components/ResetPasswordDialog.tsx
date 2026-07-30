import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { SlideCaptcha } from './SlideCaptcha'
import './ConfirmDialog.css'
import './ResetPasswordDialog.css'

export type ResetPasswordDialogProps = {
  open: boolean
  username: string
  busy?: boolean
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  passwordLabel?: string
  passwordAgainLabel?: string
  captchaLabel?: string
  captchaHint?: string
  captchaOk?: string
  captchaBeat?: string
  mismatchError?: string
  weakError?: string
  captchaRequired?: string
  onConfirm: (password: string) => void
  onCancel: () => void
}

export function ResetPasswordDialog({
  open,
  username,
  busy = false,
  title = '重置密码',
  confirmLabel = '确认重置',
  cancelLabel = '取消',
  passwordLabel = '新密码',
  passwordAgainLabel = '确认新密码',
  captchaLabel = '滑动验证',
  captchaHint = '按住滑块拖到最右侧',
  captchaOk = '验证通过',
  captchaBeat = '击败了 {n}% 的用户',
  mismatchError = '两次密码不一致',
  weakError = '密码至少 6 位',
  captchaRequired = '请先完成滑动验证',
  onConfirm,
  onCancel,
}: ResetPasswordDialogProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [captchaOkState, setCaptchaOkState] = useState(false)
  const [captchaKey, setCaptchaKey] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setPassword('')
    setPassword2('')
    setCaptchaOkState(false)
    setCaptchaKey((k) => k + 1)
    setError('')
    panelRef.current?.focus({ preventScroll: true })
  }, [open, username])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null

  const submit = () => {
    setError('')
    if (password.length < 6) {
      setError(weakError)
      return
    }
    if (password !== password2) {
      setError(mismatchError)
      return
    }
    if (!captchaOkState) {
      setError(captchaRequired)
      return
    }
    onConfirm(password)
  }

  return createPortal(
    <div className="dd-confirm-root" role="presentation">
      <button
        type="button"
        className="dd-confirm-mask"
        aria-label={cancelLabel}
        onClick={() => !busy && onCancel()}
      />
      <div
        ref={panelRef}
        className="dd-confirm-panel dd-reset-pw-panel"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
      >
        <div className="dd-confirm-head">
          <h3 id={titleId}>{title}</h3>
          <button
            type="button"
            className="dd-confirm-close"
            onClick={() => !busy && onCancel()}
            aria-label={cancelLabel}
          >
            <X size={16} />
          </button>
        </div>

        <p className="dd-reset-pw-target">
          <span className="dd-reset-pw-user">{username}</span>
        </p>

        <div className="dd-reset-pw-fields">
          <label className="dd-reset-pw-field">
            <span>{passwordLabel}</span>
            <input
              type="password"
              className="settings-input"
              autoComplete="new-password"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
            />
          </label>
          <label className="dd-reset-pw-field">
            <span>{passwordAgainLabel}</span>
            <input
              type="password"
              className="settings-input"
              autoComplete="new-password"
              value={password2}
              disabled={busy}
              onChange={(e) => setPassword2(e.target.value)}
              minLength={6}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
          </label>

          <SlideCaptcha
            resetKey={captchaKey}
            disabled={busy}
            label={captchaLabel}
            hint={captchaHint}
            successLabel={captchaOk}
            beatTemplate={captchaBeat}
            onChange={setCaptchaOkState}
          />

          {error ? <div className="dd-reset-pw-error">{error}</div> : <div className="dd-reset-pw-error" />}
        </div>

        <div className="dd-confirm-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !captchaOkState || password.length < 6}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
