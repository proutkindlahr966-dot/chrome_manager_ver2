const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** Chỉ cho mở ra ngoài các liên kết web / mail. Chặn file:, javascript:, data:. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim())
    return ALLOWED_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}
