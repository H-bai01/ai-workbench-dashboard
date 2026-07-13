export function clampPercentage(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.min(100, Math.max(0, Math.round(numeric)))
}

export function percentageOf(part, total) {
  const safePart = Math.max(0, Number(part) || 0)
  const safeTotal = Math.max(0, Number(total) || 0)
  if (safeTotal <= 0) return 0
  return clampPercentage((safePart / safeTotal) * 100)
}

export function modelTokenPercentages(rows) {
  const total = (rows || []).reduce((sum, row) => sum + Math.max(0, Number(row?.tokens) || 0), 0)
  return (rows || []).map((row) => ({
    ...row,
    pct: percentageOf(row?.tokens, total),
  }))
}
