import { useEffect, useId, useMemo, useRef } from 'react'
import {
  cardBridgeBootstrapScript,
  clampCardBridgeHeight,
  createCardBridgeResponse,
  parseCardBridgeRequest,
  requiredCapabilityForRequest,
  type CardBridgeCapability,
  type CardBridgeRequest,
} from '../utils/cardBridge'
import { tavernRuntime } from '../tavern/runtime-adapter'
import type { TavernRuntimeManifest } from '../agent/rest'

const SCRIPT_CODE_FIELDS = ['code', 'startMessage', 'endMessage', 'onMessage', 'onAppReady', 'onEdit', 'onDestroy'] as const

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

export type CardHtmlFrameProps = {
  html: string
  scripts?: boolean
  className?: string
  title?: string
  capabilities?: CardBridgeCapability[]
  frameId?: string
  capabilityToken?: string
  onBridgeRequest?: (request: CardBridgeRequest) => unknown | Promise<unknown>
  runtimeManifest?: TavernRuntimeManifest | null
}

/**
 * 通用 HTML 沙箱帧。
 */
export function CardHtmlFrame({
  html,
  scripts = false,
  className = '',
  title = 'card-html',
  capabilities = [],
  frameId,
  capabilityToken,
  onBridgeRequest,
  runtimeManifest,
}: CardHtmlFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null)
  const generatedId = useId()
  const effectiveFrameId = frameId ?? `card-${generatedId}`
  const effectiveCapabilityToken = capabilityToken ?? `token-${generatedId}`
  const effectiveCapabilities = useMemo(() => {
    const declared = runtimeManifest?.requiredCapabilities ?? []
    return [...new Set([...capabilities, ...declared])].filter((capability): capability is CardBridgeCapability => [
      'context.read', 'variables.read', 'variables.write', 'messages.send', 'messages.update',
      'events.subscribe', 'assets.read', 'card.ui', 'external.module', 'slash.execute',
    ].includes(capability))
  }, [capabilities, runtimeManifest?.requiredCapabilities])

  const srcDoc = useMemo(() => {
    const base = `<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;color:inherit;font:inherit}img{max-width:100%}</style>`
     const csp = runtimeManifest?.csp
       ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${[...new Set([...runtimeManifest.csp.scriptSrc, "'unsafe-inline'"])].join(' ')}; style-src ${[...new Set([...runtimeManifest.csp.styleSrc, "'unsafe-inline'"])].join(' ')}; connect-src ${[...new Set([...runtimeManifest.csp.connectSrc, "http://127.0.0.1:*", "http://localhost:*"])].join(' ')}; img-src 'self' data: http: https:;">`
       : ''
    const extCode = scripts && runtimeManifest?.extensionScripts?.length
      ? extractExtensionScriptCode(runtimeManifest.extensionScripts)
      : ''
    const extTag = extCode ? `<script>${extCode}</script>` : ''
    const boot = scripts ? cardBridgeBootstrapScript({ frameId: effectiveFrameId, capabilityToken: effectiveCapabilityToken, cardFingerprint: runtimeManifest?.cardFingerprint, capabilities: effectiveCapabilities }) + extTag : ''
    if (/^\s*<(!doctype|html)\b/i.test(html)) {
       if (!scripts) return csp ? html.replace(/<head([^>]*)>/i, `<head$1>${csp}`) : html
       const withCsp = csp ? html.replace(/<head([^>]*)>/i, `<head$1>${csp}`) : html
       if (/<\/body\s*>/i.test(withCsp)) return withCsp.replace(/<\/body\s*>/i, `${boot}</body>`)
       if (/<\/html\s*>/i.test(withCsp)) return withCsp.replace(/<\/html\s*>/i, `${boot}</html>`)
       return `${withCsp}${boot}`
    }
     return `<!DOCTYPE html><html><head><meta charset="utf-8"/>${csp}${base}</head><body>${html}${boot}</body></html>`
  }, [html, scripts, effectiveFrameId, effectiveCapabilityToken, effectiveCapabilities, runtimeManifest?.csp, runtimeManifest?.extensionScripts])

  // 高度自适应
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const eventUnsubscribers: Array<() => void> = []
    const onMessage = async (event: MessageEvent<unknown>) => {
      if (event.source !== el.contentWindow) return
      const request = parseCardBridgeRequest(event.data)
       if (!request || request.frameId !== effectiveFrameId || request.capabilityToken !== effectiveCapabilityToken) return
       if (runtimeManifest?.cardFingerprint && request.cardFingerprint !== runtimeManifest.cardFingerprint) return
      const required = requiredCapabilityForRequest(request.type)
      if (required && !effectiveCapabilities.includes(required)) {
        el.contentWindow?.postMessage(createCardBridgeResponse(request, { ok: false, error: `Capability denied: ${required}` }), '*')
        return
      }
      if (request.type === 'frame.resize') {
        const payload = request.payload as { height?: unknown } | undefined
        const height = Number(payload?.height)
        if (Number.isFinite(height) && height > 0) el.style.height = `${clampCardBridgeHeight(height + 8)}px`
      }
      const domRequest = request.type === 'dom.query' || request.type === 'dom.text' || request.type === 'dom.class'
      if (domRequest && onBridgeRequest == null) {
        const payload = request.payload as { selector?: unknown; value?: unknown } | undefined
        const selector = typeof payload?.selector === 'string' ? payload.selector.trim() : ''
        if (!selector || selector.length > 128 || /[{};]/.test(selector)) {
          el.contentWindow?.postMessage(createCardBridgeResponse(request, { ok: false, error: 'Invalid DOM selector' }), '*')
          return
        }
        const nodes = Array.from(el.contentDocument?.querySelectorAll(selector) ?? []).slice(0, 32)
        if (request.type === 'dom.query') {
          const elements = nodes.map((node) => ({
            text: (node.textContent ?? '').slice(0, 2000),
            className: node instanceof HTMLElement ? node.className : '',
            attributes: Object.fromEntries(Array.from(node.attributes).slice(0, 32).map((attribute) => [attribute.name, attribute.value.slice(0, 500)])),
          }))
          el.contentWindow?.postMessage(createCardBridgeResponse(request, { ok: true, value: { selector, count: nodes.length, elements } }), '*')
          return
        }
        if (request.type === 'dom.text') {
          const value = typeof payload?.value === 'string' ? payload.value.slice(0, 8000) : ''
          nodes.forEach((node) => { node.textContent = value })
        } else {
          const value = typeof payload?.value === 'string' ? payload.value.slice(0, 500) : ''
          nodes.forEach((node) => { if (node instanceof HTMLElement) node.className = value })
        }
        fitFrame()
        el.contentWindow?.postMessage(createCardBridgeResponse(request, { ok: true, value: { accepted: true, selector, count: nodes.length } }), '*')
        return
      }
      if (request.type === 'event.subscribe' && !onBridgeRequest) {
        const payload = request.payload as { events?: unknown } | undefined
        const eventNames = Array.isArray(payload?.events)
          ? payload.events.filter((name): name is Parameters<typeof tavernRuntime.events.on>[0] => typeof name === 'string')
          : []
        for (const eventName of eventNames) {
          const unsubscribe = tavernRuntime.events.on(eventName, (frameEvent) => {
            el.contentWindow?.postMessage({
              protocol: 'drawdream-tavern-frame',
              version: 1,
              frameId: effectiveFrameId,
              type: 'event',
              event: frameEvent.type,
              sequence: frameEvent.sequence,
              sessionRevision: frameEvent.sessionRevision,
              payload: frameEvent.payload,
            }, '*')
          })
          eventUnsubscribers.push(unsubscribe)
        }
      }
      const handler = onBridgeRequest ?? ((value: CardBridgeRequest) => tavernRuntime.handle(value))
      try {
        const value = await handler(request)
        el.contentWindow?.postMessage(createCardBridgeResponse(request, { ok: true, value }), '*')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        el.contentWindow?.postMessage(createCardBridgeResponse(request, { ok: false, error: message }), '*')
      }
    }
    window.addEventListener('message', onMessage)
    const fit = () => {
      try {
        const doc = el.contentDocument
        const h = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight || 0
        if (h > 0) el.style.height = `${clampCardBridgeHeight(h + 8)}px`
      } catch {
        /* sandbox 无 same-origin */
      }
    }
    const fitFrame = fit
    el.addEventListener('load', fit)
    const t = window.setTimeout(fit, 120)
    return () => {
      for (const unsubscribe of eventUnsubscribers) unsubscribe()
      window.removeEventListener('message', onMessage)
      el.removeEventListener('load', fit)
      window.clearTimeout(t)
    }
  }, [srcDoc, effectiveFrameId, effectiveCapabilityToken, effectiveCapabilities, onBridgeRequest])


  return (
    <iframe
      ref={ref}
      className={`rp-html-frame ${className}`.trim()}
      title={title}
      sandbox={scripts ? 'allow-scripts' : ''}
      srcDoc={srcDoc}
       style={{
        width: '100%',
        border: 0,
        display: 'block',
        minHeight: 48,
         background: 'transparent',
         touchAction: runtimeManifest?.mobile.touchEvents ? 'manipulation' : undefined,
         paddingBottom: runtimeManifest?.mobile.safeArea ? 'env(safe-area-inset-bottom)' : undefined,
       }}
    />
  )
}
