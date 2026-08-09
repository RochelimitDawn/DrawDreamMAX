/** 酒馆 / SillyTavern 风格 RP 组件白名单（原生渲染） */
export const ST_RP_WIDGETS: string[] = [
  'letter','mail','email','sms','phone','chatlog','im','broadcast',
  'diary','journal','note','sticky','document','filedoc','dossier','newspaper','article','notice','board','poster','scroll',
  'system','sys','alertbox','toastmsg',
  'quest','mission','objective','inventory','bag','loot','itemcard',
  'skill','ability','spell','combat','battle',
  'meter','bar','gauge','dice','roll','check','rollcheck',
  'location','place','map-pin','mappin','time','clock','weather','forecast',
  'relationship','rel','affinity','profile','charcard','npc',
  'memory','flashback','secret','whisperbox','rumor','gossip',
  'clue','evidence','timeline-event','event','log','chapter','epigraph',
  'imagecard','mediacard','quote-note','caption',
  'searchpanel','search-panel','smartsearch',
  'timepanel','time-panel','worldtime','world-time',
]

const widgetSet = new Set(ST_RP_WIDGETS.map((s) => s.toLowerCase()))

export function isStRpWidget(type: string): boolean {
  return widgetSet.has(type.toLowerCase())
}

const labelMap: Record<string, string> = {
  letter: '书信', mail: '邮件', email: '电子邮件', sms: '短信', phone: '通话', chatlog: '聊天记录', im: '即时消息', broadcast: '广播',
  diary: '日记', journal: '手记', note: '便签', sticky: '便利贴', document: '文件', filedoc: '档案', dossier: '卷宗',
  newspaper: '报刊', article: '文章', notice: '公告', board: '告示', poster: '海报', scroll: '卷轴',
  system: '系统', sys: '系统', alertbox: '提示', toastmsg: '通知',
  quest: '任务', mission: '任务', objective: '目标',
  inventory: '物品栏', bag: '背包', loot: '收获', itemcard: '物品',
  skill: '技能', ability: '能力', spell: '法术',
  combat: '战斗', battle: '交战',
  meter: '数值', bar: '进度', gauge: '仪表',
  dice: '骰子', roll: '检定', check: '检定', rollcheck: '检定',
  location: '地点', place: '地点', 'map-pin': '地图', mappin: '地图',
  time: '时间', clock: '时钟', weather: '天气', forecast: '天气',
  relationship: '关系', rel: '关系', affinity: '好感',
  profile: '档案', charcard: '角色卡', npc: 'NPC',
  memory: '记忆', flashback: '闪回', secret: '秘密', whisperbox: '密语',
  rumor: '传闻', gossip: '闲话',
  clue: '线索', evidence: '证物', 'timeline-event': '事件', event: '事件', log: '日志', chapter: '章节', epigraph: '题记',
  imagecard: '配图', mediacard: '媒体', 'quote-note': '引述', caption: '说明',
  searchpanel: '智能搜索', 'search-panel': '智能搜索', smartsearch: '智能搜索',
  timepanel: '世界时间', 'time-panel': '世界时间', worldtime: '世界时间', 'world-time': '世界时间',
}

export function widgetLabel(type: string): string {
  return labelMap[type.toLowerCase()] || type
}

export function widgetFamily(type: string): string {
  const t = type.toLowerCase()
  if (['letter', 'mail', 'email', 'scroll'].includes(t)) return 'letter'
  if (['sms', 'phone', 'chatlog', 'im'].includes(t)) return 'sms'
  if (['diary', 'journal', 'note', 'sticky', 'quote-note'].includes(t)) return 'diary'
  if (['document', 'filedoc', 'dossier', 'newspaper', 'article'].includes(t)) return 'doc'
  if (['notice', 'board', 'poster'].includes(t)) return 'notice'
  if (['system', 'sys', 'alertbox', 'toastmsg'].includes(t)) return 'system'
  if (['quest', 'mission', 'objective'].includes(t)) return 'quest'
  if (['inventory', 'bag', 'loot', 'itemcard'].includes(t)) return 'inventory'
  if (['skill', 'ability', 'spell'].includes(t)) return 'skill'
  if (['combat', 'battle'].includes(t)) return 'combat'
  if (['meter', 'bar', 'gauge', 'progress'].includes(t)) return 'meter'
  if (['dice', 'roll', 'check', 'rollcheck'].includes(t)) return 'dice'
  if (['location', 'place', 'map-pin', 'mappin'].includes(t)) return 'location'
  if (['time', 'clock', 'weather', 'forecast'].includes(t)) return 'world'
  if (['relationship', 'rel', 'affinity', 'profile', 'charcard', 'npc'].includes(t)) return 'rel'
  if (['memory', 'flashback', 'secret', 'whisperbox'].includes(t)) return 'memory'
  if (['rumor', 'gossip', 'clue', 'evidence'].includes(t)) return 'clue'
  if (['timeline-event', 'event', 'log', 'chapter', 'epigraph'].includes(t)) return 'event'
  if (['broadcast', 'imagecard', 'mediacard', 'caption'].includes(t)) return 'media'
  if (['searchpanel', 'search-panel', 'smartsearch'].includes(t)) return 'search'
  if (['timepanel', 'time-panel', 'worldtime', 'world-time'].includes(t)) return 'time'
  return 'generic'
}
