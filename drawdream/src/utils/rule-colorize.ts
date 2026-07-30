import type { ColorRuleId, ReadingPrefs } from './reading-prefs'
import { COLOR_RULE_IDS } from './reading-prefs'

export type ColorSpan = { text: string; rule?: ColorRuleId }

/** 优先级：dialogue > name > thought > action > emphasis > narration */
const PRIORITY: ColorRuleId[] = ['dialogue', 'name', 'thought', 'action', 'emphasis', 'narration']

type RawMatch = { start: number; end: number; rule: ColorRuleId }

export type ColorizePrefs = Pick<ReadingPrefs, 'colorizeEnabled' | 'colorizeRules'> & {
  /** 已知角色名（世界状态 / 卡名 / 文中 char 标签），长名优先 */
  names?: string[]
}

function pushMatches(
  out: RawMatch[],
  text: string,
  re: RegExp,
  rule: ColorRuleId,
  /** 若 >0，用该捕获组作为区间（避免把前缀分隔符算进匹配） */
  group = 0,
) {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
  const r = new RegExp(re.source, flags)
  let m: RegExpExecArray | null
  while ((m = r.exec(text))) {
    const g = group > 0 ? m[group] : m[0]
    if (g == null || g.length === 0) {
      if (m[0].length === 0) r.lastIndex++
      continue
    }
    const start = group > 0 ? (m.index ?? 0) + m[0].indexOf(g) : m.index
    const end = start + g.length
    if (end > start) out.push({ start, end, rule })
    if (m[0].length === 0) r.lastIndex++
  }
}

/** 规范化人名列表：去重、去空白、长度≥2、长名在前 */
export function normalizeNameList(names: Iterable<string> | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  if (!names) return out
  for (const raw of names) {
    const n = String(raw || '').trim()
    if (n.length < 2 || n.length > 24) continue
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  out.sort((a, b) => b.length - a.length || a.localeCompare(b, 'zh'))
  return out
}

function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false
  return /[A-Za-z0-9_\u00C0-\u024F]/.test(ch)
}

/** 词典扫人名：零 Token；英文名做简单词界，中文直接子串 */
export function collectNameMatches(text: string, names: string[]): RawMatch[] {
  if (!text || names.length === 0) return []
  const covered = new Uint8Array(text.length)
  const out: RawMatch[] = []
  for (const name of names) {
    if (!name) continue
    const latin = /^[A-Za-z0-9][A-Za-z0-9 _.'-]{0,22}[A-Za-z0-9]$/.test(name)
    let from = 0
    while (from <= text.length - name.length) {
      const i = text.indexOf(name, from)
      if (i < 0) break
      const end = i + name.length
      from = i + 1
      if (latin) {
        const before = text[i - 1]
        const after = text[end]
        if (isWordChar(before) || isWordChar(after)) continue
      }
      let overlap = false
      for (let k = i; k < end; k++) {
        if (covered[k]) {
          overlap = true
          break
        }
      }
      if (overlap) continue
      for (let k = i; k < end; k++) covered[k] = 1
      out.push({ start: i, end, rule: 'name' })
    }
  }
  return out
}

/** 收集启用规则的匹配区间（未消解重叠） */
export function collectRuleMatches(text: string, prefs: ColorizePrefs): RawMatch[] {
  if (!prefs.colorizeEnabled || !text) return []
  const on = prefs.colorizeRules
  const raw: RawMatch[] = []

  if (on.dialogue) {
    pushMatches(raw, text, /“[^”\n]{1,400}”/g, 'dialogue')
    pushMatches(raw, text, /「[^」\n]{1,400}」/g, 'dialogue')
    pushMatches(raw, text, /『[^』\n]{1,400}』/g, 'dialogue')
    pushMatches(raw, text, /"([^"\n]{1,200})"/g, 'dialogue')
    pushMatches(
      raw,
      text,
      /(?:道|曰|问|喝道|扬声道|低声道|沉声|朗声|笑曰|笑道|开口)[：:，,\s]*[“「『"][^”」』"\n]+[”」』"]/g,
      'dialogue',
    )
  }

  if (on.name) {
    raw.push(...collectNameMatches(text, normalizeNameList(prefs.names)))
  }

  if (on.thought) {
    pushMatches(raw, text, /（[^）]{0,40}(?:心想|暗道|心道|寻思|默念|腹诽)[^）]{0,80}）/g, 'thought')
    pushMatches(raw, text, /\([^)]{0,40}(?:心想|暗道|心道|寻思|默念)[^)]{0,80}\)/g, 'thought')
    pushMatches(raw, text, /(?<!\*)\*([^*\n「」""“”]{2,80})\*(?!\*)/g, 'thought')
  }

  if (on.action) {
    pushMatches(raw, text, /【[^】]{1,40}】/g, 'action')
    pushMatches(
      raw,
      text,
      /(?:^|[\s，。；])([\u4e00-\u9fff]{0,4}(?:点头|摇头|转身|抬手|低头|望向|看向|伸出|握住|拱手|稽首)[^\n。！？!，,]{0,10})/g,
      'action',
      1,
    )
  }

  if (on.emphasis) {
    pushMatches(raw, text, /[^\n。！？]{0,12}[！!]{1,3}/g, 'emphasis')
  }

  return raw
}

