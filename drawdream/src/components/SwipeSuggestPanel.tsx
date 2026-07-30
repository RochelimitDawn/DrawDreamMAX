import './SwipeSuggestPanel.css'

/** 滑动备选默认四向（点击自动发送） */
export const DEFAULT_SWIPE_OPTIONS = [
  {
    id: 'sensory',
    label: '感官细描',
    text: '请用更细腻的感官细节（光影、气味、触感、环境声）重写并推进当前场景，不替我行动。',
  },
  {
    id: 'turn',
    label: '剧情转折',
    text: '请在当前局面上推进一小步关键转折（新信息、新冲突或环境变化），保持角色性格，不替我行动。',
  },
  {
    id: 'emotion',
    label: '情绪拉扯',
    text: '请加强角色之间的情绪张力与潜台词，用对白与微表情推进，不替我行动。',
  },
  {
    id: 'prop',
    label: '道具线索',
    text: '请用场景道具、书信、线索或环境变化推进剧情，可适当使用展示组件，不替我行动。',
  },
] as const

export interface SwipeSuggestPanelProps {
  open: boolean
  onClose: () => void
  onPick: (text: string) => void
  options?: ReadonlyArray<{ id: string; label: string; text: string }>
}

export function SwipeSuggestPanel({
  open,
  onClose,
  onPick,
  options = DEFAULT_SWIPE_OPTIONS,
}: SwipeSuggestPanelProps) {
  if (!open) return null
  return (
    <div className="swipe-suggest-panel" role="region" aria-label="滑动备选">
      <div className="swipe-suggest-head">
        <span className="swipe-suggest-title">滑动备选</span>
        <button type="button" className="swipe-suggest-close" onClick={onClose} aria-label="收起">
          ×
        </button>
      </div>
      <div className="swipe-fallback-row">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="swipe-fallback-btn"
            onClick={() => onPick(o.text)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
