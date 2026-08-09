export type Rating = 'safe' | 'questionable' | 'explicit'
export type Category =
  | 'fantasy'
  | 'scifi'
  | 'romance'
  | 'adventure'
  | 'daily'
  | 'horror'
  | 'original'

/** 角色卡在 UI 层的统一视图模型（Agent 卡库 + 展示字段） */
export interface CharacterCard {
  id: string
  name: string
  nameEn: string
  author: string
  category: Category
  rating: Rating
  likes: number
  views: number
  chats: number
  tags: string[]
  description: string
  descriptionEn: string
  personality: string
  scenario: string
  firstMessage: string
  gradient: string
  accent: string
  height: number
  path?: string
  isPng?: boolean
  /** PNG 卡立绘 URL（/api/cards/image） */
  coverUrl?: string
  fav?: boolean
  mtimeMs?: number
  source?: 'agent'
}

export type BadgeType = 'hot' | 'new' | 'trending' | 'editor'
