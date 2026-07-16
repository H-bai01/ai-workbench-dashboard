export type NotificationType = 'error' | 'aborted' | 'info'
export type NotificationRetryAction = 'refresh-token-usage' | 'prewarm-token-usage'

export interface NotificationItem {
  id: string
  type: NotificationType
  agentId: string
  agentName: string
  message: string
  timestamp: number
  read: boolean
  source?: string
  detail?: string
  errorCode?: string
  httpStatus?: number
  impact?: string
  currentResult?: string
  timeRange?: string
  retryAction?: NotificationRetryAction
}

export type NotificationInput = Omit<NotificationItem, 'id' | 'timestamp' | 'read'> & {
  id?: string
  timestamp?: number
  read?: boolean
}

export const NOTIFICATION_STORAGE_KEY: string
export const NOTIFICATION_MAX_ITEMS: number
export const NOTIFICATION_TTL_MS: number
export function sanitizeNotificationText(value: unknown, maxLength?: number): string
export function normalizeNotification(value: unknown, options?: { now?: number; createId?: boolean }): NotificationItem | null
export function loadPersistedNotifications(storage: Storage | null | undefined, now?: number): NotificationItem[]
export function persistNotifications(storage: Storage | null | undefined, notifications: NotificationItem[], now?: number): boolean
export function clearPersistedNotifications(storage: Storage | null | undefined): boolean
