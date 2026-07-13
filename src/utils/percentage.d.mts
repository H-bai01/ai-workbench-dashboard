export function clampPercentage(value: unknown): number
export function percentageOf(part: unknown, total: unknown): number
export function modelTokenPercentages<T extends { tokens?: number }>(rows: T[]): Array<T & { pct: number }>