function priorityOf(rule: ColorRuleId): number {
  const i = PRIORITY.indexOf(rule)
  return i < 0 ? 99 : i
}

/** 消解重叠：高优先级覆盖低优先级 */
export function resolveOverlaps(matches: RawMatch[], len: number): Array<ColorRuleId | null> {
  const cover: Array<ColorRuleId | null> = Array(len).fill(null)
  const sorted = [...matches].sort((a, b) => priorityOf(a.rule) - priorityOf(b.rule) || a.start - b.start)
  for (const m of sorted) {
    for (let i = m.start; i < m.end && i < len; i++) {
      if (cover[i] == null) cover[i] = m.rule
    }
  }
  return cover
}

export function colorizeText(text: string, prefs: ColorizePrefs): ColorSpan[] {
  if (!text) return []
  if (!prefs.colorizeEnabled) return [{ text }]

  try {
    const matches = collectRuleMatches(text, prefs)
    const cover = resolveOverlaps(matches, text.length)
    if (prefs.colorizeRules.narration) {
      for (let i = 0; i < cover.length; i++) {
        if (cover[i] == null && !/\s/.test(text[i]!)) cover[i] = 'narration'
      }
    }

    const out: ColorSpan[] = []
    let i = 0
    while (i < text.length) {
      const rule = cover[i] ?? undefined
      let j = i + 1
      while (j < text.length && (cover[j] ?? undefined) === rule) j++
      out.push({ text: text.slice(i, j), rule })
      i = j
    }
    return out.length ? out : [{ text }]
  } catch {
    return [{ text }]
  }
}

export function activeColorRules(prefs: Pick<ReadingPrefs, 'colorizeEnabled' | 'colorizeRules'>): ColorRuleId[] {
  if (!prefs.colorizeEnabled) return []
  return COLOR_RULE_IDS.filter((id) => prefs.colorizeRules[id])
}

/** 从 RP 原文中轻量收集 <char> 名（不依赖完整 parse） */
export function harvestCharNamesFromText(text: string): string[] {
  if (!text) return []
  const out: string[] = []
  const re = /<char(?:\s[^>]*)?>([^<]{1,32})<\/char>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const n = m[1]?.trim()
    if (n) out.push(n)
  }
  return out
}


/** 合并多路人名来源（世界状态 / 卡名 / <char> 标签等已知名） */

export function mergeNameSources(
  ...sources: Array<Iterable<string> | null | undefined>
): string[] {
  const bag: string[] = []
  for (const s of sources) {
    if (!s) continue
    for (const n of s) bag.push(n)
  }
  const list = normalizeNameList(bag)
  // 防止病理长文撑爆词典
  return list.length > 120 ? list.slice(0, 120) : list
}
