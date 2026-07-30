import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, Loader2, Trash2, Upload } from 'lucide-react'
import {
  applyForgeJob,
  createForgeJob,
  deleteForgeJob,
  elevateForgeJob,
  estimateForgeJobApi,
  fetchModels,
  getForgeJob,
  listForgeJobs,
  refineForgeJob,
  cancelForgeJob,
  exportForgePack,
  restoreForgeVersion,
  retryForgeJob,
  saveForgeCastSelection,
  saveForgeDraft,
  saveForgeOutline,
  type ForgeCastSelection,
  type ForgeDraftCard,
  type ForgeErrorClass,
  type ForgeEstimate,
  type ForgeJobListItem,
  type ForgeJobView,
  type ForgeLoreDraftEntry,
  type ForgeMode,
  type ModelInfo,
} from '../agent/rest'
import { useSession } from '../agent/useSession'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ProviderIcon } from '../components/ProviderIcon'
import { Select } from '../components/Select'
import { Toggle } from '../components/Toggle'
import { Reveal } from '../motion'
import { toast } from '../utils/toast'
import './NovelForge.css'

const STAGES_WAIT = new Set([
  'queued',
  'indexing',
  'outlining',
  'extracting',
  'reducing',
  'elevating',
])

const STAGE_PIPELINE = [
  'indexing',
  'outlining',
  'extracting',
  'reducing',
  'awaiting_cast',
  'elevating',
  'ready',
] as const

function parseModelKey(key: string): { provider?: string; model?: string } {
  if (!key || key === '__default__') return {}
  const i = key.indexOf('::')
  if (i <= 0) return { model: key }
  return { provider: key.slice(0, i), model: key.slice(i + 2) }
}

function stageIndex(stage: string): number {
  if (stage === 'queued') return -1
  if (stage === 'failed' || stage === 'cancelled') return -1
  if (stage === 'applied') return STAGE_PIPELINE.length
  const i = STAGE_PIPELINE.indexOf(stage as (typeof STAGE_PIPELINE)[number])
  return i
}

function emptyDraftCard(): ForgeDraftCard {
  return {
    name: '',
    description: '',
    personality: '',
    scenario: '',
    firstMes: '',
    systemPrompt: '',
    tags: [],
  }
}

