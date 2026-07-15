const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * 将持续时间压缩为最多三个连续层级，避免工作台统计卡片过长。
 * 月和年用于持续时间展示，分别按 30 天和 365 天换算。
 */
export function formatUptime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '未知'

  const totalMinutes = Math.floor(ms / MINUTE_MS)
  if (totalMinutes < 1) return '< 1 分钟'
  if (ms < HOUR_MS) return `${totalMinutes}分钟`

  const totalHours = Math.floor(ms / HOUR_MS)
  const minutes = totalMinutes % 60
  if (ms < DAY_MS) return `${totalHours}小时${minutes}分钟`

  const totalDays = Math.floor(ms / DAY_MS)
  const hours = totalHours % 24
  if (totalDays < 7) return `${totalDays}天${hours}小时${minutes}分钟`

  if (totalDays < 30) {
    const weeks = Math.floor(totalDays / 7)
    const days = totalDays % 7
    return `${weeks}星期${days}天${hours}小时`
  }

  if (totalDays < 365) {
    const months = Math.floor(totalDays / 30)
    const remainingDays = totalDays % 30
    const weeks = Math.floor(remainingDays / 7)
    const days = remainingDays % 7
    return `${months}月${weeks}星期${days}天`
  }

  const years = Math.floor(totalDays / 365)
  const remainingDays = totalDays % 365
  const months = Math.floor(remainingDays / 30)
  const weeks = Math.floor((remainingDays % 30) / 7)
  return `${years}年${months}月${weeks}星期`
}
