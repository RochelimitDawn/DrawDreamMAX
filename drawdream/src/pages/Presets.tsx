import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deletePreset,
  fetchActivePreset,
  fetchPresetBlock,
  fetchPresetFromUrl,
  fetchPresets,
  importPresetJson,
  patchPresetDraft,
  previewPresetJson,
  renamePreset,
  revertPresetDraft,
  savePresetAs,
  savePresetDraft,
  selectPreset,
  type ActivePresetView,
  type PresetBlockMeta,
  type PresetListItem,
  type PresetPreviewResult,
  type PresetReportItem,
} from '../agent/rest'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Toggle } from '../components/Toggle'
import { Reveal } from '../motion'
import { toast } from '../utils/toast'
import './Secondary.css'
import './Presets.css'

type ImportDraft = {
  fileName: string
  name: string
  json: Record<string, unknown>
  preview: PresetPreviewResult
  activate: boolean
}

function actionLabel(action: string, t: (k: string) => string): string {
  if (action === 'system') return t('secondary.presets.chSystem')
  if (action === 'postHistory') return t('secondary.presets.chPost')
  if (action.startsWith('marker')) return t('secondary.presets.actMarker')
  if (action.startsWith('禁用')) return t('secondary.presets.actDisabled')
  if (action === '缺失定义') return t('secondary.presets.actMissing')
  return action
}

function actionClass(action: string): string {
  if (action === 'system') return 'is-system'
  if (action === 'postHistory') return 'is-post'
  if (action.startsWith('marker')) return 'is-marker'
  if (action.startsWith('禁用')) return 'is-disabled'
  if (action === '缺失定义') return 'is-missing'
  return ''
}

