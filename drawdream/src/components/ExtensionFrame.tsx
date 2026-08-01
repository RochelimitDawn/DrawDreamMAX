import { useEffect, useMemo, useRef, useState } from 'react'
import { apiGet } from '../agent/rest'
import {
  extensionBridgeBootstrap,
  EXTENSION_BRIDGE_PROTOCOL,
  type ExtensionBridgeRequest,
} from '../tavern/compat/extension-bridge'
import { handleExtensionRuntimeRequest } from '../tavern/compat/extension-runtime'
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

export function ExtensionFrame({
  extension,
  onError,
}: {
  extension: InstalledExtension
  onError?: (message: string) => void
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const frameId = useMemo(() => `extension-${extension.id}-${Math.random().toString(36).slice(2)}`, [extension.id])
  const token = useMemo(() => crypto.randomUUID(), [])
  const [sources, setSources] = useState<{ js: string; css: string } | null>(null)
  const [height, setHeight] = useState(420)

  useEffect(() => {
    let active = true
    Promise.all([
      extension.js
        ? fetch(`/api/extensions/file?id=${encodeURIComponent(extension.id)}&path=${encodeURIComponent(extension.js)}`).then((response) => {
            if (!response.ok) throw new Error(`扩展脚本加载失败：${extension.js}`)
            return response.text()
          })
        : Promise.resolve(''),
      extension.css
        ? fetch(`/api/extensions/file?id=${encodeURIComponent(extension.id)}&path=${encodeURIComponent(extension.css)}`).then((response) => {
            if (!response.ok) throw new Error(`扩展样式加载失败：${extension.css}`)
            return response.text()
          })
        : Promise.resolve(''),
    ])
      .then(([js, css]) => {
        if (active) setSources({ js, css })
      })
      .catch((error) => onError?.(error instanceof Error ? error.message : String(error)))
    return () => {
      active = false
    }
  }, [extension, onError])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const unsubscribers: Array<() => void> = []
    const onMessage = async (event: MessageEvent<unknown>) => {
      if (event.source !== el.contentWindow || !event.data || typeof event.data !== 'object') return
      const request = event.data as Partial<ExtensionBridgeRequest>
      if (
        request.protocol !== EXTENSION_BRIDGE_PROTOCOL ||
        request.frameId !== frameId ||
        request.token !== token ||
        !request.requestId ||
        !request.type
      ) return
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
          type: request.type,
          payload: request.payload,
        })
        el.contentWindow?.postMessage({
          protocol: EXTENSION_BRIDGE_PROTOCOL,
          frameId,
          requestId: request.requestId,
          ok: true,
          value,
        }, '*')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        el.contentWindow?.postMessage({
          protocol: EXTENSION_BRIDGE_PROTOCOL,
          frameId,
          requestId: request.requestId,
          ok: false,
          error: message,
        }, '*')
        onError?.(message)
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
      window.removeEventListener('message', onMessage)
    }
  }, [extension.id, frameId, onError, token])

  const capabilities = [...new Set([...FULL_CAPABILITIES, ...(extension.capabilities as CardBridgeCapability[])])]
  const srcDoc = sources
    ? `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data: https:;"><style>html,body{margin:0;background:transparent;color:inherit;font:inherit}#drawdream-extension-root{min-height:100%}</style><style>${sources.css}</style></head><body><div id="drawdream-extension-root" data-extension-id="${extension.id}"></div>${extensionBridgeBootstrap({ frameId, token, capabilities })}<script>${sources.js}</script></body></html>`
    : '<!doctype html><html><body style="font:14px/1.5 system-ui;color:#748094;padding:24px">正在加载扩展...</body></html>'

  return (
    <iframe
      ref={ref}
      title={extension.displayName}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ width: '100%', minHeight: height, height, border: 0, display: 'block', background: 'transparent' }}
    />
  )
}

export function useInstalledExtensions() {
  return apiGet<{ extensions: InstalledExtension[] }>('/api/extensions', { bypassCache: true })
}
