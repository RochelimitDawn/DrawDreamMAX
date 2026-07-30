export function formatCount(n: number, lang = 'zh'): string {
  if (n >= 1_000_000) {
    const v = (n / 1_000_000).toFixed(1)
    return lang.startsWith('zh') ? `${v}百万` : `${v}M`
  }
  if (n >= 10_000 && lang.startsWith('zh')) {
    return `${(n / 10_000).toFixed(1)}万`
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`
  }
  return String(n)
}
