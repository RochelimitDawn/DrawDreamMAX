/** RP 标签词表：ST-XML + 方括号 widget 统一语义 */

export type RpBucket =
  | 'unwrap'
  | 'story'
  | 'scene'
  | 'char'
  | 'voice'
  | 'status'
  | 'scaffold'
  | 'choice'
  | 'widget'
  | 'hide'

export interface TagDef {
  /** 规范化键（小写去下划线） */
  key: string
  bucket: RpBucket
  /** 展示标题 */
  label: string
  /** 原始写法别名 */
  aliases: string[]
}

function def(key: string, bucket: RpBucket, label: string, aliases: string[]): TagDef {
  return { key, bucket, label, aliases }
}

/** 核心词表 */
export const TAG_DEFS: TagDef[] = [
  // 正文包装 → unwrap 或 story 容器
  def('maintext', 'unwrap', '正文', ['maintext', 'main_text', 'MainText']),
  def('content', 'unwrap', '正文', ['content']),
  def('narrative', 'unwrap', '叙事', ['narrative']),
  def('main', 'unwrap', '正文', ['main']),
  def('story', 'unwrap', '故事', ['story', '正文']),
  def('message', 'unwrap', '消息', ['message', 'reply']),
  def('plot', 'unwrap', '剧情', ['plot', 'splot']),

  // 场景
  def('scene', 'scene', '场景', ['scene', 'Scene', 'location_block', '场景']),

  // 人物
  def('char', 'char', '人物', ['char', 'character', 'npc', 'speaker', '人物', 'name']),
  def('user', 'char', '你', ['user', 'User', '{{user}}']),

  // 心声 / 旁白
  def('innervoice', 'voice', '心声', ['inner_voice', 'innervoice', 'inner', 'thought', 'monologue', '心声']),
  def('aside', 'voice', '旁白', ['aside', 'whisper', '旁白']),

  // 状态栏
  def('statusblock', 'status', '状态', [
    'StatusBlock',
    'status_block',
    'statusblock',
    'status',
    'statusbar',
  ]),
  def('normalstatus', 'status', '场景状态', ['normal_status', 'normalstatus']),
  def('specialstatus', 'status', '人物状态', ['special_status', 'specialstatus']),
  def('nextcharacterpanel', 'status', '角色登场', ['NextCharacterPanel', 'next_character_panel']),

  // 脚手架
  def('thinking', 'scaffold', '思考', ['thinking', 'think', 'reasoning']),
  def('draft', 'scaffold', '草稿', ['draft', 'draft_notes', 'descriptive_analysis', 'analysis']),

  // 决策（含模型误写成正文 XML 的 ask_director / 酒馆式选项块）
  def('choice', 'choice', '抉择', [
    'choice',
    'choices',
    'options',
    'ask_director',
    'askdirector',
    'select',
    'decision',
    '抉择',
    '选项组',
  ]),
  def('opt', 'choice', '选项', ['opt', 'option', '选项']),

  // 酒馆风格 RP 组件（XML 别名；方括号走 ST_RP_WIDGETS 白名单）
  def('letter', 'widget', '书信', ['letter', 'mail', 'email']),
  def('sms', 'widget', '短信', ['sms', 'im']),
  def('phone', 'widget', '通话', ['phone']),
  def('chatlog', 'widget', '聊天记录', ['chatlog']),
  def('diary', 'widget', '日记', ['diary', 'journal']),
  def('note', 'widget', '便签', ['note', 'sticky']),
  def('document', 'widget', '文件', ['document', 'filedoc', 'dossier']),
  def('newspaper', 'widget', '报刊', ['newspaper', 'article']),
  def('notice', 'widget', '公告', ['notice', 'board', 'poster']),
  def('scroll', 'widget', '卷轴', ['scroll']),
  def('system', 'widget', '系统', ['system', 'sys', 'alertbox']),
  def('quest', 'widget', '任务', ['quest', 'mission', 'objective']),
  def('inventory', 'widget', '物品栏', ['inventory', 'bag', 'loot']),
  def('itemcard', 'widget', '物品', ['itemcard']),
  def('skill', 'widget', '技能', ['skill', 'ability', 'spell']),
  def('combat', 'widget', '战斗', ['combat', 'battle']),
  def('meter', 'widget', '数值', ['meter', 'gauge']),
  def('dice', 'widget', '骰子', ['dice', 'roll', 'rollcheck']),
  def('location', 'widget', '地点', ['location', 'place', 'mappin', 'map-pin']),
  def('time', 'widget', '时间', ['time', 'clock']),
  def('weather', 'widget', '天气', ['weather', 'forecast']),
  def('relationship', 'widget', '关系', ['relationship', 'rel', 'affinity']),
  def('profile', 'widget', '档案', ['profile', 'charcard', 'npc']),
  def('memory', 'widget', '记忆', ['memory', 'flashback']),
  def('secret', 'widget', '秘密', ['secret', 'whisperbox']),
  def('rumor', 'widget', '传闻', ['rumor', 'gossip']),
  def('clue', 'widget', '线索', ['clue', 'evidence']),
  def('event', 'widget', '事件', ['event', 'timeline-event', 'log']),
  def('chapter', 'widget', '章节', ['chapter', 'epigraph']),
  def('imagecard', 'widget', '配图', ['imagecard', 'mediacard', 'caption']),
  def('broadcast', 'widget', '广播', ['broadcast', 'radio_msg']),
  // searchpanel 已废弃（搜索纯文本）；保留别名以免历史标签解析失败
  def('searchpanel', 'widget', '智能搜索', ['searchpanel', 'search-panel', 'smartsearch']),
  def('timepanel', 'widget', '世界时间', ['timepanel', 'time-panel', 'worldtime', 'world-time']),
]

const aliasMap = new Map<string, TagDef>()
for (const d of TAG_DEFS) {
  aliasMap.set(d.key, d)
  for (const a of d.aliases) {
    aliasMap.set(normKey(a), d)
  }
}

export function normKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[{}]/g, '')
    .replace(/[_\s-]+/g, '')
}

export function resolveTag(raw: string): TagDef | null {
  return aliasMap.get(normKey(raw)) ?? null
}

export function isKnownTag(raw: string): boolean {
  return resolveTag(raw) != null
}

/** 闭合标签互通族 */
export function closeTagFamily(raw: string): string[] {
  const d = resolveTag(raw)
  if (!d) return [raw]
  if (d.key === 'plot') return ['plot', 'splot']
  if (d.key === 'statusblock') return ['StatusBlock', 'status_block', 'statusblock', 'status', 'statusbar']
  if (d.key === 'choice') {
    return ['choice', 'choices', 'options', 'ask_director', 'askdirector', 'select', 'decision', '抉择', '选项组']
  }
  return d.aliases
}
