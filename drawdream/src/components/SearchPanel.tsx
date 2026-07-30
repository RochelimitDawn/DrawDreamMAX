/**
 * @deprecated 智能搜索仅输出纯文本（formatSearchPlain），不再渲染 SearchPanel 卡片。
 * 保留空壳避免旧 import 路径炸；新代码请用 MarkdownText 展示正文。
 */

export type SearchPanelImage = { url: string; description?: string }
export type SearchPanelHit = {
  title?: string
  url?: string
  content?: string
  domain?: string
  favicon?: string
  images?: SearchPanelImage[]
}

export type SearchPanelData = {
  v?: number
  provider?: string
  query?: string
  original_query?: string
  answer?: string
  images?: SearchPanelImage[]
  results: SearchPanelHit[]
}

/** 历史 JSON body 解析：始终返回 null（UI 已停用） */
export function parseSearchPanelBody(_body: string): SearchPanelData | null {
  return null
}

/** 已停用：不渲染任何 UI */
export function SearchPanel(_props: { data: SearchPanelData; className?: string }) {
  return null
}
