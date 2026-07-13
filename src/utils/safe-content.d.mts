export function escapeHtml(value: unknown): string
export function normalizeControlledImageSource(value: unknown): string
export function normalizeSafeRasterDataUrl(value: unknown, decodeBase64?: (value: string) => string): string
export function sanitizeRichHtml(value: unknown): string
export function sanitizeHighlightHtml(value: unknown): string
export function renderSafeMarkdown(
  value: unknown,
  parse: (value: string) => string,
  sanitize?: (value: unknown) => string,
): string
export function createSafeContentSanitizer(windowLike: Window): {
  sanitizeRichHtml(value: unknown): string
  sanitizeHighlightHtml(value: unknown): string
}
