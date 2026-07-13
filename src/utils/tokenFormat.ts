function trimNumber(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function fixed(value: number, digits: number): string {
  return trimNumber(value.toFixed(digits))
}

export function formatTokenRaw(value: number | null | undefined): string {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('zh-CN')
}

export function formatTokenZh(value: number | null | undefined): string {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n <= 0) return '0'

  if (n >= 100_000_000) return `${fixed(n / 100_000_000, n >= 1_000_000_000 ? 1 : 2)} 亿`
  if (n >= 10_000_000) return `${fixed(n / 10_000_000, 2)} 千万`
  if (n >= 10_000) return `${fixed(n / 10_000, 1)} 万`
  return Math.round(n).toLocaleString('zh-CN')
}

export function formatTokenTenMillion(value: number | null | undefined): string {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 10_000_000) return `${fixed(n / 10_000_000, 2)} 千万`
  return formatTokenZh(n)
}

export function formatTokenZhWithRaw(value: number | null | undefined): string {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n <= 0) return '0 token'
  return `${formatTokenZh(n)} token（${formatTokenRaw(n)}）`
}