export function NovelForgePage() {
  const { t } = useTranslation()
  const session = useSession()
  const [jobs, setJobs] = useState<ForgeJobListItem[]>([])
  const [activeId, setActiveId] = useState('')
  const [view, setView] = useState<ForgeJobView | null>(null)
  const [mode, setMode] = useState<ForgeMode>('quick')
  const [title, setTitle] = useState('')
  const [enableOutline, setEnableOutline] = useState(false)
  const [outlineText, setOutlineText] = useState('')
  const [multiCard, setMultiCard] = useState(false)
  const [multiCardLimit, setMultiCardLimit] = useState('3')
  const [extractKey, setExtractKey] = useState('__default__')
  const [elevateKey, setElevateKey] = useState('__default__')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [estimate, setEstimate] = useState<ForgeEstimate | null>(null)
  const [pendingChars, setPendingChars] = useState(0)
  const [pendingSample, setPendingSample] = useState('')
  const [modeUserLocked, setModeUserLocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [protagonist, setProtagonist] = useState('')
  const [refineText, setRefineText] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [castSelected, setCastSelected] = useState<string[]>([])
  const [castRenames, setCastRenames] = useState<Record<string, string>>({})
  const [castManual, setCastManual] = useState<string[]>([])
  const [manualName, setManualName] = useState('')
  const [editCard, setEditCard] = useState<ForgeDraftCard>(emptyDraftCard())
  const [editLore, setEditLore] = useState<ForgeLoreDraftEntry[]>([])
  const [draftDirty, setDraftDirty] = useState(false)
  const [jobsCollapsed, setJobsCollapsed] = useState(false)
  const [switchCard, setSwitchCard] = useState(true)
  const [mountLore, setMountLore] = useState(true)
  const [editOutlineBlurb, setEditOutlineBlurb] = useState('')
  const [editOutlineChapters, setEditOutlineChapters] = useState<
    { title: string; summary: string; castHints: string[] }[]
  >([])
  const [outlineDirty, setOutlineDirty] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<number | null>(null)

  const multiCardLimitNum = Math.max(1, Math.min(12, Number(multiCardLimit) || 1))

  const modeOptions = useMemo(
    () => [
      { value: 'quick', label: t('forge.modeQuick') },
      { value: 'standard', label: t('forge.modeStandard') },
      { value: 'deep', label: t('forge.modeDeep') },
    ],
    [t],
  )

  const multiLimitOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        value: String(i + 1),
        label: String(i + 1),
      })),
    [],
  )

  const modelOptions = useMemo(() => {
    const base = [{ value: '__default__', label: t('forge.modelDefault') }]
    if (!models.length) return base
    return [
      ...base,
      ...models.map((m) => ({
        value: `${m.provider}::${m.id}`,
        label: m.name || m.id,
        meta: m.providerName || m.provider,
        icon: <ProviderIcon name={m.provider} model={m.id || m.name} size={16} />,
      })),
    ]
  }, [models, t])

  const castOptions = useMemo(
    () =>
      (view?.cast ?? []).map((c) => ({
        value: c.name,
        label: c.name,
        meta: `${c.roleHint || '—'} · ×${c.count}`,
      })),
    [view?.cast],
  )

  useEffect(() => {
    void fetchModels()
      .then((r) => {
        setModels(r.models ?? [])
        if (r.current) {
          const k = `${r.current.provider}::${r.current.id}`
          setExtractKey((prev) => (prev === '__default__' ? k : prev))
          setElevateKey((prev) => (prev === '__default__' ? k : prev))
        }
      })
      .catch(() => {
        /* 渠道未配置时保留默认项 */
      })
  }, [])

  const refreshList = useCallback(async () => {
    try {
      const data = await listForgeJobs()
      setJobs(data.jobs)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }, [])

  const loadJob = useCallback(async (id: string) => {
    if (!id) {
      setView(null)
      return
    }
    try {
      const v = await getForgeJob(id)
      setView(v)
      if (v.estimate) setEstimate(v.estimate)
      const sel = v.selection
      if (sel) {
        setProtagonist(sel.protagonist || v.job.options.protagonist || v.cast[0]?.name || '')
        setCastSelected(sel.selected?.length ? sel.selected : sel.protagonist ? [sel.protagonist] : [])
        setCastRenames(sel.renames || {})
        setCastManual(sel.manual || [])
      } else if (v.job.options.protagonist) {
        setProtagonist(v.job.options.protagonist)
      } else if (v.cast[0]?.name) {
        setProtagonist((p) => p || v.cast[0].name)
        setCastSelected((prev) => (prev.length ? prev : v.cast.slice(0, 6).map((c) => c.name)))
      }
      if (v.draft?.card) {
        setEditCard({
          name: v.draft.card.name || '',
          description: v.draft.card.description || '',
          personality: v.draft.card.personality || '',
          scenario: v.draft.card.scenario || '',
          firstMes: v.draft.card.firstMes || '',
          systemPrompt: v.draft.card.systemPrompt || '',
          tags: v.draft.card.tags || [],
        })
        setEditLore(Array.isArray(v.draft.lore) ? v.draft.lore : [])
        setDraftDirty(false)
      }
      if (v.outline) {
        setEditOutlineBlurb(v.outline.blurb || '')
        setEditOutlineChapters(
          (v.outline.chapters || []).map((c) => ({
            title: c.title,
            summary: c.summary,
            castHints: c.castHints || [],
          })),
        )
        setOutlineDirty(false)
      } else {
        setEditOutlineBlurb('')
        setEditOutlineChapters([])
        setOutlineDirty(false)
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }, [])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  useEffect(() => {
    if (!activeId) return
    void loadJob(activeId)
  }, [activeId, loadJob])

  useEffect(() => {
    const fp = session.forgeProgress
    if (!fp || !activeId || fp.jobId !== activeId) return
    setView((prev) => {
      if (!prev || prev.job.id !== activeId) return prev
      return {
        ...prev,
        running: STAGES_WAIT.has(fp.stage) || prev.running,
        progress: {
          stage: fp.stage,
          percent: fp.percent,
          message: fp.message,
          chunkTotal: fp.chunkTotal,
          chunkDone: fp.chunkDone,
          error: fp.error,
          updatedAt: fp.updatedAt,
        },
        job: { ...prev.job, stage: fp.stage },
      }
    })
    if (!STAGES_WAIT.has(fp.stage) || fp.stage === 'awaiting_cast' || fp.stage === 'ready') {
      void loadJob(activeId)
      void refreshList()
    }
  }, [session.forgeProgress, activeId, loadJob, refreshList])

  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
    const stage = view?.progress?.stage || view?.job.stage
    if (!activeId || !stage || (!STAGES_WAIT.has(stage) && !view?.running)) return
    pollRef.current = window.setInterval(() => {
      void loadJob(activeId)
      void refreshList()
    }, 4000)
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [activeId, view?.progress?.stage, view?.job.stage, view?.running, loadJob, refreshList])

  useEffect(() => {
    if (pendingChars <= 0) {
      setEstimate(null)
      return
    }
    let cancelled = false
    void estimateForgeJobApi({
      sourceChars: pendingChars,
      mode,
      extraCards: multiCard ? multiCardLimitNum : 0,
      textSample: pendingSample || undefined,
      enableOutline: mode === 'deep' ? true : enableOutline,
      outlineText: outlineText.trim() || undefined,
      hasUserOutline: !!outlineText.trim(),
    }).then((e) => {
      if (cancelled) return
      setEstimate(e)
      if (!modeUserLocked && e.recommendedMode && e.recommendedMode !== mode) {
        setMode(e.recommendedMode)
      }
    })
    return () => {
      cancelled = true
    }
  }, [
    pendingChars,
    mode,
    multiCard,
    multiCardLimitNum,
    pendingSample,
    modeUserLocked,
    enableOutline,
    outlineText,
  ])

  const onFilePick = async (file: File | null) => {
    if (!file) return
    if (!/\.txt$/i.test(file.name) && file.type && !file.type.includes('text')) {
      toast(t('forge.needTxt'), 'error')
      return
    }
    try {
      const text = await file.text()
      const chars = text.trim().length
      setPendingChars(chars)
      setPendingSample(text.slice(0, 120_000))
      setModeUserLocked(false)
      const el = fileRef.current as HTMLInputElement & { __pendingText?: string; __pendingName?: string }
      if (el) {
        el.__pendingText = text
        el.__pendingName = file.name
      }
      // 立即按字数推荐模式（结构信号在 estimate 返回后二次校正）
      void estimateForgeJobApi({
        sourceChars: chars,
        mode,
        extraCards: multiCard ? multiCardLimitNum : 0,
        textSample: text.slice(0, 120_000),
        enableOutline: mode === 'deep' ? true : enableOutline,
        outlineText: outlineText.trim() || undefined,
        hasUserOutline: !!outlineText.trim(),
      }).then((e) => {
        setEstimate(e)
        if (e.recommendedMode) setMode(e.recommendedMode)
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const onUploadStart = async () => {
    const el = fileRef.current as HTMLInputElement & { __pendingText?: string; __pendingName?: string }
    const text = el?.__pendingText
    const name = el?.__pendingName || 'novel.txt'
    if (!text?.trim()) {
      fileRef.current?.click()
      return
    }
    setBusy(true)
    try {
      if (!text.trim()) throw new Error(t('forge.emptyText'))
      const extract = parseModelKey(extractKey)
      const elevate = parseModelKey(elevateKey)
      const hasOutline = !!outlineText.trim()
      const res = await createForgeJob({
        text,
        name,
        mode,
        title: title.trim() || name.replace(/\.txt$/i, ''),
        multiCard,
        multiCardLimit: multiCard ? multiCardLimitNum : 0,
        // 已有大纲时减少 Map 采样，走轻量路径
        sampleChunks: hasOutline ? 8 : undefined,
        extractModel: extract.model,
        elevateModel: elevate.model,
        extractProvider: extract.provider,
        elevateProvider: elevate.provider,
        enableOutline: mode === 'deep' ? true : enableOutline || hasOutline,
        outlineText: hasOutline ? outlineText.trim() : undefined,
      })
      toast(res.message || t('forge.created'), 'success')
      if (res.estimate) setEstimate(res.estimate)
      setActiveId(res.id)
      setPendingChars(0)
      setPendingSample('')
      setModeUserLocked(false)
      if (el) {
        el.__pendingText = undefined
        el.__pendingName = undefined
      }
      await refreshList()
      await loadJob(res.id)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const buildSelection = (): ForgeCastSelection => {
    const pro = protagonist.trim()
    const selected = Array.from(new Set([...(pro ? [pro] : []), ...castSelected.filter(Boolean)]))
    return {
      protagonist: pro,
      selected,
      renames: castRenames,
      manual: castManual,
    }
  }

  const onSaveCast = async () => {
    if (!activeId) return
    setBusy(true)
    try {
      const r = await saveForgeCastSelection(activeId, buildSelection())
      if (r.selection) {
        setProtagonist(r.selection.protagonist)
        setCastSelected(r.selection.selected)
        setCastRenames(r.selection.renames)
        setCastManual(r.selection.manual)
      }
      toast(t('forge.castSaved'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onElevate = async () => {
    if (!activeId) return
    setBusy(true)
    try {
      const selection = buildSelection()
      await saveForgeCastSelection(activeId, selection)
      const sideNames = selection.selected.filter((n) => n !== selection.protagonist)
      await elevateForgeJob(activeId, selection.protagonist || undefined, {
        multiCard: multiCard || sideNames.length > 0,
        multiCardLimit: multiCard
          ? multiCardLimitNum
          : Math.max(sideNames.length, 0),
        sideNames,
        selection,
      })
      toast(t('forge.elevated'), 'success')
      await loadJob(activeId)
      await refreshList()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onSaveDraft = async () => {
    if (!activeId) return
    setBusy(true)
    try {
      await saveForgeDraft(activeId, {
        card: {
          ...editCard,
          tags: Array.isArray(editCard.tags)
            ? editCard.tags
            : String(editCard.tags || '')
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter(Boolean),
        },
        lore: editLore,
      })
      setDraftDirty(false)
      toast(t('forge.draftSaved'), 'success')
      await loadJob(activeId)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onSaveOutline = async () => {
    if (!activeId || !editOutlineChapters.length) return
    setBusy(true)
    try {
      await saveForgeOutline(activeId, {
        blurb: editOutlineBlurb,
        chapters: editOutlineChapters,
      })
      setOutlineDirty(false)
      toast(t('forge.outlineSaved'), 'success')
      await loadJob(activeId)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onApply = async () => {
    if (!activeId) return
    setBusy(true)
    try {
      if (draftDirty) {
        await saveForgeDraft(activeId, {
          card: editCard,
          lore: editLore,
        })
        setDraftDirty(false)
      }
      const r = await applyForgeJob(activeId, { switchCard, mountLore })
      toast(t('forge.applied', { name: r.cardName, n: r.entryCount }), 'success')
      await loadJob(activeId)
      await refreshList()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onRetry = async (from: 'auto' | 'full' = 'auto', lowTemp = false) => {
    if (!activeId) return
    setBusy(true)
    try {
      const r = await retryForgeJob(activeId, { from, lowTemp })
      toast(r.message || t('forge.retried'), 'success')
      await loadJob(activeId)
      await refreshList()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onRestoreVersion = async (version: number) => {
    if (!activeId) return
    setBusy(true)
    try {
      await restoreForgeVersion(activeId, version)
      toast(t('forge.restored', { v: version }), 'success')
      await loadJob(activeId)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onExportPack = async () => {
    if (!activeId) return
    setBusy(true)
    try {
      const pack = await exportForgePack(activeId)
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const title =
        (view?.job.options.title || view?.job.sourceName || activeId).replace(/[^\w\u4e00-\u9fff-]+/g, '_') ||
        activeId
      a.href = url
      a.download = `forge-pack-${title}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast(t('forge.exported'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const applyModelPreset = (preset: 'balanced' | 'split') => {
    if (preset === 'balanced') {
      setElevateKey(extractKey)
      return
    }
    // split：升华尽量保留当前；若相同则保持（用户可再选手动）
    if (elevateKey === extractKey && modelOptions.length > 2) {
      const alt = modelOptions.find((o) => o.value !== '__default__' && o.value !== extractKey)
      if (alt) setElevateKey(alt.value)
    }
  }

  const toggleCastSelected = (name: string) => {
    setCastSelected((prev) => {
      if (prev.includes(name)) {
        if (name === protagonist) return prev
        return prev.filter((n) => n !== name)
      }
      return [...prev, name]
    })
  }

  const addManualCast = () => {
    const n = manualName.trim()
    if (!n) return
    setCastManual((prev) => (prev.includes(n) ? prev : [...prev, n]))
    setCastSelected((prev) => (prev.includes(n) ? prev : [...prev, n]))
    setManualName('')
  }

  const errorClassLabel = (c?: ForgeErrorClass) => {
    if (c === 'timeout') return t('forge.errTimeout')
    if (c === 'json') return t('forge.errJson')
    if (c === 'quota') return t('forge.errQuota')
    if (c === 'unknown') return t('forge.errUnknown')
    return ''
  }

  const onRefine = async () => {
    if (!activeId || !refineText.trim()) return
    setBusy(true)
    try {
      await refineForgeJob(activeId, refineText.trim())
      toast(t('forge.refined'), 'success')
      setRefineText('')
      await loadJob(activeId)
      await refreshList()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    const id = deleteTarget
    if (!id) return
    setBusy(true)
    try {
      await deleteForgeJob(id)
      toast(t('forge.deleted'), 'success')
      if (activeId === id) {
        setActiveId('')
        setView(null)
      }
      setDeleteTarget(null)
      await refreshList()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const pct = view?.progress?.percent ?? 0
  const stage = view?.progress?.stage || view?.job.stage || ''
  const est = view?.estimate || estimate
  const deleteJobMeta = jobs.find((j) => j.id === deleteTarget)

  return (
    <div className="page-pad novel-forge-page">
      <Reveal>
        <header className="nf-head">
          <div className="nf-title-row">
            <BookOpen size={22} strokeWidth={2.1} />
            <h1>{t('forge.title')}</h1>
          </div>
          <p className="nf-sub">{t('forge.sub')}</p>
          <p className="nf-legal">{t('forge.legal')}</p>
        </header>
      </Reveal>

      <div className="nf-grid">
        <Reveal className="nf-panel">
          <h2>{t('forge.newJob')}</h2>
          <label className="nf-field">
            <span>{t('forge.bookTitle')}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('forge.bookTitlePh')}
            />
          </label>
          <div className="nf-field">
            <span>{t('forge.mode')}</span>
            <Select
              value={mode}
              options={modeOptions}
              onChange={(v) => {
                setModeUserLocked(true)
                setMode(v as ForgeMode)
              }}
              fullWidth
              ariaLabel={t('forge.mode')}
            />
            {pendingChars > 0 && estimate?.recommendedMode && (
              <div className="nf-mode-rec">
                <p className="nf-mode-rec-title">
                  {t('forge.modeRec', {
                    mode: t(
                      estimate.recommendedMode === 'standard'
                        ? 'forge.modeStandard'
                        : estimate.recommendedMode === 'deep'
                          ? 'forge.modeDeep'
                          : 'forge.modeQuick',
                    ),
                  })}
                </p>
                <p className="nf-muted nf-mode-rec-reason">{estimate.recommendReason}</p>
                {estimate.recommendedMode !== mode && (
                  <button
                    type="button"
                    className="btn nf-mode-rec-btn"
                    disabled={busy}
                    onClick={() => {
                      setModeUserLocked(false)
                      setMode(estimate.recommendedMode!)
                    }}
                  >
                    {t('forge.modeRecApply')}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="nf-toggle-row">
            <span>{t('forge.enableOutline')}</span>
            <Toggle
              checked={mode === 'deep' ? true : enableOutline}
              onChange={(v) => {
                if (mode === 'deep') return
                setEnableOutline(v)
              }}
              ariaLabel={t('forge.enableOutline')}
              showLabels={false}
            />
          </div>
          <label className="nf-field">
            <span>{t('forge.outlinePaste')}</span>
            <textarea
              value={outlineText}
              onChange={(e) => setOutlineText(e.target.value)}
              placeholder={t('forge.outlinePastePh')}
              rows={3}
            />
          </label>
          <div className="nf-toggle-row">
            <span>{t('forge.multiCard')}</span>
            <Toggle
              checked={multiCard}
              onChange={setMultiCard}
              ariaLabel={t('forge.multiCard')}
              showLabels={false}
            />
          </div>
          {multiCard && (
            <div className="nf-field">
              <span>{t('forge.multiCardLimit')}</span>
              <Select
                value={String(multiCardLimitNum)}
                options={multiLimitOptions}
                onChange={setMultiCardLimit}
                fullWidth
                ariaLabel={t('forge.multiCardLimit')}
              />
            </div>
          )}
          <div className="nf-field">
            <span>{t('forge.modelPreset')}</span>
            <div className="nf-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => applyModelPreset('balanced')}>
                {t('forge.modelPresetBalanced')}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => applyModelPreset('split')}>
                {t('forge.modelPresetSplit')}
              </button>
            </div>
          </div>
          <div className="nf-field">
            <span>{t('forge.extractModel')}</span>
            <Select
              value={extractKey}
              options={modelOptions}
              onChange={setExtractKey}
              fullWidth
              ariaLabel={t('forge.extractModel')}
              placeholder={t('forge.modelDefault')}
            />
          </div>
          <div className="nf-field">
            <span>{t('forge.elevateModel')}</span>
            <Select
              value={elevateKey}
              options={modelOptions}
              onChange={setElevateKey}
              fullWidth
              ariaLabel={t('forge.elevateModel')}
              placeholder={t('forge.modelDefault')}
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={(e) => void onFilePick(e.target.files?.[0] ?? null)}
          />
          <div className="nf-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload size={16} />
              {t('forge.pickFile')}
            </button>
            <button
              type="button"
              className="btn btn-primary nf-upload"
              disabled={busy}
              onClick={() => void onUploadStart()}
            >
              {busy ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
              {t('forge.uploadTxt')}
            </button>
          </div>
          {pendingChars > 0 && (
            <p className="nf-muted">{t('forge.pendingChars', { n: pendingChars.toLocaleString() })}</p>
          )}
          {est && (
            <div className="nf-estimate">
              <h3>{t('forge.estimate')}</h3>
              <p className="nf-muted">
                {t('forge.estimateDetail', {
                  calls: est.totalCalls,
                  map: est.mapCalls,
                  ol: est.outlineCalls ?? 0,
                  elev: est.elevateCalls,
                  min: est.approxMinutes,
                  inTok: Math.round(est.approxInputTokens / 1000),
                  outTok: Math.round(est.approxOutputTokens / 1000),
                })}
              </p>
              <p className="nf-muted nf-estimate-note">{est.note}</p>
            </div>
          )}
        </Reveal>

        <Reveal className="nf-panel nf-jobs-panel">
          <div className="nf-jobs-head">
            <h2>{t('forge.jobs')}</h2>
            <button
              type="button"
              className="btn nf-collapse-btn"
              onClick={() => setJobsCollapsed((v) => !v)}
            >
              {jobsCollapsed ? t('forge.jobsExpand') : t('forge.jobsCollapse')}
            </button>
          </div>
          {!jobsCollapsed &&
            (jobs.length === 0 ? (
              <p className="nf-muted">{t('forge.noJobs')}</p>
            ) : (
              <ul className="nf-job-list">
                {jobs.map((j) => (
                  <li key={j.id} className="nf-job-row">
                    <button
                      type="button"
                      className={`nf-job-item ${activeId === j.id ? 'is-active' : ''}`}
                      onClick={() => setActiveId(j.id)}
                    >
                      <strong>{j.title || j.sourceName}</strong>
                      <span>
                        {j.stage} · {j.mode} · {(j.sourceChars / 1000).toFixed(1)}k
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn nf-del"
                      title={t('forge.delete')}
                      disabled={busy}
                      onClick={() => setDeleteTarget(j.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </Reveal>
      </div>

      {view && (
        <Reveal className="nf-panel nf-detail">
          <h2>{view.job.options.title || view.job.sourceName}</h2>

          <div className="nf-stage-bar" aria-label={t('forge.stages')}>
            {STAGE_PIPELINE.map((s, i) => {
              const cur = stageIndex(stage === 'failed' ? view.progress?.failedStage || '' : stage)
              const done = cur > i || stage === 'applied' || stage === 'ready'
              const active = cur === i || (stage === 'failed' && view.progress?.failedStage === s)
              return (
                <div
                  key={s}
                  className={`nf-stage-step${done ? ' is-done' : ''}${active ? ' is-active' : ''}${
                    stage === 'failed' && view.progress?.failedStage === s ? ' is-failed' : ''
                  }`}
                >
                  <span className="nf-stage-dot" />
                  <span className="nf-stage-label">
                    {s === 'indexing'
                      ? t('forge.stageIndexing')
                      : s === 'outlining'
                        ? t('forge.stageOutlining')
                        : s === 'extracting'
                          ? t('forge.stageExtracting')
                          : s === 'reducing'
                            ? t('forge.stageReducing')
                            : s === 'awaiting_cast'
                              ? t('forge.stageAwaitCast')
                              : s === 'elevating'
                                ? t('forge.stageElevating')
                                : t('forge.stageReady')}
                  </span>
                </div>
              )
            })}
          </div>

          <div className="nf-progress">
            <div className="nf-progress-bar" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <p className="nf-status">
            {stage} · {pct}% · {view.progress?.message || ''}
            {view.running ? ` · ${t('forge.running')}` : ''}
            {view.progress?.chunkTotal ? ` · ${view.progress.chunkDone}/${view.progress.chunkTotal}` : ''}
          </p>
          {view.stats && (
            <div className="nf-stats">
              <h3>{t('forge.stats')}</h3>
              <p className="nf-muted">
                {t('forge.statsDetail', {
                  chars: view.stats.sourceChars.toLocaleString(),
                  cast: view.stats.castCount,
                  sel: view.stats.selectedCount,
                  ol: view.stats.outlineChapters,
                  lore: view.stats.loreCount,
                  extra: view.stats.extraCards,
                  ver: view.stats.versionCount,
                })}
              </p>
              <div className="nf-actions">
                {(stage === 'ready' || stage === 'applied' || view.draft) && (
                  <button type="button" className="btn" disabled={busy} onClick={() => void onExportPack()}>
                    {t('forge.exportPack')}
                  </button>
                )}
                {(view.running ||
                  stage === 'queued' ||
                  stage === 'indexing' ||
                  stage === 'outlining' ||
                  stage === 'extracting' ||
                  stage === 'reducing' ||
                  stage === 'elevating') && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        if (!activeId) return
                        setBusy(true)
                        try {
                          const r = await cancelForgeJob(activeId)
                          toast(r.message || t('forge.cancelRequested'), 'success')
                          await loadJob(activeId)
                          await refreshList()
                        } catch (e) {
                          toast(e instanceof Error ? e.message : String(e), 'error')
                        } finally {
                          setBusy(false)
                        }
                      })()
                    }}
                  >
                    {t('forge.cancel')}
                  </button>
                )}
              </div>
            </div>
          )}
          {stage === 'cancelled' && (
            <div className="nf-fail-box">
              <p className="nf-muted">{t('forge.cancelled')}</p>
              <div className="nf-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void onRetry('auto', false)}
                >
                  {t('forge.retryFrom')}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => void onRetry('full', false)}>
                  {t('forge.retryFull')}
                </button>
              </div>
            </div>
          )}
          {stage === 'failed' && (
            <div className="nf-fail-box">
              {view.progress?.failedStage && (
                <p className="nf-error">
                  {t('forge.failedAt', { stage: view.progress.failedStage })}
                  {view.progress.errorClass
                    ? ` · ${errorClassLabel(view.progress.errorClass)}`
                    : ''}
                </p>
              )}
              {view.progress?.error && <p className="nf-error">{view.progress.error}</p>}
              <div className="nf-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void onRetry('auto', false)}
                >
                  {t('forge.retryFrom')}
                </button>
                {(view.progress?.errorClass === 'json' || view.progress?.errorClass === 'unknown') && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void onRetry('auto', true)}
                  >
                    {t('forge.retryLowTemp')}
                  </button>
                )}
                <button type="button" className="btn" disabled={busy} onClick={() => void onRetry('full', false)}>
                  {t('forge.retryFull')}
                </button>
              </div>
            </div>
          )}

          {(view.outline || editOutlineChapters.length > 0) && (
            <div className="nf-outline">
              <h3>{t('forge.outlineTitle')}</h3>
              {view.outline?.themes && view.outline.themes.length > 0 && (
                <p className="nf-muted">
                  {t('forge.outlineThemes')}: {view.outline.themes.join('、')}
                </p>
              )}
              {view.outline?.conflicts && view.outline.conflicts.length > 0 && (
                <p className="nf-muted">
                  {t('forge.outlineConflicts')}: {view.outline.conflicts.join('、')}
                </p>
              )}
              <label className="nf-field">
                <span>{t('forge.outlineEditBlurb')}</span>
                <input
                  value={editOutlineBlurb}
                  onChange={(e) => {
                    setEditOutlineBlurb(e.target.value)
                    setOutlineDirty(true)
                  }}
                />
              </label>
              <div className="nf-outline-edit">
                {editOutlineChapters.map((ch, idx) => (
                  <div key={`ol-${idx}`} className="nf-lore-item">
                    <label className="nf-field">
                      <span>{t('forge.loreTitle')}</span>
                      <input
                        value={ch.title}
                        onChange={(e) => {
                          setEditOutlineChapters((list) =>
                            list.map((it, i) => (i === idx ? { ...it, title: e.target.value } : it)),
                          )
                          setOutlineDirty(true)
                        }}
                      />
                    </label>
                    <label className="nf-field">
                      <span>{t('forge.loreContent')}</span>
                      <textarea
                        rows={2}
                        value={ch.summary}
                        onChange={(e) => {
                          setEditOutlineChapters((list) =>
                            list.map((it, i) =>
                              i === idx ? { ...it, summary: e.target.value } : it,
                            ),
                          )
                          setOutlineDirty(true)
                        }}
                      />
                    </label>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn"
                disabled={busy || !outlineDirty || !editOutlineChapters.length}
                onClick={() => void onSaveOutline()}
              >
                {t('forge.outlineSave')}
              </button>
            </div>
          )}

          {(view.cast.length > 0 || castManual.length > 0) && (
            <div className="nf-cast">
              <h3>{t('forge.cast')}</h3>
              <div className="nf-field">
                <span>{t('forge.protagonist')}</span>
                <Select
                  value={protagonist || castOptions[0]?.value || ''}
                  options={[
                    ...castOptions,
                    ...castManual
                      .filter((m) => !castOptions.some((o) => o.value === m))
                      .map((m) => ({ value: m, label: m, meta: 'manual' })),
                  ]}
                  onChange={(v) => {
                    setProtagonist(v)
                    setCastSelected((prev) => (prev.includes(v) ? prev : [...prev, v]))
                  }}
                  fullWidth
                  ariaLabel={t('forge.protagonist')}
                />
              </div>
              <ul className="nf-cast-table">
                {[
                  ...view.cast.slice(0, 24),
                  ...castManual
                    .filter((m) => !view.cast.some((c) => c.name === m))
                    .map((m) => ({
                      name: m,
                      aliases: [] as string[],
                      roleHint: 'manual',
                      traits: [] as string[],
                      count: 0,
                      chunkSpan: 0,
                    })),
                ].map((c) => (
                  <li key={c.name} className="nf-cast-row">
                    <label className="nf-cast-check">
                      <input
                        type="checkbox"
                        checked={castSelected.includes(c.name) || c.name === protagonist}
                        disabled={c.name === protagonist}
                        onChange={() => toggleCastSelected(c.name)}
                      />
                      <span>{t('forge.castSelect')}</span>
                    </label>
                    <div className="nf-cast-meta">
                      <strong>{c.name}</strong>
                      <span>
                        {c.roleHint || '—'}
                        {c.chunkSpan ? ` · span ${c.chunkSpan}` : ''}
                        {c.traits?.length ? ` · ${c.traits.slice(0, 3).join('、')}` : ''}
                      </span>
                    </div>
                    <label className="nf-field nf-cast-rename">
                      <span>{t('forge.castRename')}</span>
                      <input
                        value={castRenames[c.name] ?? ''}
                        placeholder={c.name}
                        onChange={(e) =>
                          setCastRenames((prev) => ({
                            ...prev,
                            [c.name]: e.target.value,
                          }))
                        }
                      />
                    </label>
                  </li>
                ))}
              </ul>
              <div className="nf-cast-add">
                <input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder={t('forge.castAddPh')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addManualCast()
                    }
                  }}
                />
                <button type="button" className="btn" disabled={busy || !manualName.trim()} onClick={addManualCast}>
                  {t('forge.castAddBtn')}
                </button>
              </div>
              <div className="nf-actions">
                {(stage === 'awaiting_cast' || stage === 'ready' || stage === 'failed') && (
                  <button type="button" className="btn" disabled={busy} onClick={() => void onSaveCast()}>
                    {t('forge.castSave')}
                  </button>
                )}
                {(stage === 'awaiting_cast' || stage === 'ready') && (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onElevate()}>
                    {t('forge.elevate')}
                  </button>
                )}
              </div>
            </div>
          )}

          {view.draft && (stage === 'ready' || stage === 'applied') && (
            <div className="nf-draft">
              <h3>{t('forge.draft')}</h3>
              <p className="nf-muted">{t('forge.draftHint')}</p>
              <p>
                <strong>{editCard.name || view.draft.cardName}</strong> ·{' '}
                {t('forge.loreCount', { n: editLore.length || view.draft.loreCount })}
              </p>
              {view.draft.extraCardNames && view.draft.extraCardNames.length > 0 && (
                <p className="nf-muted">
                  {t('forge.extraCards')}: {view.draft.extraCardNames.join('、')}
                </p>
              )}

              <label className="nf-field">
                <span>{t('forge.fieldDesc')}</span>
                <textarea
                  rows={4}
                  value={editCard.description}
                  onChange={(e) => {
                    setEditCard((c) => ({ ...c, description: e.target.value }))
                    setDraftDirty(true)
                  }}
                />
              </label>
              <label className="nf-field">
                <span>{t('forge.fieldPersonality')}</span>
                <textarea
                  rows={2}
                  value={editCard.personality}
                  onChange={(e) => {
                    setEditCard((c) => ({ ...c, personality: e.target.value }))
                    setDraftDirty(true)
                  }}
                />
              </label>
              <label className="nf-field">
                <span>{t('forge.fieldScenario')}</span>
                <textarea
                  rows={2}
                  value={editCard.scenario}
                  onChange={(e) => {
                    setEditCard((c) => ({ ...c, scenario: e.target.value }))
                    setDraftDirty(true)
                  }}
                />
              </label>
              <label className="nf-field">
                <span>{t('forge.fieldFirstMes')}</span>
                <textarea
                  rows={4}
                  value={editCard.firstMes}
                  onChange={(e) => {
                    setEditCard((c) => ({ ...c, firstMes: e.target.value }))
                    setDraftDirty(true)
                  }}
                />
              </label>
              <label className="nf-field">
                <span>{t('forge.fieldSystem')}</span>
                <textarea
                  rows={3}
                  value={editCard.systemPrompt || ''}
                  onChange={(e) => {
                    setEditCard((c) => ({ ...c, systemPrompt: e.target.value }))
                    setDraftDirty(true)
                  }}
                />
              </label>
              <label className="nf-field">
                <span>{t('forge.fieldTags')}</span>
                <input
                  value={(editCard.tags || []).join(', ')}
                  onChange={(e) => {
                    setEditCard((c) => ({
                      ...c,
                      tags: e.target.value
                        .split(/[,，]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }))
                    setDraftDirty(true)
                  }}
                />
              </label>

              {editLore.length > 0 && (
                <div className="nf-lore-edit">
                  <h3>{t('forge.loreEntries')}</h3>
                  {editLore.map((entry, idx) => (
                    <div key={`${entry.title}-${idx}`} className="nf-lore-item">
                      <label className="nf-field">
                        <span>{t('forge.loreTitle')}</span>
                        <input
                          value={entry.title}
                          onChange={(e) => {
                            setEditLore((list) =>
                              list.map((it, i) => (i === idx ? { ...it, title: e.target.value } : it)),
                            )
                            setDraftDirty(true)
                          }}
                        />
                      </label>
                      <label className="nf-field">
                        <span>{t('forge.loreKeys')}</span>
                        <input
                          value={(entry.keys || []).join(', ')}
                          onChange={(e) => {
                            const keys = e.target.value
                              .split(/[,，]/)
                              .map((s) => s.trim())
                              .filter(Boolean)
                            setEditLore((list) =>
                              list.map((it, i) => (i === idx ? { ...it, keys } : it)),
                            )
                            setDraftDirty(true)
                          }}
                        />
                      </label>
                      <label className="nf-cast-check">
                        <input
                          type="checkbox"
                          checked={entry.constant === true}
                          onChange={(e) => {
                            setEditLore((list) =>
                              list.map((it, i) =>
                                i === idx ? { ...it, constant: e.target.checked } : it,
                              ),
                            )
                            setDraftDirty(true)
                          }}
                        />
                        <span>{t('forge.loreConstant')}</span>
                      </label>
                      <label className="nf-field">
                        <span>{t('forge.loreContent')}</span>
                        <textarea
                          rows={3}
                          value={entry.content}
                          onChange={(e) => {
                            setEditLore((list) =>
                              list.map((it, i) =>
                                i === idx ? { ...it, content: e.target.value } : it,
                              ),
                            )
                            setDraftDirty(true)
                          }}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              )}

              <div className="nf-refine">
                <label className="nf-field">
                  <span>{t('forge.refine')}</span>
                  <textarea
                    value={refineText}
                    onChange={(e) => setRefineText(e.target.value)}
                    placeholder={t('forge.refinePh')}
                    rows={3}
                  />
                </label>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !refineText.trim()}
                  onClick={() => void onRefine()}
                >
                  {t('forge.refineBtn')}
                </button>
              </div>

              {view.versions && view.versions.length > 0 && (
                <div className="nf-versions">
                  <h3>{t('forge.versions')}</h3>
                  <ul className="nf-version-list">
                    {view.versions.map((v) => (
                      <li key={v.version}>
                        <span>
                          v{v.version}
                          {v.cardName ? ` · ${v.cardName}` : ''}
                          {v.savedAt
                            ? ` · ${new Date(v.savedAt).toLocaleString()}`
                            : ''}
                          {` · lore ${v.loreCount}`}
                        </span>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => void onRestoreVersion(v.version)}
                        >
                          {t('forge.restoreVersion')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {stage === 'ready' && (
                <div className="nf-apply-opts">
                  <p className="nf-muted">{t('forge.applyOpts')}</p>
                  <div className="nf-toggle-row">
                    <span>{t('forge.switchCard')}</span>
                    <Toggle
                      checked={switchCard}
                      onChange={setSwitchCard}
                      ariaLabel={t('forge.switchCard')}
                      showLabels={false}
                    />
                  </div>
                  <div className="nf-toggle-row">
                    <span>{t('forge.mountLore')}</span>
                    <Toggle
                      checked={mountLore}
                      onChange={setMountLore}
                      ariaLabel={t('forge.mountLore')}
                      showLabels={false}
                    />
                  </div>
                </div>
              )}

              <div className="nf-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !draftDirty}
                  onClick={() => void onSaveDraft()}
                >
                  {t('forge.draftSave')}
                </button>
                {stage === 'ready' && (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onApply()}>
                    {t('forge.apply')}
                  </button>
                )}
              </div>
            </div>
          )}

          {view.timeline && view.timeline.length > 0 && (
            <div className="nf-timeline">
              <h3>{t('forge.timeline')}</h3>
              <ol className="nf-timeline-list">
                {view.timeline.map((ev) => (
                  <li key={`${ev.order}-${ev.title}`}>
                    <strong>
                      {ev.order}. {ev.title}
                    </strong>
                    <span>{ev.summary}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {(view.result || stage === 'applied') && (
            <div className="nf-result">
              <h3>{t('forge.result')}</h3>
              <p>
                {t('forge.cardPath')}: {(view.result || view.job.result)?.cardPath}
              </p>
              <p>
                {t('forge.lorePath')}: {(view.result || view.job.result)?.lorebookPath}
              </p>
              <div className="nf-actions">
                <Link className="btn" to="/cards">
                  {t('forge.gotoCards')}
                </Link>
                <Link className="btn" to="/library">
                  {t('forge.gotoLibrary')}
                </Link>
                <Link className="btn btn-primary" to="/chat">
                  {t('forge.gotoChat')}
                </Link>
              </div>
            </div>
          )}
        </Reveal>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('forge.delete')}
        description={
          deleteJobMeta
            ? t('forge.confirmDeleteNamed', {
                name: deleteJobMeta.title || deleteJobMeta.sourceName,
              })
            : t('forge.confirmDelete')
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => !busy && setDeleteTarget(null)}
      />
    </div>
  )
}
