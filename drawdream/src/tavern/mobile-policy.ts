export const DRAW_DREAM_LOOPBACK_PORT = 7620

export function isDrawDreamLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      (url.port === '' || Number(url.port) === DRAW_DREAM_LOOPBACK_PORT)
  } catch {
    return false
  }
}

export function shouldOpenInExternalBrowser(value: string): boolean {
  return !isDrawDreamLoopbackUrl(value)
}
