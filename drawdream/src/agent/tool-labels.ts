/** 工具/过程条：弱化「AI 感」，用叙事侧旁注口吻；中英随 i18n */

export type ToolLabelLocale = 'zh' | 'en'

const TOOL_LABELS_ZH: Record<string, string> = {
  lorebook_search: '查阅设定',
  lorebook_write: '记下设定',
  world_state_get: '核对账本',
  world_state_update: '更新账本',
  world_read: '读取世界书',
  world_write: '写入世界书',
  memory_search: '回想往事',
  memory_store: '收存记忆',
  memory_rooms: '浏览记忆厅',
  codex_create: '创建知识库',
  codex_mount: '挂载知识库',
  codex_unmount: '卸载知识库',
  codex_write: '写入知识库',
  panel_write: '更新侧栏',
  panel_read: '查看侧栏',
  panel_close: '收起侧栏',
  story_info: '故事信息',
  story_read: '读取故事',
  story_search: '搜索故事',
  story_command: '故事指令',
  config_read: '读配置',
  config_write: '写配置',
  preset_read: '读预设',
  preset_toggle: '切换预设',
  models_list: '列出模型',
  skill_save: '保存技能',
  todo_write: '任务清单',
  todo_list: '查看任务清单',
  show_image: '配图',
  show_audio: '音频',
  show_video: '视频',
  show_html: '嵌入界面',
  tts: '配音',
  world_time: '世界时间',
  smart_search: '联网搜索',
  ask_director: '请你定夺',
  bash: '本机操作',
  read: '读文件',
  write: '写文件',
  edit: '改文件',
  grep: '搜内容',
  find: '找文件',
  ls: '列目录',
}

const TOOL_LABELS_EN: Record<string, string> = {
  lorebook_search: 'Lore lookup',
  lorebook_write: 'Lore note',
  world_state_get: 'Check ledger',
  world_state_update: 'Update ledger',
  world_read: 'Read worldbook',
  world_write: 'Write worldbook',
  memory_search: 'Recall',
  memory_store: 'Store memory',
  memory_rooms: 'Memory halls',
  codex_create: 'Create codex',
  codex_mount: 'Mount codex',
  codex_unmount: 'Unmount codex',
  codex_write: 'Write codex',
  panel_write: 'Update panel',
  panel_read: 'Read panel',
  panel_close: 'Close panel',
  story_info: 'Story info',
  story_read: 'Read story',
  story_search: 'Search story',
  story_command: 'Story command',
  config_read: 'Read config',
  config_write: 'Write config',
  preset_read: 'Read preset',
  preset_toggle: 'Toggle preset',
  models_list: 'List models',
  skill_save: 'Save skill',
  todo_write: 'Task list',
  todo_list: 'View tasks',
  show_image: 'Image',
  show_audio: 'Audio',
  show_video: 'Video',
  show_html: 'Embed UI',
  tts: 'Voice',
  world_time: 'World time',
  smart_search: 'Web search',
  ask_director: 'Your call',
  bash: 'Shell',
  read: 'Read file',
  write: 'Write file',
  edit: 'Edit file',
  grep: 'Search text',
  find: 'Find files',
  ls: 'List dir',
}

function table(locale: ToolLabelLocale): Record<string, string> {
  return locale === 'en' ? TOOL_LABELS_EN : TOOL_LABELS_ZH
}

export function toolDisplayName(name: string, locale: ToolLabelLocale = 'zh'): string {
  if (!name) return locale === 'en' ? 'Moment' : '片刻'
  const labels = table(locale)
  if (labels[name]) return labels[name]
  if (name.startsWith('mcp__')) {
    const rest = name.slice(5)
    const i = rest.indexOf('__')
    const tool = i >= 0 ? rest.slice(i + 2) : rest
    if (locale === 'en') return tool ? `Addon · ${tool}` : 'Addon'
    return tool ? `外设 · ${tool}` : '外设'
  }
  if (/^[a-z][a-z0-9_]+$/.test(name)) {
    return name.replace(/_/g, ' ')
  }
  return name
}

export function toolFailSuffix(locale: ToolLabelLocale = 'zh'): string {
  return locale === 'en' ? ' failed' : ' 失败'
}

/** @deprecated 使用 ToolCallChip / toolCallTitle；保留兼容旧调用 */
export function activityHeadline(kind?: string, name?: string, isError?: boolean, locale: ToolLabelLocale = 'zh'): string {
  if (isError) return `${toolDisplayName(name || '', locale)}${toolFailSuffix(locale)}`
  if (kind === 'tool_start') return toolDisplayName(name || '', locale)
  if (kind === 'tool_end') return toolDisplayName(name || '', locale)
  if (kind === 'note') return toolDisplayName(name || (locale === 'en' ? 'Note' : '旁注'), locale)
  return toolDisplayName(name || (locale === 'en' ? 'Moment' : '片刻'), locale)
}
