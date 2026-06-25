/**
 * Converts the relative share URL stored in the backend ("/s/<token>") into an
 * absolute URL suitable for clipboard copy. Prepends window.location.origin
 * (e.g. "http://localhost:5173/s/abc123").
 */
export function toAbsoluteShareUrl(relativeUrl: string): string {
  return window.location.origin + relativeUrl
}
