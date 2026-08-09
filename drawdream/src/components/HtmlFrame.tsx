/**
 * 对话流 HTML 沙箱帧（参考梨园 Liyuan HtmlFrame.tsx，clean-room 实现）。
 *
 * - 默认：sandbox 禁止脚本（静态 HTML/CSS）
 * - scripts=true：allow-scripts allow-same-origin allow-forms allow-modals allow-popups
 *   （必须同源，否则 IndexedDB/Dexie/localStorage 在 opaque origin 抛 SecurityError）
 * - seamless=true：无痕模式（卡皮肤/整楼界面）——幽灵操作、真实高度、样式主权
 * - 程序卡（position:fixed + 100vh / 大体积脚本）：直接按视口给高度，避免被裁切
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildSrcDoc,
  looksLikeProgramApp,
  programViewportHeight,
} from '../tavern/frameDoc'
import { IFRAME_TAVERN_BRIDGE_SNIPPET } from '../tavern/tavern-shim'
import type { TavernRuntimeManifest } from '../agent/rest'

const SCRIPT_CODE_FIELDS = ['content', 'code', 'startMessage', 'endMessage', 'onMessage', 'onAppReady', 'onEdit', 'onDestroy'] as const

function extractExtensionScriptCode(scripts: Record<string, unknown>[]): string {
  const parts: string[] = []
  for (const script of scripts) {
    for (const field of SCRIPT_CODE_FIELDS) {
      const value = script[field]
      if (typeof value === 'string' && value.trim()) {
        parts.push(`try{${value}}catch(e){console.error('[CardScript:${field}]',e)}`)
      }
    }
  }
  return parts.join('\n')
}

export function HtmlFrame({
  html,
  title,
  scripts = false,
  seamless = false,
  minHeight = 120,
  maxHeight = 560,
  runtimeManifest,
  streaming = false,
}: {
  html: string
  title?: string
  scripts?: boolean
  /** 无痕模式：卡皮肤/整楼界面；agent show_html 保持 false */
  seamless?: boolean
  minHeight?: number
  maxHeight?: number
  runtimeManifest?: TavernRuntimeManifest | null
  /** 流式期间冻结 iframe，避免每次 delta 重建 srcDoc 导致清屏/屏闪 */
  streaming?: boolean
}) {
  const frameId = useRef(`html-frame-${Math.random().toString(36).slice(2, 10)}`).current
  const ref = useRef<HTMLIFrameElement>(null)
  const programApp = useMemo(() => seamless && looksLikeProgramApp(html, scripts), [html, scripts, seamless])
  const [height, setHeight] = useState(() =>
    programApp && typeof window !== 'undefined' ? programViewportHeight(window) : minHeight,
  )
  const [showSource, setShowSource] = useState(false)
  const extCode = useMemo(() => scripts && runtimeManifest?.extensionScripts?.length
    ? extractExtensionScriptCode(runtimeManifest.extensionScripts)
    : '', [scripts, runtimeManifest?.extensionScripts])
  // 流式期间冻结已渲染的 srcDoc：iframe 不重建，避免清屏/屏闪。
  // 非流式更新 stableHtml；流式期间保持上一个完整帧。
  // 例外：stableHtml 为空（iframe 尚未渲染任何内容）时，流式首次有内容也更新一次。
  const [stableHtml, setStableHtml] = useState(html)
  const wasStreamingRef = useRef(streaming)
  useEffect(() => {
    if (streaming) {
      wasStreamingRef.current = true
      // iframe 尚未渲染过任何内容且已有 HTML：允许首帧更新，避免一直空白
      if (!stableHtml && html) {
        setStableHtml(html)
        wasStreamingRef.current = false
      }
      return
    }
    if (wasStreamingRef.current || stableHtml !== html) {
      setStableHtml(html)
      wasStreamingRef.current = false
    }
  }, [html, streaming, stableHtml])
  const srcDoc = useMemo(
    () => buildSrcDoc(stableHtml, scripts, seamless, IFRAME_TAVERN_BRIDGE_SNIPPET, extCode),
    [stableHtml, scripts, seamless, extCode],
  )

  const sandbox = scripts
    ? seamless
      ? 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups'
      : 'allow-scripts'
    : seamless
      ? 'allow-same-origin'
      : ''
  const cap = seamless ? Number.POSITIVE_INFINITY : maxHeight

  // 程序卡：跟视口，避免裁切；resize 时同步
  useEffect(() => {
    if (!programApp) return
    const apply = () => setHeight(programViewportHeight(window))
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [programApp, srcDoc])

  // 静态帧量高（seamless 下 same-origin 可读）
  useEffect(() => {
    if (scripts) {
      if (!seamless) setHeight(maxHeight)
      return
    }
    const el = ref.current
    if (!el) return
    const fit = () => {
      try {
        const doc = el.contentDocument
        const body = doc?.body
        let h = 0
        if (body) {
          for (const node of Array.from(body.children)) {
            const tag = node.tagName
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK') continue
            const eln = node as HTMLElement
            h = Math.max(h, eln.offsetTop + eln.offsetHeight, Math.ceil(eln.getBoundingClientRect().bottom))
          }
          if (h < 1) h = body.offsetHeight || 0
        }
        if (h < 1) h = doc?.documentElement?.scrollHeight || minHeight
        const next = Math.min(cap, Math.max(minHeight, Math.ceil(h)))
        setHeight((prev) => (Math.abs(prev - next) < 2 ? prev : next))
      } catch {
        /* opaque origin（非 seamless 静态帧） */
      }
    }
    el.addEventListener('load', fit)
    const t = window.setTimeout(fit, 50)
    const t2 = window.setTimeout(fit, 200)
    return () => {
      el.removeEventListener('load', fit)
      window.clearTimeout(t)
      window.clearTimeout(t2)
    }
  }, [srcDoc, scripts, seamless, minHeight, cap, maxHeight])

  // 脚本帧高度上报（seamless）：小部件可跟内容；程序卡已用视口高
  useEffect(() => {
    if (!scripts || !seamless) return
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { drawdreamFrameHeight?: unknown; frameId?: unknown }
      if (!d || d.frameId !== frameId || typeof d.drawdreamFrameHeight !== 'number' || !(d.drawdreamFrameHeight > 0)) {
        return
      }
      const raw = Math.ceil(d.drawdreamFrameHeight)
      const hardCap = Math.min(2400, typeof window !== 'undefined' ? Math.floor(window.innerHeight * 0.92) : 2400)
      if (programApp) {
        const floor = programViewportHeight(typeof window !== 'undefined' ? window : null)
        if (raw + 48 < floor * 0.5) {
          const next = Math.max(minHeight, Math.min(hardCap, raw + 12))
          setHeight((prev) => (Math.abs(prev - next) < 2 ? prev : next))
          return
        }
        if (raw <= height + 24) return
        const next = Math.max(floor, Math.min(hardCap, raw))
        setHeight((prev) => (Math.abs(prev - next) < 2 ? prev : next))
        return
      }
      const next = Math.max(minHeight, Math.min(hardCap, raw))
      setHeight((prev) => {
        if (Math.abs(prev - next) < 2) return prev
        if (next > prev && next - prev <= 8 && prev > minHeight + 20) return prev
        return next
      })
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [scripts, seamless, frameId, minHeight, programApp, height])

  return (
    <div className={`msg-html ${scripts ? 'msg-html-scripts' : ''} ${seamless ? 'msg-html-seamless' : ''} ${programApp ? 'msg-html-program' : ''}`}>
      {!seamless && (
        <div className="msg-html-bar">
          <span className="msg-html-title">{title?.trim() || (scripts ? '交互界面' : 'HTML')}</span>
          <span className="msg-html-tags">
            {scripts ? <span className="chip chip-html-js">脚本</span> : <span className="chip chip-html-static">静态</span>}
            <button type="button" className="act" onClick={() => setShowSource((v) => !v)}>
              {showSource ? '收起源码' : '源码'}
            </button>
          </span>
        </div>
      )}
      {seamless && (
        <div className="msg-html-ghost">
          <button type="button" className="act" onClick={() => setShowSource((v) => !v)}>
            {showSource ? '收起源码' : '源码'}
          </button>
        </div>
      )}
      <iframe
        ref={ref}
        name={frameId}
        className="msg-html-frame"
        title={title || (seamless ? '界面' : 'HTML')}
        sandbox={sandbox}
        srcDoc={srcDoc}
        style={{ height }}
      />
      {showSource && <pre className="msg-html-source">{html}</pre>}
      {!seamless && title?.trim() && !showSource && <div className="msg-html-cap">{title}</div>}
    </div>
  )
}