export function PresetsPage() {
  const { t } = useTranslation()
  const [list, setList] = useState<PresetListItem[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [names, setNames] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null)
  const [importing, setImporting] = useState(false)
  const [urlPanelOpen, setUrlPanelOpen] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)

  const [detail, setDetail] = useState<ActivePresetView | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [blockContent, setBlockContent] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ file: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchPresets()
      setList(data.presets)
      setActive(data.active)
      setNames(Object.fromEntries(data.presets.map((p) => [p.file, p.name])))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDetail = useCallback(async () => {
    setDetailLoading(true)
    try {
      const d = await fetchActivePreset({ working: true })
      setDetail(d)
    } catch (e) {
      setDetail(null)
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (active) void loadDetail()
    else setDetail(null)
  }, [active, loadDetail])

  const create = async () => {
    const name = `preset-${Date.now().toString(36)}`
    try {
      await savePresetAs(name)
      toast(t('common.created'), 'success')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const saveName = async (file: string) => {
    const name = (names[file] ?? '').trim()
    if (!name) return
    try {
      await renamePreset(file, name)
      toast(t('common.saved'), 'success')
      await load()
      if (file === active) await loadDetail()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const apply = async (file: string | null) => {
    try {
      await selectPreset(file)
      setActive(file)
      toast(t('common.applied'), 'success')
      if (file) await loadDetail()
      else setDetail(null)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const remove = async (file: string) => {
    setDeleting(true)
    try {
      await deletePreset(file)
      toast(t('common.deleted'), 'success')
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const openPreview = async (
    json: Record<string, unknown>,
    nameHint: string,
    fileLabel: string,
  ) => {
    const name = nameHint.replace(/\.json$/i, '') || 'imported'
    const preview = await previewPresetJson(name, json)
    setImportDraft({
      fileName: fileLabel,
      name: preview.name || name,
      json,
      preview,
      activate: true,
    })
    setUrlPanelOpen(false)
  }

  const onPickFile = async (file: File) => {
    try {
      const text = await file.text()
      const json = JSON.parse(text) as Record<string, unknown>
      await openPreview(json, file.name, file.name)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const onFetchUrl = async () => {
    const url = urlInput.trim()
    if (!url) {
      toast(t('secondary.presets.urlEmpty'), 'error')
      return
    }
    setUrlLoading(true)
    try {
      const fetched = await fetchPresetFromUrl(url)
      await openPreview(
        fetched.json,
        fetched.suggestedName,
        fetched.finalUrl,
      )
      toast(
        fetched.isSt
          ? t('secondary.presets.urlFetchedSt')
          : t('secondary.presets.urlFetchedRp'),
        'success',
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setUrlLoading(false)
    }
  }

  const confirmImport = async () => {
    if (!importDraft) return
    setImporting(true)
    try {
      const name = importDraft.name.trim() || 'imported-preset'
      const r = await importPresetJson(name, importDraft.json, {
        activate: importDraft.activate,
      })
      const kind = r.converted
        ? t('secondary.presets.importStOk')
        : t('secondary.presets.importRpOk')
      toast(
        `${kind} · ${r.blockCount} ${t('secondary.presets.blocksUnit')}${r.activated ? ` · ${t('secondary.presets.activated')}` : ''}`,
        'success',
      )
      setImportDraft(null)
      await load()
      if (r.activated) {
        setActive(r.file)
        await loadDetail()
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setImporting(false)
    }
  }

  const toggleBlock = async (b: PresetBlockMeta, enabled: boolean) => {
    setBusyId(b.id)
    try {
      await patchPresetDraft({ blocks: [{ id: b.id, enabled }] })
      setDetail((prev) => {
        if (!prev?.preset) return prev
        return {
          ...prev,
          dirty: true,
          preset: {
            ...prev.preset,
            blocks: prev.preset.blocks.map((x) => (x.id === b.id ? { ...x, enabled } : x)),
          },
        }
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const setBlockChannel = async (b: PresetBlockMeta, channel: 'system' | 'postHistory') => {
    if (b.channel === channel) return
    setBusyId(b.id)
    try {
      await patchPresetDraft({ blocks: [{ id: b.id, channel }] })
      setDetail((prev) => {
        if (!prev?.preset) return prev
        return {
          ...prev,
          dirty: true,
          preset: {
            ...prev.preset,
            blocks: prev.preset.blocks.map((x) => (x.id === b.id ? { ...x, channel } : x)),
          },
        }
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const openBlock = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (blockContent[id] !== undefined) return
    try {
      const full = await fetchPresetBlock(id)
      setBlockContent((prev) => ({ ...prev, [id]: full.content }))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const persistDraft = async () => {
    try {
      await savePresetDraft()
      toast(t('common.saved'), 'success')
      await loadDetail()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const discardDraft = async () => {
    try {
      await revertPresetDraft()
      toast(t('secondary.presets.reverted'), 'success')
      setBlockContent({})
      setExpandedId(null)
      await loadDetail()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const reportRows: PresetReportItem[] = importDraft?.preview.report ?? []
  const summary = importDraft?.preview.summary
  const blocks = detail?.preset?.blocks ?? []
  const samplers = detail?.preset?.samplers ?? {}

  return (
    <div className="page secondary-page presets-page">
      <Link to="/library" className="back-link">
        <ArrowLeft size={16} />
        {t('nav.library')}
      </Link>
      <header className="page-header">
        <div>
          <h1 className="section-title">{t('secondary.presets.title')}</h1>
          <p className="section-desc">
            {loading
              ? t('common.loading')
              : t('secondary.presets.listDesc', {
                  count: list.length,
                  active: active ? active.split('/').pop() : t('secondary.presets.none'),
                })}
          </p>
        </div>
        <div className="page-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void onPickFile(f)
            }}
          />
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            {t('secondary.presets.importJson')}
          </button>
          <button
            type="button"
            className={`btn btn-ghost ${urlPanelOpen ? 'is-active' : ''}`}
            onClick={() => setUrlPanelOpen((v) => !v)}
          >
            {t('secondary.presets.importUrl')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void create()}>
            <Plus size={16} />
            {t('common.create')}
          </button>
        </div>
      </header>

      <p className="settings-item-desc presets-hint">{t('secondary.presets.hint')}</p>

      <div className="form-actions" style={{ marginBottom: 12 }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void apply(null)}>
          {t('secondary.presets.clearActive')}
        </button>
      </div>

      {urlPanelOpen && (
        <section className="surface presets-url-panel" aria-label={t('secondary.presets.importUrl')}>
          <div className="entry-head">
            <h3>{t('secondary.presets.importUrl')}</h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm presets-icon-btn"
              aria-label={t('common.close')}
              onClick={() => setUrlPanelOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <p className="settings-item-desc">{t('secondary.presets.urlHint')}</p>
          <div>
            <label className="field-label" htmlFor="preset-import-url">
              {t('secondary.presets.urlLabel')}
            </label>
            <input
              id="preset-import-url"
              className="field-input"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder={t('secondary.presets.urlPlaceholder')}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void onFetchUrl()
                }
              }}
            />
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={urlLoading || !urlInput.trim()}
              onClick={() => void onFetchUrl()}
            >
              {urlLoading ? t('common.loading') : t('secondary.presets.urlFetch')}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setUrlInput('')
                setUrlPanelOpen(false)
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </section>
      )}

      {importDraft && (
        <section className="surface presets-import-panel" aria-label={t('secondary.presets.importPreview')}>
          <div className="entry-head">
            <h3>{t('secondary.presets.importPreview')}</h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm presets-icon-btn"
              aria-label={t('common.close')}
              onClick={() => setImportDraft(null)}
            >
              <X size={16} />
            </button>
          </div>
          <p className="settings-item-desc">
            {importDraft.fileName}
            {importDraft.preview.converted
              ? ` · ${t('secondary.presets.detectedSt')}`
              : ` · ${t('secondary.presets.detectedRp')}`}
          </p>
          <div>
            <label className="field-label">{t('secondary.presets.name')}</label>
            <input
              className="field-input"
              value={importDraft.name}
              onChange={(e) => setImportDraft((d) => (d ? { ...d, name: e.target.value } : d))}
            />
          </div>
          {summary && (
            <div className="presets-summary">
              <span className="chip">
                {t('secondary.presets.sumBlocks', { n: summary.blockCount })}
              </span>
              <span className="chip chip-brand">
                {t('secondary.presets.sumSystem', { n: summary.system })}
              </span>
              <span className="chip">
                {t('secondary.presets.sumPost', { n: summary.postHistory })}
              </span>
              {summary.marker > 0 && (
                <span className="chip chip-muted">
                  {t('secondary.presets.sumMarker', { n: summary.marker })}
                </span>
              )}
              {summary.disabled > 0 && (
                <span className="chip chip-muted">
                  {t('secondary.presets.sumDisabled', { n: summary.disabled })}
                </span>
              )}
              {summary.missing > 0 && (
                <span className="chip chip-warn">
                  {t('secondary.presets.sumMissing', { n: summary.missing })}
                </span>
              )}
              {summary.samplerKeys.length > 0 && (
                <span className="chip chip-muted">
                  {t('secondary.presets.sumSamplers', { keys: summary.samplerKeys.join(', ') })}
                </span>
              )}
            </div>
          )}
          {reportRows.length > 0 && (
            <div className="presets-report">
              <div className="presets-report-head">
                <span>{t('secondary.presets.reportName')}</span>
                <span>{t('secondary.presets.reportAction')}</span>
                <span>{t('secondary.presets.reportChars')}</span>
              </div>
              <ul className="presets-report-list">
                {reportRows.map((r) => (
                  <li key={`${r.identifier}-${r.action}`} className={actionClass(r.action)}>
                    <span className="presets-report-name" title={r.identifier}>
                      {r.name || r.identifier}
                    </span>
                    <span className="presets-report-action">{actionLabel(r.action, t)}</span>
                    <span className="presets-report-chars">
                      {r.contentChars > 0 ? r.contentChars : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {importDraft.preview.converted && (
            <p className="settings-item-desc presets-triage-note">{t('secondary.presets.triageNote')}</p>
          )}
          <label className="inline-toggle">
            <Toggle
              checked={importDraft.activate}
              onChange={(v) => setImportDraft((d) => (d ? { ...d, activate: v } : d))}
              ariaLabel={t('secondary.presets.activateAfter')}
              showLabels={false}
            />
            {t('secondary.presets.activateAfter')}
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={importing}
              onClick={() => void confirmImport()}
            >
              {importing ? t('common.loading') : t('secondary.presets.confirmImport')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setImportDraft(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </section>
      )}

      {active && (
        <section className="surface presets-detail" aria-label={t('secondary.presets.activeDetail')}>
          <div className="entry-head">
            <h3>
              {t('secondary.presets.activeDetail')}
              {detail?.dirty && (
                <span className="chip chip-warn" style={{ marginLeft: 8 }}>
                  {t('secondary.presets.dirty')}
                </span>
              )}
            </h3>
            <div className="form-actions">
              {detail?.dirty && (
                <>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void persistDraft()}>
                    {t('secondary.presets.saveDisk')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void discardDraft()}>
                    {t('secondary.presets.revert')}
                  </button>
                </>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadDetail()}>
                {t('secondary.presets.reload')}
              </button>
            </div>
          </div>
          {detailLoading && <p className="settings-item-desc">{t('common.loading')}</p>}
          {!detailLoading && detail?.missing && (
            <p className="settings-item-desc">{t('secondary.presets.fileMissing', { path: detail.missing })}</p>
          )}
          {!detailLoading && detail?.preset && (
            <>
              <p className="settings-item-desc">
                {detail.preset.name}
                {detail.path ? ` · ${detail.path}` : ''}
                {Object.keys(samplers).length > 0
                  ? ` · ${Object.entries(samplers)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(' · ')}`
                  : ''}
              </p>
              <ul className="presets-blocks">
                {blocks.map((b) => (
                  <li key={b.id} className={`presets-block ${b.enabled ? '' : 'is-off'}`}>
                    <div className="presets-block-main">
                      <div className="presets-block-title">
                        <strong>{b.name || b.id}</strong>
                        <span className="chip chip-muted">{b.chars}</span>
                        <span className={`chip ${b.channel === 'system' ? 'chip-brand' : ''}`}>
                          {b.channel === 'system'
                            ? t('secondary.presets.chSystem')
                            : t('secondary.presets.chPost')}
                        </span>
                      </div>
                      <div className="presets-block-actions">
                        <Toggle
                          checked={b.enabled}
                          onChange={(v) => void toggleBlock(b, v)}
                          ariaLabel={b.name}
                          showLabels={false}
                          size="sm"
                        />
                        <select
                          className="field-input presets-channel-select"
                          value={b.channel}
                          disabled={busyId === b.id}
                          onChange={(e) =>
                            void setBlockChannel(b, e.target.value as 'system' | 'postHistory')
                          }
                          aria-label={t('secondary.presets.channel')}
                        >
                          <option value="system">{t('secondary.presets.chSystem')}</option>
                          <option value="postHistory">{t('secondary.presets.chPost')}</option>
                        </select>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => void openBlock(b.id)}
                        >
                          {expandedId === b.id
                            ? t('secondary.presets.hideContent')
                            : t('secondary.presets.showContent')}
                        </button>
                      </div>
                    </div>
                    {expandedId === b.id && (
                      <pre className="presets-block-content">
                        {blockContent[b.id] ?? t('common.loading')}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
              {blocks.length === 0 && (
                <p className="settings-item-desc">{t('secondary.presets.emptyBlocks')}</p>
              )}
            </>
          )}
        </section>
      )}

      <Reveal as="div" className="entry-list" staggerChildren=".entry-card" y={18}>
        {list.map((p) => (
          <article key={p.file} className="surface entry-card">
            <div className="entry-head">
              <h3>{names[p.file] || p.name}</h3>
              {active === p.file && <span className="chip chip-brand">{t('secondary.presets.inUse')}</span>}
            </div>
            <div>
              <label className="field-label">{t('secondary.presets.name')}</label>
              <input
                className="field-input"
                value={names[p.file] ?? p.name}
                onChange={(e) => setNames((prev) => ({ ...prev, [p.file]: e.target.value }))}
              />
            </div>
            <p className="settings-item-desc" style={{ marginTop: 8, opacity: 0.7 }}>
              {p.file}
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveName(p.file)}>
                {t('common.save')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void apply(p.file)}>
                {t('common.apply')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--danger, #dc2626)' }}
                onClick={() =>
                  setDeleteTarget({ file: p.file, name: names[p.file] || p.name || p.file })
                }
              >
                {t('common.delete')}
              </button>
            </div>
          </article>
        ))}
      </Reveal>
      {!loading && list.length === 0 && (
        <div className="empty-state">{t('secondary.presets.empty')}</div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        danger
        busy={deleting}
        title={t('secondary.presets.deleteTitle')}
        description={
          deleteTarget
            ? t('secondary.presets.deleteConfirm', { name: deleteTarget.name })
            : undefined
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => !deleting && setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void remove(deleteTarget.file)
        }}
      />
    </div>
  )
}
