import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { parseRpText, type RpPart } from '../agent/rp/parse-rp'
import { compressBlankLines, type ReadingPrefs } from '../utils/reading-prefs'
import { replaceMacrosForDisplay } from '../utils/macro-display'
import { splitHtmlParts } from '../utils/htmlEmbed'
import {
  harvestCharNamesFromText,
  mergeNameSources,
  type ColorizePrefs,
} from '../utils/rule-colorize'
import { MarkdownText } from './MarkdownText'
import { HtmlFrame } from './HtmlFrame'
import type { WorldState } from '../agent/wire.types'

import { parseTimePanelBody, TimePanel } from './TimePanel'
import './RichMessage.css'

type ReadCtx = {
  enableReading?: boolean
  readingPrefs?: ReadingPrefs | null
  nameList?: string[]
}

/** 文本块：完整 Markdown（与助手侧栏共用 MarkdownText） */
function MdBody({
  text,
  className = '',
  enableReading = false,
  readingPrefs = null,
  nameList,
}: {
  text: string
  className?: string
  enableReading?: boolean
  readingPrefs?: ReadingPrefs | null
  nameList?: string[]
}) {
  if (!text.trim()) return null
  const src =
    enableReading && readingPrefs?.compressBlankLines ? compressBlankLines(text) : text
  const colorize = !!(enableReading && readingPrefs?.colorizeEnabled)
  const colorPrefs: ColorizePrefs | null =
    colorize && readingPrefs
      ? {
          colorizeEnabled: true,
          colorizeRules: readingPrefs.colorizeRules,
          names: nameList,
        }
      : null
  return (
    <MarkdownText
      text={src}
      className={`rp-md ${className}`.trim()}
      colorize={colorize}
      colorPrefs={colorPrefs}
    />
  )
}

function looksLikeKv(body: string): boolean {
  const lines = body
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim())
  if (lines.length < 1) return false
  const kv = lines.filter((l) => /[:：]/.test(l)).length
  return kv >= Math.ceil(lines.length * 0.5)
}

function stripYamlFence(body: string): string {
  const t = body.trim()
  const m = /^```ya?ml\s*\r?\n([\s\S]*?)```\s*$/i.exec(t)
  return m ? m[1].trim() : t
}

