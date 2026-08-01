import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Puzzle, Upload, Download, RefreshCw, X, Circle } from 'lucide-react'
import { ExtensionFrame } from '../components/ExtensionFrame'
import { ErrorBoundary } from '../components/ErrorBoundary'
import './Extensions.css'

type InstalledExtension = { id: string; displayName: string; version: string; root: string; js: string | null; css: string | null; capabilities: string[]; runtimeStatus: string; archiveSha256: string }

export function ExtensionsPage() {
  const { t } = useTranslation()
  const [extensions, setExtensions] = useState<InstalledExtension[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const extKey = (ext: InstalledExtension, index: number): string => `${ext.id}-${ext.archiveSha256 ?? 'n'}-${index}`

  const refresh = useCallback(async () => {
    const response = await fetch('/api/extensions', { credentials: 'include' })
    const data = await response.json() as { extensions?: InstalledExtension[]; error?: string }
    if (!response.ok) throw new Error(data.error || t('extensions.listLoadError'))
    setExtensions(data.extensions ?? [])
  }, [t])

  useEffect(() => { refresh().catch((e) => setError(e instanceof Error ? e.message : String(e))) }, [refresh])

  const selected = selectedKey ? extensions.find((e, i) => extKey(e, i) === selectedKey) ?? null : null

  const install = async (file: File) => {
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/extensions/install', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/zip' }, body: file })
      const data = await response.json() as { extension?: InstalledExtension; error?: string }
      if (!response.ok || !data.extension) throw new Error(data.error || t('extensions.installFail'))
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const installUrl = async () => {
    if (!url.trim()) return
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/extensions/install-url', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) })
      const data = await response.json() as { extension?: InstalledExtension; error?: string }
      if (!response.ok || !data.extension) throw new Error(data.error || t('extensions.installFail'))
      await refresh(); setUrl('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <section className="dd-extensions-page">
      <header className="dd-page-header">
        <div><p className="dd-eyebrow">RUNTIME</p><h1>{t('extensions.title')}</h1><p>{t('extensions.subtitle')}</p></div>
        <div className="dd-extension-actions">
          <button className="dd-button" onClick={() => refresh().catch((e) => setError(e.message))}><RefreshCw size={16} />{t('extensions.refresh')}</button>
          <button className="dd-button dd-button-primary" disabled={busy} onClick={() => input.current?.click()}><Upload size={16} />{t('extensions.uploadZip')}</button>
          <input ref={input} hidden type="file" accept=".zip,application/zip" onChange={(e) => { const file = e.target.files?.[0]; if (file) void install(file); e.currentTarget.value = '' }} />
        </div>
      </header>
      <div className="dd-extension-url-bar">
        <input className="dd-input" placeholder={t('extensions.urlPlaceholder')} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && void installUrl()} />
        <button className="dd-button dd-button-primary" disabled={busy || !url.trim()} onClick={() => void installUrl()}><Download size={16} />{t('extensions.install')}</button>
      </div>
      {error && <div className="dd-extension-error">{error}</div>}
      <div className="dd-extension-layout">
        <div className="dd-extension-list">
          {extensions.length === 0 && <div className="dd-extension-empty"><Puzzle size={28} /><p>{t('extensions.emptyTitle')}</p><span>{t('extensions.emptyHint')}</span></div>}
          {extensions.map((extension, index) => {
            const key = extKey(extension, index)
            return (
              <div
                key={key}
                className={`dd-extension-card ${selectedKey === key ? 'is-selected' : ''}`}
                onClick={() => setSelectedKey(key)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedKey(key) } }}
              >
                <span><strong>{extension.displayName}</strong><small>{extension.id} · v{extension.version}</small></span>
                <span className="dd-extension-status">{extension.runtimeStatus === 'runnable' ? t('extensions.runnable') : extension.runtimeStatus === 'requires-adapter' ? t('extensions.needsAdapter') : extension.runtimeStatus}</span>
              </div>
            )
          })}
        </div>
        <div className="dd-extension-stage">
          {selected ? (
            <>
              <div className="dd-extension-stage-head">
                <div>
                  <div className="dd-extension-stage-title">
                    <Circle size={8} className="dd-running-dot" />
                    <strong>{selected.displayName}</strong>
                  </div>
                  <span>{selected.id} · {t('extensions.running')}</span>
                </div>
                <button className="dd-icon-button dd-close-button" title={t('extensions.close')} onClick={() => setSelectedKey(null)}><X size={18} /></button>
              </div>
              <ErrorBoundary
                fallback={(error, reset) => (
                  <div style={{ padding: 24, color: '#a33', fontSize: 14, lineHeight: 1.6 }}>
                    <strong>Extension crashed</strong>
                    <p style={{ marginTop: 8, wordBreak: 'break-all' }}>{error.message}</p>
                    <button className="dd-button" style={{ marginTop: 8 }} onClick={reset}>Retry</button>
                  </div>
                )}
              >
                <ExtensionFrame extension={selected} />
              </ErrorBoundary>
            </>
          ) : (
            <div className="dd-extension-empty"><Puzzle size={34} /><p>{t('extensions.selectTitle')}</p><span>{t('extensions.selectHint')}</span></div>
          )}
        </div>
      </div>
    </section>
  )
}