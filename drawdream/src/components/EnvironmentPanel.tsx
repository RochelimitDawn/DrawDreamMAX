import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Cpu, Database, HardDrive, RefreshCw, Terminal, X } from 'lucide-react'
import { fetchEnvironment, type EnvironmentInfo } from '../agent/rest'
import './EnvironmentPanel.css'

function formatBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  const v = n / 1024 ** i
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function ToolRow({
  name,
  probe,
}: {
  name: string
  probe?: { ok: boolean; version?: string }
}) {
  const { t } = useTranslation()
  return (
    <div className="env-row">
      <span className="env-row-label">{name}</span>
      {probe ? (
        <>
          <span className={`env-badge ${probe.ok ? 'is-ok' : 'is-missing'}`}>
            {probe.ok ? <Check size={12} strokeWidth={2.4} /> : <X size={12} strokeWidth={2.4} />}
            {probe.ok ? t('settings.envReady') : t('settings.envMissing')}
          </span>
          {probe.version ? <span className="env-version">{probe.version}</span> : null}
        </>
      ) : (
        <span className="env-badge is-loading">{t('settings.envProbing')}</span>
      )}
    </div>
  )
}

export function EnvironmentPanel() {
  const { t } = useTranslation()
  const [info, setInfo] = useState<EnvironmentInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setInfo(await fetchEnvironment())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const diskRows: Array<{ key: string; label: string }> = [
    { key: 'workspace', label: t('settings.envDiskWorkspace') },
    { key: 'palace', label: t('settings.envDiskPalace') },
    { key: 'summaries', label: t('settings.envDiskSummaries') },
    { key: 'state', label: t('settings.envDiskState') },
    { key: 'lore', label: t('settings.envDiskLore') },
    { key: 'cards', label: t('settings.envDiskCards') },
  ]

  return (
    <div className="env-block">
      <div className="env-toolbar">
        <span className="env-toolbar-title">{t('settings.envTitle')}</span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void load()}
          disabled={loading}
          aria-label={t('settings.envRefresh')}
          title={t('settings.envRefresh')}
        >
          <RefreshCw size={16} className={loading ? 'is-spin' : ''} />
        </button>
      </div>

      {error ? <div className="env-error">{t('settings.envLoadFailed')}：{error}</div> : null}

      {loading && !info ? <div className="env-empty">{t('settings.envLoading')}</div> : null}

      {info ? (
        <div className="env-grid">
          <section className="env-card">
            <h4>
              <Cpu size={14} /> {t('settings.envRuntime')}
            </h4>
            <div className="env-row">
              <span className="env-row-label">{t('settings.envRuntimeName')}</span>
              <span className="env-version">
                {info.runtime.name}
                {info.runtime.version ? ` · ${info.runtime.version}` : ''}
              </span>
            </div>
            <div className="env-row">
              <span className="env-row-label">{t('settings.envPlatform')}</span>
              <span className="env-version">{info.runtime.platform}/{info.runtime.arch}</span>
            </div>
            <div className="env-row">
              <span className="env-row-label">{t('settings.envPid')}</span>
              <span className="env-version">{info.runtime.pid}</span>
            </div>
            <div className="env-row">
              <span className="env-row-label">{t('settings.envUptime')}</span>
              <span className="env-version">{fmtUptime(info.runtime.uptimeMs)}</span>
            </div>
          </section>

          <section className="env-card">
            <h4>
              <Terminal size={14} /> {t('settings.envService')}
            </h4>
            <div className="env-row">
              <span className="env-row-label">{t('settings.envPort')}</span>
              <span className="env-version">{info.service.port}</span>
            </div>
            <div className="env-row">
              <span className="env-row-label">{t('settings.envWorkspace')}</span>
              <span className="env-path" title={info.service.cwd}>
                {info.service.cwd}
              </span>
            </div>
            <div className="env-row">
              <span className="env-row-label">{t('settings.envAgentDir')}</span>
              <span className="env-path" title={info.service.agentDir}>
                {info.service.agentDir}
              </span>
            </div>
          </section>

          <section className="env-card">
            <h4>
              <HardDrive size={14} /> {t('settings.envDisk')}
            </h4>
            {diskRows.map((r) => (
              <div className="env-row" key={r.key}>
                <span className="env-row-label">{r.label}</span>
                <span className="env-version">{formatBytes(info.disk[r.key] ?? 0)}</span>
              </div>
            ))}
          </section>

          <section className="env-card">
            <h4>
              <Database size={14} /> {t('settings.envToolchain')}
            </h4>
            <ToolRow name="node" probe={info.toolchain.node} />
            <ToolRow name="bun" probe={info.toolchain.bun} />
            <ToolRow name="ffmpeg" probe={info.toolchain.ffmpeg} />
            <ToolRow name="python3" probe={info.toolchain.python} />
            <p className="env-toolchain-hint">{t('settings.envToolchainHint')}</p>
          </section>
        </div>
      ) : null}
    </div>
  )
}
