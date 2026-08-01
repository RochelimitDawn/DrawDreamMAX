import { useEffect, useRef, useState } from 'react'
import { Puzzle, Upload, Download, RefreshCw, Square } from 'lucide-react'
import { ExtensionFrame } from '../components/ExtensionFrame'
import './Extensions.css'

type InstalledExtension = { id: string; displayName: string; version: string; root: string; js: string | null; css: string | null; capabilities: string[]; runtimeStatus: string; archiveSha256: string }

export function ExtensionsPage() {
  const [extensions, setExtensions] = useState<InstalledExtension[]>([])
  const [selected, setSelected] = useState<InstalledExtension | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    const response = await fetch('/api/extensions', { credentials: 'include' })
    const data = await response.json() as { extensions?: InstalledExtension[]; error?: string }
    if (!response.ok) throw new Error(data.error || '扩展列表加载失败')
    setExtensions(data.extensions ?? [])
  }

  useEffect(() => { refresh().catch((e) => setError(e instanceof Error ? e.message : String(e))) }, [])

  const install = async (file: File) => {
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/extensions/install', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/zip' }, body: file })
      const data = await response.json() as { extension?: InstalledExtension; error?: string }
      if (!response.ok || !data.extension) throw new Error(data.error || '扩展安装失败')
      await refresh(); setSelected(data.extension)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const installUrl = async () => {
    if (!url.trim()) return
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/extensions/install-url', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) })
      const data = await response.json() as { extension?: InstalledExtension; error?: string }
      if (!response.ok || !data.extension) throw new Error(data.error || '扩展安装失败')
      await refresh(); setSelected(data.extension); setUrl('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <section className="dd-extensions-page">
      <header className="dd-page-header">
        <div><p className="dd-eyebrow">RUNTIME</p><h1>扩展运行时</h1><p>安装并在受控 iframe 中运行兼容扩展。</p></div>
        <div className="dd-extension-actions">
          <button className="dd-button" onClick={() => refresh().catch((e) => setError(e.message))}><RefreshCw size={16} />刷新</button>
          <button className="dd-button dd-button-primary" disabled={busy} onClick={() => input.current?.click()}><Upload size={16} />上传 ZIP</button>
          <input ref={input} hidden type="file" accept=".zip,application/zip" onChange={(e) => { const file = e.target.files?.[0]; if (file) void install(file); e.currentTarget.value = '' }} />
        </div>
      </header>
      <div className="dd-extension-url-bar">
        <input className="dd-input" placeholder="GitHub/GitLab 仓库 URL 或直接 ZIP 链接" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && void installUrl()} />
        <button className="dd-button dd-button-primary" disabled={busy || !url.trim()} onClick={() => void installUrl()}><Download size={16} />安装</button>
      </div>
      {error && <div className="dd-extension-error">{error}</div>}
      <div className="dd-extension-layout">
        <div className="dd-extension-list">
          {extensions.length === 0 && <div className="dd-extension-empty"><Puzzle size={28} /><p>暂无已安装扩展</p><span>上传 ZIP 或输入扩展仓库 URL 开始安装。</span></div>}
          {extensions.map((extension) => <button key={extension.id} className={`dd-extension-card ${selected?.id === extension.id ? 'is-selected' : ''}`} onClick={() => setSelected(extension)}><span><strong>{extension.displayName}</strong><small>{extension.id} · v{extension.version}</small></span><span className="dd-extension-status">{extension.runtimeStatus === 'runnable' ? '可运行' : extension.runtimeStatus === 'requires-adapter' ? '需要适配' : extension.runtimeStatus}</span></button>)}
        </div>
        <div className="dd-extension-stage">
          {selected ? <><div className="dd-extension-stage-head"><div><strong>{selected.displayName}</strong><span>{selected.id}</span></div><button className="dd-icon-button" title="停止扩展" onClick={() => setSelected(null)}><Square size={16} /></button></div><ExtensionFrame extension={selected} onError={setError} /></> : <div className="dd-extension-empty"><Puzzle size={34} /><p>选择一个扩展</p><span>扩展脚本将在隔离 iframe 中加载。</span></div>}
        </div>
      </div>
    </section>
  )
}