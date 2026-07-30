/**
 * 兼容层：历史 mock 数据已移除。
 * 类型请从 `types/character` 引入，数字格式化请用 `utils/formatCount`。
 */
export type { CharacterCard, Category, Rating, BadgeType } from '../types/character'
export { formatCount } from '../utils/formatCount'

/** @deprecated 社区帖类型仅保留给未接入页的占位组件 */
export interface PlazaWork {
  id: string
  title: string
  titleEn: string
  heat: number
  gradient: string
}

export interface PlazaPost {
  id: string
  author: string
  withCharacter: string
  withCharacterEn: string
  characterId: string
  title: string
  titleEn: string
  body: string
  bodyEn: string
  tags: string[]
  heat: number
  timeAgo: string
  timeAgoEn: string
  region: string
  regionEn: string
  rankBadge?: string
  rankBadgeEn?: string
  likes: number
  comments: number
  supports: number
  bookmarked?: boolean
  following?: boolean
  works: PlazaWork[]
  avatarGradient: string
}

export interface StatsBar {
  day: string
  height: number
  marginBottom: number
}

export interface StatsReading {
  time: string
  value: string
}

/** 空列表：社区数据未接入，页面已改走 Agent 卡库 */
export const characters: never[] = []
export const plazaPosts: PlazaPost[] = []