function StatusPanel({
  label,
  variant,
  body,
  read,
}: {
  label: string
  variant: string
  body: string
  read?: ReadCtx
}) {
  const content = stripYamlFence(body)
  const kv = looksLikeKv(content)
  return (
    <aside className={`rp-status rp-status-${variant.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} data-variant={variant}>
      <header className="rp-status-head">{label}</header>
      {kv ? (
        <dl className="rp-status-kv">
          {content
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map((line, i) => {
              const m = line.match(/^([^:：]+)[:：]\s*(.*)$/)
              if (!m) {
                return (
                  <div key={i} className="rp-status-line">
                    {line}
                  </div>
                )
              }
              return (
                <div key={i} className="rp-status-row">
                  <dt>{m[1].trim()}</dt>
                  <dd>{m[2].trim()}</dd>
                </div>
              )
            })}
        </dl>
      ) : (
        <div className="rp-status-body">
          <MdBody
            text={content}
            enableReading={read?.enableReading}
            readingPrefs={read?.readingPrefs}
            nameList={read?.nameList}
          />
        </div>
      )}
    </aside>
  )
}

function SceneBlock({
  title,
  ambience,
  body,
  anchorKey,
  read,
  nested = false,
}: {
  title?: string
  ambience?: string
  body: string
  anchorKey?: string
  read?: ReadCtx
  /** 场景内层（被场景包裹的子 UI 递归渲染时，不再套 scene 头） */
  nested?: boolean
}) {
  // 场景 body 内可能嵌套 widget / voice / char 等 RP 标签（线索、心声等），
  // 递归解析渲染，避免它们被当作纯文本丢失。
  const innerParts = useMemo(() => parseRpText(body, {}), [body])
  const hasRp = innerParts.some((p) => p.kind !== 'text' || p.text.trim() !== body.trim())

  return (
    <section className="rp-scene" data-read-anchor={anchorKey || undefined}>
      {!nested && (
        <header className="rp-scene-head">
          <span className="rp-scene-badge">场景</span>
          {title ? <strong className="rp-scene-title">{title}</strong> : null}
          {ambience ? <span className="rp-scene-ambience">{ambience}</span> : null}
        </header>
      )}
      {body.trim() ? (
        <div className="rp-scene-body">
          {hasRp ? (
            <>
              {innerParts.map((p, i) => renderPart(p, i, { read }))}
            </>
          ) : (
            <MdBody
              text={body}
              enableReading={read?.enableReading}
              readingPrefs={read?.readingPrefs}
              nameList={read?.nameList}
            />
          )}
        </div>
      ) : null}
    </section>
  )
}

export interface CharInfo {
  affinity?: number
  status?: string
  notes?: string
}

function CharChip({
  name,
  role,
  info,
  active,
  onSelect,
}: {
  name: string
  role?: string
  info?: CharInfo
  active?: boolean
  onSelect?: (name: string) => void
}) {
  const initial = name.slice(0, 1)
  const tip = [
    role,
    info?.status,
    info?.affinity != null ? `好感 ${info.affinity}` : '',
    info?.notes,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      type="button"
      className={`rp-char ${active ? 'is-active' : ''} ${onSelect ? 'is-clickable' : ''}`}
      title={tip || name}
      onClick={() => onSelect?.(name)}
    >
      <span className="rp-char-avatar" aria-hidden>
        {initial}
      </span>
      <span className="rp-char-name">{name}</span>
      {info?.affinity != null ? <span className="rp-char-aff">{info.affinity}</span> : null}
      {role ? <span className="rp-char-role">{role}</span> : null}
    </button>
  )
}

function VoiceBlock({
  mode,
  body,
  read,
}: {
  mode: 'inner' | 'aside'
  body: string
  read?: ReadCtx
}) {
  return (
    <aside className={`rp-voice rp-voice-${mode}`}>
      <span className="rp-voice-label">{mode === 'aside' ? '旁白' : '心声'}</span>
      <div className="rp-voice-body">
        <MdBody text={body} enableReading={read?.enableReading} readingPrefs={read?.readingPrefs} nameList={read?.nameList} />
      </div>
    </aside>
  )
}

function ScaffoldBlock({ label, body, read }: { label: string; body: string; read?: ReadCtx }) {
  return (
    <details className="rp-scaffold">
      <summary>{label}</summary>
      <div className="rp-scaffold-body">
        <MdBody text={body} enableReading={read?.enableReading} readingPrefs={read?.readingPrefs} nameList={read?.nameList} />
      </div>
    </details>
  )
}

function ChoiceBlock({
  question,
  options,
  onPick,
}: {
  question: string
  options: string[]
  onPick?: (opt: string) => void
}) {
  const live = !!onPick
  return (
    <div className={`rp-choice ${live ? 'is-live' : 'is-static'}`} role={live ? 'group' : undefined}>
      <div className="rp-choice-head">
        <span className="rp-choice-badge">{live ? '此刻抉择' : '当时岔路'}</span>
        {!live ? <span className="rp-choice-muted">仅作回顾</span> : null}
      </div>
      <p className="rp-choice-q">{question}</p>
      {options.length > 0 ? (
        <div className="rp-choice-opts">
          {options.map((opt, i) => {
            const m = opt.match(/^【([^】]+)】(.*)$/)
            const title = m ? m[1] : null
            const body = m ? m[2].trim() : opt
            return (
              <button
                key={`${i}-${opt.slice(0, 24)}`}
                type="button"
                className="rp-choice-card"
                disabled={!live}
                onClick={() => onPick?.(opt)}
              >
                <span className="rp-choice-idx" aria-hidden>
                  {i < 26 ? String.fromCharCode(65 + i) : String(i + 1)}
                </span>
                <span className="rp-choice-main">
                  {title ? <span className="rp-choice-title"><MdBody text={title} /></span> : null}
                  <span className="rp-choice-desc"><MdBody text={body || title || ''} /></span>
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="rp-choice-empty">没有可点选项，可在下方输入框自行作答。</p>
      )}
      {live ? <p className="rp-choice-hint">点选一条走向，将作为你的下一句发送</p> : null}
    </div>
  )
}

function parseLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
}

function WidgetBlock({
  type,
  family,
  label,
  attrs,
  body,
  anchorKey,
  read,
}: {
  type: string
  family: string
  label: string
  attrs: Record<string, string>
  body: string
  anchorKey?: string
  read?: ReadCtx
}) {
  // 世界时间面板：UAPI worldtime
  if (family === 'time' || /^(timepanel|time-panel|worldtime|world-time)$/i.test(type)) {
    const data = parseTimePanelBody(body)
    if (data) return <TimePanel data={data} />
  }
  // searchpanel 已废弃：历史 JSON 体降级为纯文本摘要（若有 answer）
  if (family === 'search' || /^(searchpanel|search-panel|smartsearch)$/i.test(type)) {
    let text = body.trim()
    try {
      const j = JSON.parse(text) as { answer?: string; query?: string }
      if (j?.answer) text = j.answer
      else if (j?.query) text = j.query
    } catch {
      /* 非 JSON 原样 */
    }
    return (
      <div className="rp-text">
        <MdBody text={text} enableReading={read?.enableReading} readingPrefs={read?.readingPrefs} nameList={read?.nameList} />
      </div>
    )
  }

  const title = attrs.tt || attrs.title || attrs.n || attrs.name || attrs.from || attrs.to || ''
  const sub =
    attrs.from && attrs.to
      ? `${attrs.from} → ${attrs.to}`
      : attrs.from || attrs.to || attrs.who || attrs.at || attrs.loc || attrs.place || attrs.mood || attrs.v || ''
  const pctRaw = attrs.v ?? attrs.val ?? attrs.pct ?? attrs.p
  const pct = pctRaw != null && pctRaw !== '' && !Number.isNaN(Number(pctRaw)) ? Number(pctRaw) : NaN
  const showMeter = !Number.isNaN(pct) && (family === 'meter' || family === 'rel' || type === 'meter' || type === 'bar' || type === 'gauge')
  const lines = parseLines(body)
  const isKv =
    lines.length > 0 && lines.filter((l) => /[:：]/.test(l)).length >= Math.ceil(lines.length * 0.5)

  // 纯数字 v: 已作进度条时，副标题不再重复显示数字
  const subClean =
    sub && !Number.isNaN(pct) && String(sub) === String(pct) ? '' : sub

  const isChapter = /^(chapter|epigraph)$/i.test(type)

  return (
    <section
      className={`rp-widget rp-widget--${family}`}
      data-widget={type}
      data-read-anchor={isChapter ? anchorKey : undefined}
    >
      <header className="rp-widget-head">
        <span className="rp-widget-badge">{label}</span>
        {title ? <strong className="rp-widget-title">{title}</strong> : null}
        {subClean && subClean !== title ? <span className="rp-widget-sub">{subClean}</span> : null}
      </header>
      {showMeter ? (
        <div className="rp-widget-meter" aria-hidden>
          <div className="rp-widget-meter-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
          <span className="rp-widget-meter-val">{pct}%</span>
        </div>
      ) : null}
      {body.trim() ? (
        isKv ? (
          <dl className="rp-widget-kv">
            {lines.map((line, i) => {
              const m = line.match(/^([^:：]+)[:：]\s*(.*)$/)
              if (!m) {
                return (
                  <div key={i} className="rp-widget-line">
                    <MdBody text={line} enableReading={read?.enableReading} readingPrefs={read?.readingPrefs} nameList={read?.nameList} />
                  </div>
                )
              }
              return (
                <div key={i} className="rp-widget-row">
                  <dt>
                    <MdBody text={m[1].trim()} enableReading={read?.enableReading} readingPrefs={read?.readingPrefs} nameList={read?.nameList} />
                  </dt>
                  <dd>
                    <MdBody text={m[2].trim()} enableReading={read?.enableReading} readingPrefs={read?.readingPrefs} nameList={read?.nameList} />
                  </dd>
                </div>
              )
            })}
          </dl>
        ) : family === 'inventory' || family === 'quest' ? (
          <ul className="rp-widget-list">
            {lines.map((line, i) => (
              <li key={i}>
                <MdBody text={line} enableReading={read?.enableReading} readingPrefs={read?.readingPrefs} nameList={read?.nameList} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="rp-widget-body">
            <MdBody text={body} enableReading={read?.enableReading} readingPrefs={read?.readingPrefs} nameList={read?.nameList} />
          </div>
        )
      ) : null}
    </section>
  )
}

function renderPart(
  p: RpPart,
  key: number,
  ctx: {
    onChoice?: (opt: string) => void
    onCharSelect?: (name: string) => void
    charMap?: Record<string, CharInfo>
    activeChar?: string | null
    messageId?: string
    read?: ReadCtx
  },
): ReactNode {
  const read = ctx.read
  const mid = ctx.messageId || 'msg'
  switch (p.kind) {
    case 'text':
      return (
        <section key={key} className="rp-prose" data-kind="prose">
          <div className="rp-prose-body">
            <MdBody text={p.text} enableReading={read?.enableReading} readingPrefs={read?.readingPrefs} nameList={read?.nameList} />
          </div>
        </section>
      )
    case 'scene':
      return (
        <SceneBlock
          key={key}
          title={p.title}
          ambience={p.ambience}
          body={p.body}
          anchorKey={p.title ? `${mid}:scene:${key}:${p.title}` : undefined}
          read={read}
        />
      )
    case 'char':
      return (
        <CharChip
          key={key}
          name={p.name}
          role={p.role}
          info={ctx.charMap?.[p.name]}
          active={ctx.activeChar === p.name}
          onSelect={ctx.onCharSelect}
        />
      )
    case 'voice':
      return <VoiceBlock key={key} mode={p.mode} body={p.body} read={read} />
    case 'status':
      return <StatusPanel key={key} label={p.label} variant={p.variant} body={p.body} read={read} />
    case 'scaffold':
      return <ScaffoldBlock key={key} label={p.label} body={p.body} read={read} />
    case 'choice':
      return <ChoiceBlock key={key} question={p.question} options={p.options} onPick={ctx.onChoice} />
    case 'widget':
      return (
        <WidgetBlock
          key={key}
          type={p.type}
          family={p.family}
          label={p.label}
          attrs={p.attrs}
          body={p.body}
          anchorKey={`${mid}:chapter:${key}:${p.attrs?.title || p.label || p.type}`}
          read={read}
        />
      )
    default:
      return null
  }
}

export interface RichMessageProps {
  text: string
  rich?: boolean
  /** 流式中：未闭合标签暂缓结构化，减少闪烁 */
  streaming?: boolean
  /** 普通文本是否允许推断为自由格式抉择列表 */
  inferFreeformChoice?: boolean
  onChoice?: (opt: string) => void
  onCharSelect?: (name: string) => void
  charMap?: Record<string, CharInfo>
  activeChar?: string | null
  className?: string
  /** 叙事阅读增强（仅 narrative/greeting） */
  enableReading?: boolean
  readingPrefs?: ReadingPrefs | null
  messageId?: string
  /** 额外已知人名（世界状态 / 卡名），与文中 <char> 合并 */
  knownNames?: string[]
  /** {{user}} / {{char}} 展示名 */
  userName?: string | null
  charName?: string | null
  statusState?: WorldState | null
}

function expandStatusPlaceholder(text: string, state?: WorldState | null): string {
  if (!/statusplaceholderimpl/i.test(text)) return text
  const lines = [
    state?.time ? `时间：${state.time}` : '',
    state?.location ? `地点：${state.location}` : '',
    state?.chapter ? `章节：${state.chapter}` : '',
    ...Object.entries(state?.characters ?? {}).slice(0, 8).map(([name, value]) => {
      const status = [value.status, value.affinity != null ? `好感 ${value.affinity}` : ''].filter(Boolean).join(' · ')
      return `${name}：${status || value.notes || '已登场'}`
    }),
  ].filter(Boolean)
  const body = lines.length ? lines.join('\n') : '状态栏已启用，等待本轮账本同步。'
  return text.replace(/<StatusPlaceHolderImpl\s*\/?>/gi, `<statusblock>${body}</statusblock>`)
}

export function RichMessage({
  text,
  rich = true,
  streaming = false,
  inferFreeformChoice = true,
  onChoice,
  onCharSelect,
  charMap,
  activeChar,
  className = '',
  enableReading = false,
  readingPrefs = null,
  messageId,
  knownNames,
  userName,
  charName,
  statusState,
}: RichMessageProps) {
  const { i18n } = useTranslation()
  const locale = i18n.language?.startsWith('en') ? 'en' : 'zh'
  const displayText = useMemo(() => {
    return expandStatusPlaceholder(replaceMacrosForDisplay(text, { userName, charName }, locale), statusState)
  }, [text, userName, charName, locale, statusState])

  // 先切 HTML 块，再对各 text 段做 RP 解析
  const htmlChunks = useMemo(() => splitHtmlParts(displayText), [displayText])
  const hasHtml = htmlChunks.some((c) => c.kind === 'html')

  const rpParts = useMemo(() => {
    if (!displayText || hasHtml) return [] as RpPart[]
    if (!rich) return [{ kind: 'text', text: displayText } as RpPart]
    return parseRpText(displayText, { streaming, inferFreeformChoice })
  }, [displayText, rich, streaming, inferFreeformChoice, hasHtml])

  const nameList = useMemo(() => {
    if (!enableReading || !readingPrefs?.colorizeEnabled || !readingPrefs.colorizeRules.name) {
      return [] as string[]
    }
    const fromParts: string[] = []
    for (const p of rpParts) {
      if (p.kind === 'char' && p.name) fromParts.push(p.name)
    }
    const harvest = harvestCharNamesFromText(displayText)
    return mergeNameSources(
      knownNames,
      charMap ? Object.keys(charMap) : null,
      harvest,
      fromParts,
    )
  }, [enableReading, readingPrefs, knownNames, charMap, displayText, rpParts])

  const read: ReadCtx | undefined = enableReading
    ? { enableReading: true, readingPrefs: readingPrefs ?? null, nameList }
    : undefined

  const ctx = { onChoice, onCharSelect, charMap, activeChar, messageId, read }

  if (!displayText.trim()) return null

  // 纯 HTML 整页：无气泡装饰，直接 iframe
  if (hasHtml && htmlChunks.length === 1 && htmlChunks[0]!.kind === 'html') {
    return (
      <div className={`rp-message is-html-full ${className}`.trim()}>
        <HtmlFrame
          html={htmlChunks[0]!.html}
          scripts={htmlChunks[0]!.scripts}
          seamless={!!htmlChunks[0]!.scripts}
          streaming={streaming}
        />
      </div>
    )
  }

  // 混排：text → RP 解析；html → 沙箱帧
  if (hasHtml) {
    return (
      <div className={`rp-message is-rich is-html-mix ${className}`.trim()}>
        {htmlChunks.map((chunk, i) => {
          if (chunk.kind === 'html') {
            return (
              <HtmlFrame
                key={`h-${i}`}
                html={chunk.html}
                scripts={chunk.scripts}
                seamless={!!chunk.scripts}
                streaming={streaming}
              />
            )
          }
          const t = chunk.text
          if (!t.trim()) return null
          if (!rich) {
            return (
              <section key={`t-${i}`} className="rp-prose" data-kind="prose">
                <div className="rp-prose-body">
                  <MdBody
                    text={t}
                    enableReading={enableReading}
                    readingPrefs={readingPrefs}
                    nameList={nameList}
                  />
                </div>
              </section>
            )
          }
          const parts = parseRpText(t, { streaming, inferFreeformChoice })
          if (parts.length === 1 && parts[0]!.kind === 'text') {
            return (
              <section key={`t-${i}`} className="rp-prose" data-kind="prose">
                <div className="rp-prose-body">
                  <MdBody
                    text={parts[0]!.text}
                    enableReading={enableReading}
                    readingPrefs={readingPrefs}
                    nameList={nameList}
                  />
                </div>
              </section>
            )
          }
          return (
            <div key={`t-${i}`} className="rp-html-text-seg">
              {parts.map((p, j) => renderPart(p, j, ctx))}
            </div>
          )
        })}
      </div>
    )
  }

  if (!rich || (rpParts.length === 1 && rpParts[0]!.kind === 'text')) {
    const plain = rpParts[0]?.kind === 'text' ? rpParts[0].text : displayText
    return (
      <div className={`rp-message ${className}`.trim()}>
        <MdBody
          text={plain}
          enableReading={enableReading}
          readingPrefs={readingPrefs}
          nameList={nameList}
        />
      </div>
    )
  }

  return (
    <div className={`rp-message is-rich ${className}`.trim()}>
      {rpParts.map((p, i) => renderPart(p, i, ctx))}
    </div>
  )
}
