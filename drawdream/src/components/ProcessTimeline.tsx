import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProcessStep, WireActivity } from '../agent/wire.types'
import {
  ToolCallChip,
  toolCallTitle,
  type ToolCallChipItem,
} from './ToolCallChip'
import { ThinkingBlock } from './ThinkingBlock'
import { toolDisplayName, type ToolLabelLocale } from '../agent/tool-labels'
import './ProcessTimeline.css'

/**
 * 处理过程时间线：思考段与工具调用按发生顺序交错展示（Monkey Code 风格）。
 * - think 步骤 → ThinkingBlock
 * - tool_start/tool_end 配对 → ToolCallChip（running → done/error）
 * - 相邻完全相同的 tool 调用折叠为 ×n
 */

type TimelineRender =
  | { kind: 'think'; text: string; streaming?: boolean }
  | { kind: 'tool'; item: ToolCallChipItem }

function pairToolActivity(
  steps: ProcessStep[],
  locale: ToolLabelLocale,
): TimelineRender[] {
  const out: TimelineRender[] = []
  const open = new Map<string, number[]>()
  let runs = 0

  for (const s of steps) {
    if (s.kind === 'think') {
      out.push({ kind: 'think', text: s.text, streaming: s.streaming })
      continue
    }
    const a = s.activity
    const name = a.name || ''
    if (a.kind === 'tool_start') {
      const idx = out.length
      const stack = open.get(name) ?? []
      stack.push(idx)
      open.set(name, stack)
      const query = a.query
      out.push({
        kind: 'tool',
        item: {
          id: `run-${name}-${idx}`,
          name,
          status: 'running',
          detail: a.detail,
          query,
          title: query
            ? `${toolDisplayName(name, locale)} "${query.length > 48 ? `${query.slice(0, 48)}…` : query}"`
            : toolCallTitle(name, a.detail, 'running', locale),
        },
      })
      continue
    }
    if (a.kind === 'tool_end') {
      const stack = open.get(name)
      const at = stack?.pop()
      if (stack && stack.length === 0) open.delete(name)
      const status: ToolCallChipItem['status'] = a.isError ? 'error' : 'done'
      if (at != null && out[at]?.kind === 'tool') {
        const prev = out[at] as { kind: 'tool'; item: ToolCallChipItem }
        out[at] = {
          kind: 'tool',
          item: {
            ...prev.item,
            status,
            detail: a.detail || prev.item.detail,
            title: prev.item.query
              ? `${toolDisplayName(name, locale)} "${(prev.item.query || '').length > 48 ? `${prev.item.query.slice(0, 48)}…` : prev.item.query}"`
              : toolCallTitle(name, prev.item.detail || a.detail, status, locale),
          },
        }
      } else {
        out.push({
          kind: 'tool',
          item: {
            id: `end-${name}-${++runs}`,
            name,
            status,
            detail: a.detail,
            title: toolCallTitle(name, a.detail, status, locale),
          },
        })
      }
      continue
    }
    out.push({
      kind: 'tool',
      item: {
        id: `note-${++runs}`,
        name: name || 'note',
        status: a.isError ? 'error' : 'note',
        detail: a.detail,
        title: toolCallTitle(name || 'note', a.detail, a.isError ? 'error' : 'note', locale),
      },
    })
  }
  return foldToolSteps(out)
}

/** 折叠相邻完全相同的工具调用（同 start 参数 + 同 end 结果） */
function foldToolSteps(list: TimelineRender[]): TimelineRender[] {
  const out: TimelineRender[] = []
  let n = 1
  for (const item of list) {
    const prev = out[out.length - 1]
    if (
      item.kind === 'tool' &&
      prev?.kind === 'tool' &&
      prev.item.name === item.item.name &&
      prev.item.status === item.item.status &&
      (prev.item.query ?? '') === (item.item.query ?? '') &&
      (prev.item.detail ?? '') === (item.item.detail ?? '')
    ) {
      n += 1
      const count = n > 2 ? ` ×${n}` : ' ×2'
      const title = prev.item.title?.replace(/ ×\d+$/, '') ?? ''
      out[out.length - 1] = { kind: 'tool', item: { ...prev.item, title: `${title}${count}` } }
      continue
    }
    n = 1
    out.push(item)
  }
  return out
}

/** 取工具活动里可读的标题参数（用于聊天里 tool 步骤的小标题） */
export function activityTitle(a: WireActivity, locale: ToolLabelLocale): string {
  return toolCallTitle(a.name || '', a.detail, a.isError ? 'error' : a.kind === 'tool_end' ? 'done' : 'running', locale)
}

export function ProcessTimeline({
  steps,
  thinkingLabels,
}: {
  steps: ProcessStep[]
  thinkingLabels?: {
    labelIdle?: string
    labelLive?: string
    labelDone?: string
    autoCollapseOnEnd?: boolean
  }
}) {
  const { i18n } = useTranslation()
  const locale: ToolLabelLocale = i18n.language?.startsWith('en') ? 'en' : 'zh'
  const renders = useMemo(() => pairToolActivity(steps, locale), [steps, locale])

  if (!renders.length) return null

  return (
    <div className="dd-timeline" role="status" aria-live="polite">
      {renders.map((r, i) =>
        r.kind === 'think' ? (
          <ThinkingBlock
            key={`t-${i}`}
            text={r.text}
            streaming={!!r.streaming}
            autoCollapseOnEnd={thinkingLabels?.autoCollapseOnEnd ?? true}
            labelIdle={thinkingLabels?.labelIdle}
            labelLive={thinkingLabels?.labelLive}
            labelDone={thinkingLabels?.labelDone}
          />
        ) : (
          <ToolCallChip key={r.item.id} item={r.item} />
        ),
      )}
    </div>
  )
}
