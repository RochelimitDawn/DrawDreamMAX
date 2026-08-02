import { useEffect, useMemo, useRef, useState } from 'react'
import {
  extensionBridgeBootstrap,
  EXTENSION_BRIDGE_PROTOCOL,
} from '../tavern/compat/extension-bridge'
import { handleExtensionRuntimeRequest, type ExtensionRuntimeRequestType } from '../tavern/compat/extension-runtime'
import { tavernRuntime } from '../tavern/runtime-adapter'
import type { CardBridgeCapability } from '../utils/cardBridge'

type InstalledExtension = {
  id: string
  displayName: string
  version: string
  root: string
  js: string | null
  css: string | null
  capabilities: string[]
  runtimeStatus: string
  archiveSha256: string
}

const FULL_CAPABILITIES: CardBridgeCapability[] = [
  'context.read',
  'variables.read',
  'variables.write',
  'messages.send',
  'messages.update',
  'events.subscribe',
  'assets.read',
  'card.ui',
  'external.module',
  'slash.execute',
]

function safeUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}

export function ExtensionFrame({
  extension,
  onError,
}: {
  extension: InstalledExtension
  onError?: (message: string) => void
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const frameId = useMemo(() => `extension-${extension.id}-${Math.random().toString(36).slice(2)}`, [extension.id])
  const token = useMemo(() => safeUUID(), [])
  const [sources, setSources] = useState<{ js: string; css: string } | null>(null)
  const [height, setHeight] = useState(420)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [runtimeLog, setRuntimeLog] = useState<string[]>([])
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const log = (message: string): void => {
    console.log(`[ExtensionFrame:${extension.id}]`, message)
    setRuntimeLog((prev) => [...prev.slice(-9), `${new Date().toLocaleTimeString()} ${message}`])
  }

  useEffect(() => {
    let active = true
    setSources(null)
    setLoadError(null)
    log(`loading js=${extension.js ?? 'none'} css=${extension.css ?? 'none'}`)
    Promise.all([
      extension.js
        ? fetch(`/api/extensions/file?id=${encodeURIComponent(extension.id)}&path=${encodeURIComponent(extension.js)}`).then((response) => {
            if (!response.ok) throw new Error(`JS ${response.status}: ${extension.js}`)
            return response.text()
          })
        : Promise.resolve(''),
      extension.css
        ? fetch(`/api/extensions/file?id=${encodeURIComponent(extension.id)}&path=${encodeURIComponent(extension.css)}`).then((response) => {
            if (!response.ok) throw new Error(`CSS ${response.status}: ${extension.css}`)
            return response.text()
          })
        : Promise.resolve(''),
    ])
      .then(([js, css]) => {
        if (!active) return
        log(`loaded js=${js.length}b css=${css.length}b`)
        setSources({ js, css })
      })
      .catch((error) => {
        if (!active) return
        const message = error instanceof Error ? error.message : String(error)
        log(`load error: ${message}`)
        setLoadError(message)
        onErrorRef.current?.(message)
      })
    return () => {
      active = false
    }
  }, [extension.id, extension.js, extension.css])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const unsubscribers: Array<() => void> = []
    const onMessage = async (event: MessageEvent<unknown>) => {
      if (event.source !== el.contentWindow || !event.data || typeof event.data !== 'object') return
      const request = event.data as { protocol?: string; frameId?: string; token?: string; requestId?: string; type?: string; payload?: unknown }
      if (
        request.protocol !== EXTENSION_BRIDGE_PROTOCOL ||
        request.frameId !== frameId ||
        request.token !== token ||
        !request.type
      ) return
      if (request.type === 'extension.error') {
        const errorMsg = String((request.payload as { message?: unknown } | undefined)?.message ?? 'Unknown error')
        log(`extension error: ${errorMsg}`)
        setLoadError(`Extension script error: ${errorMsg}`)
        return
      }
      if (!request.requestId) return
      log(`request: ${request.type}`)
      try {
        if (request.type === 'event.subscribe') {
          const events = Array.isArray((request.payload as { events?: unknown } | undefined)?.events)
            ? ((request.payload as { events: unknown[] }).events.filter((name): name is Parameters<typeof tavernRuntime.events.on>[0] => typeof name === 'string'))
            : []
          for (const eventName of events) {
            const unsubscribe = tavernRuntime.events.on(eventName, (frameEvent) => {
              el.contentWindow?.postMessage({
                protocol: EXTENSION_BRIDGE_PROTOCOL,
                frameId,
                type: 'event',
                event: frameEvent.type,
                sequence: frameEvent.sequence,
                sessionRevision: frameEvent.sessionRevision,
                payload: frameEvent.payload,
              }, '*')
            })
            unsubscribers.push(unsubscribe)
          }
          el.contentWindow?.postMessage({
            protocol: EXTENSION_BRIDGE_PROTOCOL,
            frameId,
            requestId: request.requestId,
            ok: true,
            value: { subscribed: true, events },
          }, '*')
          return
        }
        if (request.type === 'parent.resize') {
          const next = Number((request.payload as { height?: unknown } | undefined)?.height)
          if (Number.isFinite(next) && next > 0) setHeight(Math.max(240, Math.min(2400, Math.round(next))))
          el.contentWindow?.postMessage({
            protocol: EXTENSION_BRIDGE_PROTOCOL,
            frameId,
            requestId: request.requestId,
            ok: true,
            value: { accepted: true },
          }, '*')
          return
        }
        const value = await handleExtensionRuntimeRequest({
          type: request.type as ExtensionRuntimeRequestType,
          payload: request.payload,
        })
        log(`response: ${request.type} ok`)
        el.contentWindow?.postMessage({
          protocol: EXTENSION_BRIDGE_PROTOCOL,
          frameId,
          requestId: request.requestId,
          ok: true,
          value,
        }, '*')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`error: ${request.type} -> ${message}`)
        el.contentWindow?.postMessage({
          protocol: EXTENSION_BRIDGE_PROTOCOL,
          frameId,
          requestId: request.requestId,
          ok: false,
          error: message,
        }, '*')
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
      window.removeEventListener('message', onMessage)
    }
  }, [extension.id, frameId, token])

  const capabilities = [...new Set([...FULL_CAPABILITIES, ...(extension.capabilities as CardBridgeCapability[])])]

  const errorReporter = `window.addEventListener('error',function(e){parent.postMessage({protocol:${JSON.stringify(EXTENSION_BRIDGE_PROTOCOL)},frameId:${JSON.stringify(frameId)},token:${JSON.stringify(token)},type:'extension.error',payload:{message:String(e&&e.message||e)+' @ '+(e&&e.filename||'')+':'+(e&&e.lineno||0)}},'*')});window.addEventListener('unhandledrejection',function(e){parent.postMessage({protocol:${JSON.stringify(EXTENSION_BRIDGE_PROTOCOL)},frameId:${JSON.stringify(frameId)},token:${JSON.stringify(token)},type:'extension.error',payload:{message:'Unhandled promise rejection: '+String(e&&e.reason&&(e.reason.message||e.reason)||e.reason||e)}},'*')});`

  const srcDoc = sources
    ? `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* http://localhost:*; img-src data: https: http:; font-src data:"><style>html,body{margin:0;background:transparent;color:inherit;font:inherit}#drawdream-extension-root{min-height:100%}</style><style>${sources.css}</style></head><body><div id="drawdream-extension-root" data-extension-id="${extension.id}"></div>${extensionBridgeBootstrap({ frameId, token, capabilities })}<script>${errorReporter}try{${sources.js}}catch(e){console.error('[ExtensionJS]',e);parent.postMessage({protocol:${JSON.stringify(EXTENSION_BRIDGE_PROTOCOL)},frameId:${JSON.stringify(frameId)},token:${JSON.stringify(token)},type:'extension.error',payload:{message:String(e&&e.message||e)}},'*')}</script></body></html>`
    : '<!doctype html><html><body style="font:14px/1.5 system-ui;color:#748094;padding:24px">Loading extension...</body></html>'

  if (loadError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        <div style={{ padding: 24, color: '#a33', fontSize: 14, lineHeight: 1.6 }}>
          <strong>Extension error</strong>
          <p style={{ marginTop: 8, wordBreak: 'break-all' }}>{loadError}</p>
          <p style={{ marginTop: 8, color: '#748094' }}>js: {extension.js ?? 'none'} | css: {extension.css ?? 'none'}</p>
        </div>
        {runtimeLog.length > 0 && (
          <details style={{ borderTop: '1px solid #edf0f4', padding: '8px 12px', fontSize: 11, color: '#748094', maxHeight: 120, overflow: 'auto' }} open>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Runtime log ({runtimeLog.length})</summary>
            {runtimeLog.map((line, i) => <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>)}
          </details>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <iframe
        ref={ref}
        title={extension.displayName}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        style={{ width: '100%', minHeight: height, height, border: 0, display: 'block', background: 'transparent', flex: 1 }}
      />
      {runtimeLog.length > 0 && (
        <details style={{ borderTop: '1px solid #edf0f4', padding: '8px 12px', fontSize: 11, color: '#748094', maxHeight: 120, overflow: 'auto' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Runtime log ({runtimeLog.length})</summary>
          {runtimeLog.map((line, i) => <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>)}
        </details>
      )}
    </div>
  )
}
