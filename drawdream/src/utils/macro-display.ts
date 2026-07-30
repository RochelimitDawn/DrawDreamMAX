/**
 * 角色卡宏在 UI 层的展示替换：{{user}} / {{char}} 等。
 * 仅影响前端呈现，不改写会话正文落盘内容。
 */

const USER_RE = /\{\{\s*user\s*\}\}/gi
const CHAR_RE = /\{\{\s*char\s*\}\}/gi

export type MacroDisplayNames = {
  userName?: string | null
  charName?: string | null
}

/** 纯文本替换（详情页、摘要等） */
export function replaceMacrosForDisplay(
  text: string,
  names: MacroDisplayNames = {},
  locale: 'zh' | 'en' = 'zh',
): string {
  if (!text) return text
  const user = (names.userName || '').trim() || (locale === 'en' ? 'You' : '你')
  const char = (names.charName || '').trim() || (locale === 'en' ? 'Character' : '角色')
  return text.replace(USER_RE, user).replace(CHAR_RE, char)
}

/**
 * 将宏渲染为带样式的 HTML 片段（用于 Markdown 前预处理时用零宽标记，
 * 或在 React 层用 renderMacroSpans）。
 * 此处返回可被 Markdown 忽略的占位，实际高亮由 wrapMacroSpans 做。
 */
export function wrapMacroSpans(
  text: string,
  names: MacroDisplayNames = {},
  locale: 'zh' | 'en' = 'zh',
): string {
  // 先替换为最终显示名；样式由 CSS 类在 React 层处理时再包
  return replaceMacrosForDisplay(text, names, locale)
}

/** 检测是否仍含未替换宏（调试用） */
export function hasRawMacros(text: string): boolean {
  return USER_RE.test(text) || CHAR_RE.test(text)
}
