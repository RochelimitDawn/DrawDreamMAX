import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Boxes,
  Check,
  Cpu,
  Database,
  HardDrive,
  HeartPulse,
  RefreshCw,
  Terminal,
  Wrench,
  X,
} from 'lucide-react'
import { fetchEnvironment, type EnvironmentInfo } from '../agent/rest'
import { McpPanel } from './McpPanel'
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
      <span className={`env-dot ${probe?.ok ? 'is-ok' : probe ? 'is-missing' : 'is-loading'}`} aria-hidden />
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

  const tools = info
    ? [
        { name: 'node', probe: info.toolchain.node },
        { name: 'bun', probe: info.toolchain.bun },
        { name: 'ffmpeg', probe: info.toolchain.ffmpeg },
        { name: 'python3', probe: info.toolchain.python },
      ]
    : []
  const readyCount = tools.filter((x) => x.probe?.ok).length
  const totalDisk = info ? Object.values(info.disk).reduce((a, b) => a + (b ?? 0), 0) : 0
  const runtimeHealthy = info?.runtime && info.service ? true : false

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
        <>
          <div className="env-stats">
            <div className="env-stat">
              <span className="env-stat-icon is-brand" aria-hidden>
                <HeartPulse size={16} strokeWidth={2} />
              </span>
              <span className="env-stat-body">
                <span className="env-stat-value">{runtimeHealthy ? t('settings.envHealthy') : t('settings.envUnhealthy')}</span>
                <span className="env-stat-label">{t('settings.envRuntime')}</span>
              </span>
            </div>
            <div className="env-stat">
              <span className="env-stat-icon is-gold" aria-hidden>
                <Terminal size={16} strokeWidth={2} />
              </span>
              <span className="env-stat-body">
                <span className="env-stat-value">{info.service.port}</span>
                <span className="env-stat-label">{t('settings.envPort')}</span>
              </span>
            </div>
            <div className="env-stat">
              <span className="env-stat-icon is-gold" aria-hidden>
                <Wrench size={16} strokeWidth={2} />
              </span>
              <span className="env-stat-body">
                <span className="env-stat-value">
                  {readyCount}/{tools.length}
                </span>
                <span className="env-stat-label">{t('settings.envToolReady')}</span>
              </span>
            </div>
            <div className="env-stat">
              <span className="env-stat-icon is-brand" aria-hidden>
                <HardDrive size={16} strokeWidth={2} />
              </span>
              <span className="env-stat-body">
                <span className="env-stat-value">{formatBytes(totalDisk)}</span>
                <span className="env-stat-label">{t('settings.envDiskTotal')}</span>
              </span>
            </div>
          </div>

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
                <Activity size={14} /> {t('settings.envService')}
              </h4>
              <div className="env-row">
                <span className="env-row-label">{t('settings.envPort')}</span>
                <span className="env-version">{info.service.port}</span>
              </div>
              <div className="env-row">
                <span className="env-row-label">{t('settings.envStreaming')}</span>
                <span className={`env-badge ${info.service.streaming ? 'is-ok' : 'is-missing'}`}>
                  {info.service.streaming ? t('settings.envOn') : t('settings.envOff')}
                </span>
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
                <Database size={14} /> {t('settings.envDisk')}
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
                <Boxes size={14} /> {t('settings.envToolchain')}
              </h4>
              {tools.map((tool) => (
                <ToolRow key={tool.name} name={tool.name} probe={tool.probe} />
              ))}
              <p className="env-toolchain-hint">{t('settings.envToolchainHint')}</p>
            </section>
          </div>
        </>
      ) : null}

      <McpPanel />
    </div>
  )
}
