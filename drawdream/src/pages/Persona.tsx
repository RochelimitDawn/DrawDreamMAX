import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  createPersona,
  deletePersona,
  fetchPersonas,
  selectPersona,
  updatePersona,
  type PersonaItem,
} from '../agent/rest'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { StudioEditor } from '../components/StudioEditor'
import { Reveal } from '../motion'
import { toast } from '../utils/toast'
import './Secondary.css'

export function PersonaPage() {
  const { t } = useTranslation()
  const [list, setList] = useState<PersonaItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchPersonas()
      setList(data.personas)
      setActiveId(data.activeId)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    try {
      await createPersona(t('secondary.persona.name'), '')
      toast(t('common.created'), 'success')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const save = async (p: PersonaItem) => {
    try {
      await updatePersona(p.id, { name: p.name, persona: p.persona })
      toast(t('common.saved'), 'success')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const apply = async (id: string) => {
    try {
      await selectPersona(id)
      setActiveId(id)
      toast(t('common.applied'), 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const remove = async (id: string) => {
    setDeleting(true)
    try {
      await deletePersona(id)
      toast(t('common.deleted') !== 'common.deleted' ? t('common.deleted') : '已删除', 'success')
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="page secondary-page">
      <Link to="/library" className="back-link">
        <ArrowLeft size={16} />
        {t('nav.library')}
      </Link>
      <header className="page-header">
        <div>
          <h1 className="section-title">{t('secondary.persona.title')}</h1>
          <p className="section-desc">
            {loading ? '加载中…' : `Agent 人设 ${list.length} 个${activeId ? ' · 已选中' : ''}`}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void create()}>
          <Plus size={16} />
          {t('common.create')}
        </button>
      </header>

      <Reveal as="div" className="entry-list" staggerChildren=".studio-editor" y={18}>
        {list.map((p, idx) => (
          <StudioEditor
            key={p.id}
            title={p.name || p.id}
            subtitle={p.id === activeId ? t('secondary.persona.default') : p.id}
            value={p.persona}
            placeholder={t('secondary.persona.description')}
            rows={12}
            onChange={(v) => {
              const next = [...list]
              next[idx] = { ...p, persona: v }
              setList(next)
            }}
            onSave={() => void save(p)}
            saveLabel={t('common.save')}
            toolbar={
              <>
                <input
                  className="field-input"
                  style={{ maxWidth: 160 }}
                  value={p.name}
                  onChange={(e) => {
                    const next = [...list]
                    next[idx] = { ...p, name: e.target.value }
                    setList(next)
                  }}
                  aria-label={t('secondary.persona.name')}
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void apply(p.id)}>
                  {t('common.apply')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--danger, #dc2626)' }}
                  onClick={() => setDeleteTarget({ id: p.id, name: p.name || p.id })}
                >
                  {t('common.delete')}
                </button>
              </>
            }
          />
        ))}
      </Reveal>
      {!loading && list.length === 0 && <div className="empty-state">{t('common.empty')}</div>}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        danger
        busy={deleting}
        title={t('secondary.persona.deleteTitle')}
        description={
          deleteTarget
            ? t('secondary.persona.deleteConfirm', { name: deleteTarget.name })
            : undefined
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => !deleting && setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void remove(deleteTarget.id)
        }}
      />
    </div>
  )
}
