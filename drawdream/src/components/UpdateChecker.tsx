import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from './ConfirmDialog'
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
    setInfo(null)
  }

  return (
    <ConfirmDialog
      open={Boolean(info)}
      title={t('settings.updateAvailable', { version: info?.tagName || '' })}
      description={
        <div className="update-dialog-body">
          <div className="update-dialog-notes">
            {info?.notes ? (
              <span className="update-notes-pre">{info.notes}</span>
            ) : (
              <span className="update-dialog-hint">{t('settings.updateNoNotes')}</span>
            )}
          </div>
          <p className="update-dialog-hint">{t('settings.updateHint')}</p>
        </div>
      }
      confirmLabel={t('settings.updateDownload')}
      cancelLabel={t('common.cancel')}
      onCancel={() => setInfo(null)}
      onConfirm={confirmUpdate}
    />
  )
}
