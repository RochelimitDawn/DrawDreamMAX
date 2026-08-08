import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, ChevronDown, ChevronRight, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  fetchMcpServers,
  mcpAddServer,
  mcpDeleteServer,
  mcpSetEnabled,
  mcpSync,
  mcpUpdateServer,
  type McpConfigEntry,
  type McpServerItem,
  type McpTransport,
} from '../agent/rest'
import { ConfirmDialog } from './ConfirmDialog'
import { Select } from './Select'
import './McpPanel.css'

const TRANSPORTS: McpTransport[] = ['stdio', 'http', 'sse']

/** 工具名统一化：mcp__{id}__{tool} → 取 tool 部分显示 */
function shortToolName(qualifiedName: string): string {
  if (!qualifiedName.startsWith('mcp__')) return qualifiedName
  const rest = qualifiedName.slice('mcp__'.length)
  const parts = rest.split('__')
  return parts.length > 1 ? parts.slice(1).join('__') : rest
}

export function McpPanel() {
  const { t } = useTranslation()
  const [servers, setServers] = useState<McpServerItem[]>([])
  const [config, setConfig] = useState<McpConfigEntry[]>([])
  const [sessionEnabled, setSessionEnabled] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<McpConfigEntry | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<McpConfigEntry>({
    id: '',
    name: '',
    enabled: false,
    transport: 'stdio',
  })
  const [deleting, setDeleting] = useState<McpConfigEntry | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const r = await fetchMcpServers()
      setServers(r.servers)
      setConfig(r.config)
      setSessionEnabled(r.sessionEnabled)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const effectiveEnabled = (id: string): boolean =>
    sessionEnabled.includes(id) || servers.find((s) => s.id === id)?.enabled === true

  const handleSync = async () => {
    setBusy(true)
    try {
      await mcpSync()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleToggle = async (s: McpServerItem) => {
    const next = !effectiveEnabled(s.id)
    try {
      await mcpSetEnabled(s.id, next)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const openAdd = () => {
    setEditing(null)
    setForm({ id: '', name: '', enabled: false, transport: 'stdio' })
    setAdding(true)
  }

  const openEdit = (c: McpConfigEntry) => {
    setAdding(false)
    setEditing(c)
    setForm({ ...c, args: c.args ?? [], env: c.env ?? {}, headers: c.headers ?? {} })
  }

  const submit = async () => {
    setBusy(true)
    try {
      if (adding) {
        await mcpAddServer(form)
      } else if (editing) {
        await mcpUpdateServer(form)
      }
      setAdding(false)
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await mcpDeleteServer(deleting.id)
      setDeleting(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const enabledCount = servers.filter((s) => effectiveEnabled(s.id)).length
  const toolCount = servers.reduce((n, s) => n + (s.tools?.length ?? 0), 0)

  const formValid = useMemo(
    () => form.name.trim() !== '' && (form.command?.trim() || form.url?.trim()),
    [form.name, form.command, form.url],
  )

  return (
    <div className="mcp-block">
      <div className="mcp-toolbar">
        <span className="mcp-toolbar-title">
          <Boxes size={14} aria-hidden />
          {t('settings.mcpTitle')}
        </span>
        <span className="mcp-toolbar-meta">
          {t('settings.mcpCount', { n: servers.length, on: enabledCount, tools: toolCount })}
        </span>
        <button type="button" className="icon-btn" onClick={() => void handleSync()} disabled={busy} aria-label={t('settings.envRefresh')} title={t('settings.envRefresh')}>
          <RefreshCw size={16} className={busy ? 'is-spin' : ''} />
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={openAdd}>
          <Plus size={14} aria-hidden />
          {t('settings.mcpAdd')}
        </button>
      </div>

      {error ? <div className="env-error">{error}</div> : null}
      {loading && servers.length === 0 ? <div className="env-empty">{t('settings.envLoading')}</div> : null}

      {!loading && servers.length === 0 && !error ? (
        <div className="mcp-empty">
          <p>{t('settings.mcpEmpty')}</p>
          <p className="mcp-empty-hint">{t('settings.mcpEmptyHint')}</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
            <Plus size={14} aria-hidden />
            {t('settings.mcpAdd')}
          </button>
        </div>
      ) : null}

      {servers.length > 0 ? (
        <div className="mcp-list">
          {servers.map((s) => {
            const on = effectiveEnabled(s.id)
            const open = expanded === s.id
            const cfg = config.find((c) => c.id === s.id)
            return (
              <div className={`mcp-server${on ? ' is-on' : ''}`} key={s.id}>
                <div className="mcp-server-head">
                  <button
                    type="button"
                    className="mcp-server-main"
                    onClick={() => setExpanded(open ? null : s.id)}
                    aria-expanded={open}
                  >
                    {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                    <span className="mcp-server-name">{s.name}</span>
                    <span className={`mcp-dot is-${s.status}`} aria-hidden />
                    <span className="mcp-server-summary">{s.summary || s.id}</span>
                  </button>
                  <div className="mcp-server-actions">
                    <span className={`mcp-badge ${on ? 'is-on' : ''}`}>
                      {on ? t('settings.envOn') : t('settings.envOff')}
                    </span>
                    <button
                      type="button"
                      className={`switch mcp-toggle${on ? ' is-on' : ''}`}
                      role="switch"
                      aria-checked={on}
                      aria-label={s.name}
                      onClick={() => void handleToggle(s)}
                    >
                      <span className="switch-knob" />
                    </button>
                    {cfg ? (
                      <>
                        <button type="button" className="mcp-edit-btn" title={t('common.edit') ?? '编辑'} onClick={() => openEdit(cfg)}>
                          {t('common.edit') ?? '编辑'}
                        </button>
                        <button type="button" className="icon-btn" title={t('common.delete')} onClick={() => setDeleting(cfg)}>
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                {open ? (
                  <div className="mcp-server-body">
                    <div className="mcp-meta">
                      <span>{t('settings.mcpTransport')}: {s.transport}</span>
                      {s.source ? <span>· {t('settings.mcpSource')}: {s.source}</span> : null}
                    </div>
                    <div className="mcp-tools">
                      <div className="mcp-tools-title">{t('settings.mcpToolsTitle')}（{s.tools?.length ?? 0}）</div>
                      {(s.tools ?? []).map((tl) => (
                        <div className="mcp-tool" key={tl.qualifiedName}>
                          <span className="mcp-tool-name">{shortToolName(tl.qualifiedName)}</span>
                          {tl.description ? <span className="mcp-tool-desc">{tl.description}</span> : null}
                        </div>
                      ))}
                      {(s.tools ?? []).length === 0 ? <div className="mcp-tool-empty">{t('settings.mcpNoTools')}</div> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {adding || editing ? (
        <div className="mcp-form surface-inset">
          <h4>{adding ? t('settings.mcpAddTitle') : t('settings.mcpEditTitle')}</h4>
          <div className="grid-2">
            <div>
              <label className="field-label">{t('settings.mcpName')}</label>
              <input
                className="field-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="my-server"
              />
            </div>
            <div>
              <label className="field-label">{t('settings.mcpTransport')}</label>
              <Select
                fullWidth
                value={form.transport}
                onChange={(v) => setForm({ ...form, transport: v as McpTransport })}
                options={TRANSPORTS.map((tr) => ({ value: tr, label: tr }))}
              />
            </div>
          </div>
          {form.transport === 'stdio' ? (
            <>
              <div className="grid-2">
                <div>
                  <label className="field-label">{t('settings.mcpCommand')}</label>
                  <input
                    className="field-input"
                    value={form.command ?? ''}
                    onChange={(e) => setForm({ ...form, command: e.target.value })}
                    placeholder="npx @modelcontextprotocol/server-xxx"
                  />
                </div>
                <div>
                  <label className="field-label">{t('settings.mcpArgs')}</label>
                  <input
                    className="field-input"
                    value={(form.args ?? []).join(' ')}
                    onChange={(e) => setForm({ ...form, args: e.target.value.split(/\s+/).filter(Boolean) })}
                    placeholder="--port 3000"
                  />
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className="field-label">{t('settings.mcpUrl')}</label>
              <input
                className="field-input"
                type="url"
                value={form.url ?? ''}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="http://localhost:3000/mcp"
              />
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !formValid}>
              {t('common.save')}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setAdding(false)
                setEditing(null)
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        danger
        busy={busy}
        title={t('common.delete')}
        description={deleting ? t('settings.mcpDeleteConfirm', { name: deleting.name }) : undefined}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void confirmDelete()}
        onCancel={() => !busy && setDeleting(null)}
      />
    </div>
  )
}
