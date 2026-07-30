/** 复制到剪贴板：优先 Clipboard API，失败则 textarea + execCommand（兼容 iframe/非安全上下文） */

export async function copyText(text: string): Promise<void> {
  const value = String(text ?? '')
  if (!value) throw new Error('empty')

  // 1) 现代 API（需安全上下文 + 权限）
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value)
      return
    }
  } catch {
    // 落入回退
  }

  // 2) 选中已有只读 input（分享面板内）
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
  if (
    active &&
    (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') &&
    'value' in active &&
    String(active.value) === value
  ) {
    try {
      active.focus()
      active.select()
      if (typeof active.setSelectionRange === 'function') active.setSelectionRange(0, value.length)
      if (document.execCommand('copy')) return
    } catch {
      /* continue */
    }
  }

  // 3) 临时 textarea
  const ta = document.createElement('textarea')
  ta.value = value
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.width = '1px'
  ta.style.height = '1px'
  ta.style.padding = '0'
  ta.style.border = 'none'
  ta.style.outline = 'none'
  ta.style.boxShadow = 'none'
  ta.style.background = 'transparent'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  try {
    ta.setSelectionRange(0, value.length)
  } catch {
    /* iOS older */
  }
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    document.body.removeChild(ta)
  }
  if (!ok) throw new Error('copy failed')
}
