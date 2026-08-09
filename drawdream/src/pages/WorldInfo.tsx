import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  deleteLorebook,
  fetchLoreEntry,
  fetchLorebookView,
  fetchLorebooks,
  putLoreEntry,
  selectLorebooks,
  type LoreEntryListItem,
  type LorebookListItem,
} from '../agent/rest'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Select } from '../components/Select'
import { Toggle } from '../components/Toggle'
import { Reveal } from '../motion'
import { toast } from '../utils/toast'
import './Secondary.css'

interface EditEntry {
  fingerprint: string
  keys: string
  content: string
  priority: number
  constant: boolean
  selective: boolean
  enabled: boolean
  comment: string
  dirty?: boolean
}

export function WorldInfoPage() {
  const { t } = useTranslation()
  const [books, setBooks] = useState<LorebookListItem[]>([])
  const [activePaths, setActivePaths] = useState<string[]>([])
  const [viewPath, setViewPath] = useState('')
  const [entries, setEntries] = useState<EditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadBooks = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchLorebooks()
      setBooks(data.books)
      setActivePaths(data.active ?? [])
      const first = data.active?.[0] || data.books[0]?.path || ''
      setViewPath((prev) => prev || first)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadEntries = useCallback(async (path: string) => {
    if (!path) {
      setEntries([])
      return
    }
    try {
      const view = await fetchLorebookView(path)
      const list: EditEntry[] = []
      for (const e of view.entries as LoreEntryListItem[]) {
        let content = e.preview
        try {
          const d = await fetchLoreEntry(e.fingerprint)
          content = d.content
        } catch {
          /* use preview */
        }
        list.push({
          fingerprint: e.fingerprint,
          keys: e.keys.join(', '),
          content,
          priority: e.order,
          constant: e.constant,
          selective: e.selective,
          enabled: e.enabled,
          comment: e.comment,
        })
      }
      setEntries(list)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      setEntries([])
    }
  }, [])

  useEffect(() => {
    void loadBooks()
  }, [loadBooks])

  useEffect(() => {
    if (viewPath) void loadEntries(viewPath)
  }, [viewPath, loadEntries])

  const patchLocal = (idx: number, patch: Partial<EditEntry>) => {
    setEntries((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], ...patch, dirty: true }
      return next
    })
  }

  const saveEntry = async (idx: number) => {
    const e = entries[idx]
    if (!e) return
    try {
      const r = await putLoreEntry({
        fingerprint: e.fingerprint,
        keys: e.keys
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        content: e.content,
        order: e.priority,
        constant: e.constant,
        selective: e.selective,
        comment: e.comment,
      })
      setEntries((prev) => {
        const next = [...prev]
        next[idx] = { ...next[idx], fingerprint: r.fingerprint, dirty: false }
        return next
      })
      toast(t('common.saved'), 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const toggleMount = async (path: string) => {
    const next = activePaths.includes(path)
      ? activePaths.filter((p) => p !== path)
      : [...activePaths, path]
    try {
      await selectLorebooks(next)
      setActivePaths(next)
      toast(t('common.applied'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const confirmDeleteBook = async () => {
    const path = deleteTarget
    if (!path || deleting) return
    setDeleting(true)
    try {
      await deleteLorebook(path)
      toast(t('common.deleted'), 'success')
      setDeleteTarget(null)
      setViewPath('')
      setEntries([])
      await loadBooks()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const deleteBookName =
    books.find((b) => b.path === deleteTarget)?.name || deleteTarget?.split('/').pop() || ''

  return (
    <div className="page secondary-page">
      <Link to="/library" className="back-link">
        <ArrowLeft size={16} />
        {t('nav.library')}
      </Link>
      <header className="page-header">
        <div>
          <h1 className="section-title">{t('secondary.worldInfo.title')}</h1>
          <p className="section-desc">
            {loading ? '加载中…' : `世界书 ${books.length} 本 · 挂载 ${activePaths.length}`}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => toast('请在 Agent assets/lorebooks 导入 JSON 世界书', 'info')}
        >
          <Plus size={16} />
          {t('secondary.worldInfo.addEntry')}
        </button>
      </header>

      <div className="surface entry-card" style={{ marginBottom: 16 }}>
        <label className="field-label">浏览世界书</label>
        <Select
          fullWidth
          value={viewPath}
          onChange={setViewPath}
          options={
            books.length
              ? books.map((b) => ({
                  value: b.path,
                  label: `${b.name} (${b.entryCount})${activePaths.includes(b.path) ? ' · 已挂载' : ''}`,
                }))
              : [{ value: '', label: '无世界书' }]
          }
        />
        {viewPath && (
          <div className="form-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void toggleMount(viewPath)}>
              {activePaths.includes(viewPath) ? '取消挂载' : '挂载到当前会话'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ color: 'var(--danger, #dc2626)' }}
              onClick={() => setDeleteTarget(viewPath)}
              title={t('common.delete')}
            >
              <Trash2 size={14} />
              {t('common.delete')}
            </button>
          </div>
        )}
      </div>

      <Reveal as="div" className="entry-list" staggerChildren=".entry-card" y={18}>
        {entries.map((entry, idx) => (
          <article key={entry.fingerprint} className="surface entry-card">
            <div className="entry-head">
              <h3>{entry.comment || `${t('secondary.worldInfo.entries')} #${idx + 1}`}</h3>
              <span className="chip chip-brand">
                {t('secondary.worldInfo.priority')} {entry.priority}
              </span>
            </div>
            <div className="grid-2">
              <div>
                <label className="field-label">{t('secondary.worldInfo.keys')}</label>
                <input
                  className="field-input"
                  value={entry.keys}
                  onChange={(e) => patchLocal(idx, { keys: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label">{t('secondary.worldInfo.priority')}</label>
                <input
                  className="field-input"
                  type="number"
                  value={entry.priority}
                  onChange={(e) => patchLocal(idx, { priority: Number(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <label className="field-label">{t('secondary.worldInfo.content')}</label>
              <textarea
                className="field-textarea"
                value={entry.content}
                onChange={(e) => patchLocal(idx, { content: e.target.value })}
                rows={5}
              />
            </div>
            <div className="entry-toggles">
              <div className="inline-toggle">
                <span>{t('secondary.worldInfo.constant')}</span>
                <Toggle
                  checked={entry.constant}
                  onChange={(v) => patchLocal(idx, { constant: v })}
                  ariaLabel={t('secondary.worldInfo.constant')}
                />
              </div>
              <div className="inline-toggle">
                <span>{t('secondary.worldInfo.selective')}</span>
                <Toggle
                  checked={entry.selective}
                  onChange={(v) => patchLocal(idx, { selective: v })}
                  ariaLabel={t('secondary.worldInfo.selective')}
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveEntry(idx)}>
                {t('common.save')}
              </button>
            </div>
          </article>
        ))}
      </Reveal>
      {!loading && entries.length === 0 && (
        <div className="empty-state">{viewPath ? t('common.empty') : '请选择世界书'}</div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        danger
        busy={deleting}
        title={t('common.delete')}
        description={`确认删除世界书「${deleteBookName}」？此操作不可恢复。`}
        confirmLabel={t('common.delete')}
        onConfirm={() => void confirmDeleteBook()}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </div>
  )
}
