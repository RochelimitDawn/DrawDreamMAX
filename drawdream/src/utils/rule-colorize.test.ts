import { describe, expect, it } from 'vitest'
import {
  colorizeText,
  collectRuleMatches,
  harvestCharNamesFromText,
  mergeNameSources,
  resolveOverlaps,
} from './rule-colorize'
import type { ReadingPrefs } from './reading-prefs'
import { defaults } from './reading-prefs'

const on = (patch?: Partial<ReadingPrefs['colorizeRules']>): Pick<ReadingPrefs, 'colorizeEnabled' | 'colorizeRules'> => ({
  colorizeEnabled: true,
  colorizeRules: { ...defaults.colorizeRules, narration: false, ...patch },
})

describe('rule-colorize', () => {
  it('returns plain when disabled', () => {
    const r = colorizeText('他说：“你好”', { colorizeEnabled: false, colorizeRules: defaults.colorizeRules })
    expect(r).toEqual([{ text: '他说：“你好”' }])
  })

  it('colors Chinese dialogue quotes', () => {
    const r = colorizeText('他说：“你好啊。”然后走了。', on())
    const dlg = r.filter((s) => s.rule === 'dialogue').map((s) => s.text).join('')
    expect(dlg).toContain('“你好啊。”')
  })

  it('colors corner-bracket dialogue', () => {
    const r = colorizeText('她道：「晚了。」', on())
    expect(r.some((s) => s.rule === 'dialogue' && s.text.includes('晚了'))).toBe(true)
  })

  it('respects per-rule switch off', () => {
    const r = colorizeText('他说：“你好”', on({ dialogue: false }))
    expect(r.every((s) => s.rule !== 'dialogue')).toBe(true)
  })

  it('priority: dialogue wins over emphasis on same span', () => {
    const text = '“快跑！”'
    const matches = collectRuleMatches(text, on({ emphasis: true, dialogue: true }))
    const cover = resolveOverlaps(matches, text.length)
    const mid = cover[2]
    expect(mid === 'dialogue' || mid === 'emphasis').toBe(true)
    expect(cover[0]).toBe('dialogue')
  })

  it('thought pattern', () => {
    const r = colorizeText('他（心想这下完了）站起身。', on())
    expect(r.some((s) => s.rule === 'thought')).toBe(true)
  })

  it('action bracket', () => {
    const r = colorizeText('【拔剑】迎上前去。', on())
    expect(r.some((s) => s.rule === 'action' && s.text.includes('拔剑'))).toBe(true)
  })

  it('empty string', () => {
    expect(colorizeText('', on())).toEqual([])
  })

  it('narration fills gaps when enabled', () => {
    const r = colorizeText('平静的叙述。', on({
      narration: true,
      dialogue: false,
      thought: false,
      action: false,
      emphasis: false,
      name: false,
    }))
    expect(r.some((s) => s.rule === 'narration')).toBe(true)
  })

  it('colors known character names', () => {
    const r = colorizeText('云中子立雾前，纣王端坐殿上。', {
      ...on(),
      names: ['云中子', '纣王'],
    })
    const names = r.filter((s) => s.rule === 'name').map((s) => s.text)
    expect(names).toContain('云中子')
    expect(names).toContain('纣王')
  })

  it('longer name wins over shorter substring', () => {
    const r = colorizeText('黄飞虎按剑出列。', {
      ...on({ dialogue: false, thought: false, action: false, emphasis: false }),
      names: ['黄飞虎', '黄飞'],
    })
    const names = r.filter((s) => s.rule === 'name').map((s) => s.text)
    expect(names).toEqual(['黄飞虎'])
  })

  it('without knownNames does not invent names from prose', () => {
    const text = '云中子侧步让出半身。纣王抬手止住黄飞虎。'
    const r = colorizeText(text, { ...on(), names: [] })
    expect(r.every((s) => s.rule !== 'name')).toBe(true)
  })

  it('harvestCharNamesFromText reads char tags only', () => {
    const text = '旁白。<char>云中子</char>开口。纣王旁观。'
    expect(harvestCharNamesFromText(text)).toEqual(['云中子'])
  })

  it('mergeNameSources de-dupes known sources', () => {
    expect(mergeNameSources(['云中子', '纣王'], ['云中子'], ['黄飞虎'])).toEqual([
      '云中子',
      '纣王',
      '黄飞虎',
    ])
  })
})
