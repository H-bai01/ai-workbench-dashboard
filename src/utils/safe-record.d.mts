export type SafeRecord<T> = Record<string, T>
export function createSafeRecord<T>(): SafeRecord<T>
export function safeRecordFrom<T>(source?: Record<string, T> | null): SafeRecord<T>
export function ownValue<T>(source: Record<string, T> | null | undefined, key: string): T | undefined
export function ensureSafeValue<T>(source: SafeRecord<T>, key: string, factory: () => T): T
