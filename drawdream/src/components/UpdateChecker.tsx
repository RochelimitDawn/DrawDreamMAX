import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { ConfirmDialog } from './ConfirmDialog'
import { RichMessage } from './RichMessage'
import { toast } from '../utils/toast'
import './UpdateChecker.css'

interface UpdatePayload {
  hasUpdate: boolean
  tagName: string
  notes?: string
  downloadUrl?: string
  sumsUrl?: string
}

interface UpdateInfo {
  tagName: string
  notes: string
  downloadUrl: string
  sumsUrl: string
}

type UpdateGlobal = Record<string, unknown>

/**
 * 全局自动更新检查器：
 * - 注册 Kotlin 桥回调 window.__ddUpdateResult（启动自动检查 / 设置页手动检查共用）
 * - 检测到新版本 → 弹确认对话框（版本 + Release notes + 下载并安装）
 * - 已最新 / 环境不支持 → Toast 提示
 * 设置页通过 window.__ddCheckUpdate(listener) 触发并同步「检查中」状态。
 */
export function UpdateChecker() {
  const { t } = useTranslation()
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  /** 下载中：进度 0-100 */
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const win = window as unknown as UpdateGlobal
    const setChecked = (v: boolean) => {
      const cb = win.__ddUpdateChecking as ((c: boolean) => void) | undefined
      cb?.(v)
    }
    win.__ddUpdateResult = (payload: UpdatePayload) => {
      setChecked(false)
      if (payload && payload.hasUpdate && payload.downloadUrl) {
        setInfo({
          tagName: payload.tagName,
          notes: payload.notes || '',
          downloadUrl: payload.downloadUrl,
          sumsUrl: payload.sumsUrl || '',
        })
      } else {
        toast(t('settings.updateLatest'), 'success')
      }
    }
    win.__ddUpdateProgress = (pct: number) => {
      const p = Math.max(0, Math.min(100, Math.round(pct)))
      setProgress(p)
    }
    win.__ddUpdateDownloadDone = (ok: boolean, message?: string) => {
      setDownloading(false)
      setInfo(null)
      setProgress(0)
      if (ok) toast(t('settings.updateReady'), 'success')
      else toast(message || t('settings.updateFail'), 'error')
    }
    win.__ddCheckUpdate = (listener?: (checking: boolean) => void) => {
      win.__ddUpdateChecking = listener
      const bridge = (win as { DrawDreamAndroid?: { checkUpdate?: () => void } }).DrawDreamAndroid
      if (!bridge?.checkUpdate) {
        setChecked(false)
        toast(t('settings.updateUnsupported'), 'info')
        return
      }
      setChecked(true)
      bridge.checkUpdate()
    }
    return () => {
      delete win.__ddUpdateResult
      delete win.__ddUpdateProgress
      delete win.__ddUpdateDownloadDone
      delete win.__ddCheckUpdate
      delete win.__ddUpdateChecking
    }
  }, [t])

  const confirmUpdate = () => {
    if (!info?.downloadUrl) return
    const bridge = (window as unknown as {
      DrawDreamAndroid?: { downloadUpdate?: (tag: string, url: string, sums: string) => void }
    }).DrawDreamAndroid
    bridge?.downloadUpdate?.(info.tagName, info.downloadUrl, info.sumsUrl)
    setDownloading(true)
    setProgress(0)
  }

  /** 取消下载并关闭弹窗：通知 Kotlin 中止，避免后台继续拉取 */
  const cancelUpdate = () => {
    if (downloading) {
      ;(window as unknown as {
        DrawDreamAndroid?: { cancelUpdate?: () => void }
      }).DrawDreamAndroid?.cancelUpdate?.()
    }
    setDownloading(false)
    setInfo(null)
    setProgress(0)
  }

  return (
    <ConfirmDialog
      open={Boolean(info)}
      busy={downloading}
      panelClassName="update-dialog"
      closeOnMask={false}
      closeOnEscape={false}
      hideCancel
      closeWhileBusy
      title={downloading ? t('settings.updateDownloadingTitle') : t('settings.updateAvailable')}
      description={
        <div className="update-dialog-body">
          <div className="update-dialog-version">
            <span className="update-dialog-version-badge" aria-hidden>
              <Download size={16} strokeWidth={2} />
            </span>
            <span className="update-dialog-version-tag">{info?.tagName}</span>
            <span className="update-dialog-version-label">{t('settings.updateNewRelease')}</span>
          </div>
          {downloading ? (
            <div className="update-dialog-progress" role="progressbar" aria-valuenow={progress}>
              <div className="update-dialog-progress-track">
                <div className="update-dialog-progress-bar" style={{ width: `${progress}%` }} />
              </div>
              <span className="update-dialog-progress-text">
                {t('settings.updateDownloading', { pct: progress })}
              </span>
            </div>
          ) : (
            <>
              <div className="update-dialog-notes">
                {info?.notes ? (
                  <RichMessage text={info.notes} mdOnly className="update-notes-md" />
                ) : (
                  <span className="update-dialog-hint">{t('settings.updateNoNotes')}</span>
                )}
              </div>
              <p className="update-dialog-hint">{t('settings.updateHint')}</p>
            </>
          )}
        </div>
      }
      confirmLabel={t('settings.updateDownload')}
      cancelLabel={t('common.cancel')}
      onCancel={cancelUpdate}
      onConfirm={confirmUpdate}
    />
  )
}
