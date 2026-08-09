export type ColorRuleId =
  | 'dialogue'
  | 'name'
  | 'narration'
  | 'action'
  | 'thought'
  | 'emphasis'

export type ReadingWidth = 'narrow' | 'medium' | 'wide' | 'full'

export type ReadingFontFamily = 'body' | 'serif' | 'sans'

export type ParagraphGap = 'tight' | 'normal' | 'loose'

export type ReadingColors = {
  dialogue: string
  name: string
  narration: string
  action: string
  thought: string
  emphasis: string
  body: string
  surface: string
}

export type ReadingPrefs = {
  colorizeEnabled: boolean
  colorizeRules: Record<ColorRuleId, boolean>
  colors: ReadingColors
  fontFamily: ReadingFontFamily
  fontSizePx: number
  lineHeight: number
  width: ReadingWidth
  compressBlankLines: boolean
  paragraphGap: ParagraphGap
  firstLineIndent: boolean
  stickyChapterEnabled: boolean
}

const KEY = 'dd-reading-prefs'

export const COLOR_RULE_IDS: ColorRuleId[] = [
  'dialogue',
  'name',
  'thought',
  'action',
  'emphasis',
  'narration',
]

export const DEFAULT_READING_COLORS: ReadingColors = {
  dialogue: '#e8a45c',
  name: '#6cb6ff',
  narration: '#9aa3b5',
  action: '#5ec4b6',
  thought: '#b794f6',
  emphasis: '#f07178',
  body: '',
  surface: '',
}

export const defaults: ReadingPrefs = {
  colorizeEnabled: true,
  colorizeRules: {
    dialogue: true,
    name: true,
    thought: true,
    action: true,
    emphasis: true,
    narration: false,
  },
  colors: { ...DEFAULT_READING_COLORS },
  fontFamily: 'body',
  fontSizePx: 20,
  lineHeight: 1.7,
  width: 'full',
  compressBlankLines: false,
  paragraphGap: 'normal',
  firstLineIndent: true,
  stickyChapterEnabled: true,
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function mergePrefs(raw: Partial<ReadingPrefs> | null | undefined): ReadingPrefs {
  const base = { ...defaults, colorizeRules: { ...defaults.colorizeRules }, colors: { ...defaults.colors } }
  if (!raw || typeof raw !== 'object') return base
  const rules = { ...base.colorizeRules, ...(raw.colorizeRules || {}) }
  const colors = { ...base.colors, ...(raw.colors || {}) }
  return {
    ...base,
    ...raw,
    colorizeRules: rules,
    colors,
    fontSizePx: clamp(Number(raw.fontSizePx ?? base.fontSizePx) || base.fontSizePx, 12, 28),
    lineHeight: clamp(Number(raw.lineHeight ?? base.lineHeight) || base.lineHeight, 1.2, 2.4),
    fontFamily:
      raw.fontFamily === 'serif' || raw.fontFamily === 'sans' || raw.fontFamily === 'body'
        ? raw.fontFamily
        : base.fontFamily,
    width:
      raw.width === 'narrow' || raw.width === 'medium' || raw.width === 'wide' || raw.width === 'full'
        ? raw.width
        : base.width,
    paragraphGap:
      raw.paragraphGap === 'tight' || raw.paragraphGap === 'normal' || raw.paragraphGap === 'loose'
        ? raw.paragraphGap
        : base.paragraphGap,
  }
}

export function getReadingPrefs(): ReadingPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return mergePrefs(null)
    return mergePrefs(JSON.parse(raw) as Partial<ReadingPrefs>)
  } catch {
    return mergePrefs(null)
  }
}

export function setReadingPrefs(patch: Partial<ReadingPrefs>): ReadingPrefs {
  const prev = getReadingPrefs()
  const next = mergePrefs({
    ...prev,
    ...patch,
    colorizeRules: { ...prev.colorizeRules, ...(patch.colorizeRules || {}) },
    colors: { ...prev.colors, ...(patch.colors || {}) },
  })
  localStorage.setItem(KEY, JSON.stringify(next))
  applyReadingPrefsToDom(next)
  window.dispatchEvent(new CustomEvent('dd-reading-prefs', { detail: next }))
  return next
}

export function resetReadingColors(): ReadingPrefs {
  return setReadingPrefs({ colors: { ...DEFAULT_READING_COLORS } })
}

const WIDTH_PX: Record<ReadingWidth, string> = {
  narrow: '520px',
  medium: '640px',
  wide: '780px',
  full: '960px',
}

const FONT_STACK: Record<ReadingFontFamily, string> = {
  body: 'var(--font-body)',
  serif: 'Georgia, "Noto Serif SC", "Songti SC", "SimSun", serif',
  sans: 'system-ui, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
}

const GAP_EM: Record<ParagraphGap, string> = {
  tight: '0.45em',
  normal: '0.75em',
  loose: '1.15em',
}

export function applyReadingPrefsToDom(prefs: ReadingPrefs = getReadingPrefs(), root?: HTMLElement | null) {
  const el = root ?? document.documentElement
  const s = el.style
  s.setProperty('--read-font-size', `${prefs.fontSizePx}px`)
  s.setProperty('--read-line-height', String(prefs.lineHeight))
  s.setProperty('--read-font-family', FONT_STACK[prefs.fontFamily])
  s.setProperty('--read-max-width', WIDTH_PX[prefs.width])
  s.setProperty('--read-paragraph-gap', GAP_EM[prefs.paragraphGap])
  s.setProperty('--read-indent', prefs.firstLineIndent ? '2em' : '0')
  s.setProperty('--read-hl-dialogue', prefs.colors.dialogue)
  s.setProperty('--read-hl-name', prefs.colors.name)
  s.setProperty('--read-hl-narration', prefs.colors.narration)
  s.setProperty('--read-hl-action', prefs.colors.action)
  s.setProperty('--read-hl-thought', prefs.colors.thought)
  s.setProperty('--read-hl-emphasis', prefs.colors.emphasis)
  s.removeProperty('--read-underline')
  if (prefs.colors.body) s.setProperty('--read-body-color', prefs.colors.body)
  else s.removeProperty('--read-body-color')
  if (prefs.colors.surface) s.setProperty('--read-surface', prefs.colors.surface)
  else s.removeProperty('--read-surface')

  el.dataset.readColorize = prefs.colorizeEnabled ? '1' : '0'
  el.dataset.readWidth = prefs.width
  el.dataset.readCompress = prefs.compressBlankLines ? '1' : '0'
  el.dataset.readIndent = prefs.firstLineIndent ? '1' : '0'
  delete el.dataset.readUnderline
  el.dataset.readSticky = prefs.stickyChapterEnabled ? '1' : '0'
}

export function compressBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n')
}
