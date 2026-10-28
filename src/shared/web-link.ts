export const WEB_LINK_HEADER = 'Link_form|Nhóm|Link_web|Status_link'
export const WEB_LINK_STATUS_ACTIVE = 'Hoạt động'
export const WEB_LINK_STATUS_INACTIVE = 'Không hoạt động'
export const WEB_LINKS_MAX_UNIQUE = 400

export type WebLinkCheckTarget = 'web' | 'form'
export type WebLinkUrlField = 'linkWeb' | 'linkForm'
export type WebLinkInactiveReason = 'netlify_not_found' | 'dangerous_site' | 'google_tos_violation'

export const WEB_LINK_REASON_LABEL: Record<WebLinkInactiveReason, string> = {
  netlify_not_found: 'Site not found (Netlify) — site đã gỡ hoặc sai URL',
  dangerous_site: 'Trang web nguy hiểm — trình duyệt chặn truy cập',
  google_tos_violation: 'Link_form vi phạm Điều khoản Google Drive/Form — không truy cập được'
}

export interface WebLinkRow {
  lineIndex: number
  raw: string
  blank: boolean
  isHeader: boolean
  linkForm: string
  group: string
  linkWeb: string
  status: string
  extra: string[]
}

export interface WebLinkPageSnapshot {
  finalUrl: string
  statusCode: number
  title: string
  bodyText: string
  html: string
}

export interface WebLinkClassification {
  verdict: 'active' | 'inactive'
  reason: WebLinkInactiveReason | null
}

export interface WebLinkWarning {
  key: string
  linkForm: string
  group: string
  linkWeb: string
  reason: WebLinkInactiveReason
  reasonLabel: string
  rows: number
}

export interface WebLinkCheckProgress {
  done: number
  total: number
  url: string
  verdict: 'active' | 'inactive' | 'error' | 'skipped'
  reason?: WebLinkInactiveReason | null
}

export interface WebLinkCheckResult {
  target: WebLinkCheckTarget
  text: string
  uniqueChecked: number
  active: number
  inactive: number
  errors: number
  skipped: number
  cancelled: boolean
  safeBrowsingChecked: boolean
  warnings: WebLinkWarning[]
}

export function isWebLinkHeaderLine(line: string): boolean {
  const parts = line.split('|').map((p) => p.trim().toLowerCase().replace(/\s+/g, '_'))
  if (parts.length < 3) return false
  const joined = parts.join('|')
  return (
    (parts[0] === 'link_form' || parts[0] === 'linkform') &&
    (parts[2] === 'link_web' || parts[2] === 'linkweb' || joined.includes('link_web'))
  )
}

export function parseWebLinkLine(raw: string, lineIndex: number): WebLinkRow {
  const line = raw.replace(/^\uFEFF/, '')
  if (!line.trim()) {
    return {
      lineIndex,
      raw: line,
      blank: true,
      isHeader: false,
      linkForm: '',
      group: '',
      linkWeb: '',
      status: '',
      extra: []
    }
  }
  if (isWebLinkHeaderLine(line)) {
    const parts = line.split('|')
    return {
      lineIndex,
      raw: line,
      blank: false,
      isHeader: true,
      linkForm: parts[0] ?? '',
      group: parts[1] ?? '',
      linkWeb: parts[2] ?? '',
      status: parts[3] ?? '',
      extra: parts.slice(4)
    }
  }
  const parts = line.split('|')
  return {
    lineIndex,
    raw: line,
    blank: false,
    isHeader: false,
    linkForm: (parts[0] ?? '').trim(),
    group: (parts[1] ?? '').trim(),
    linkWeb: (parts[2] ?? '').trim(),
    status: (parts[3] ?? '').trim(),
    extra: parts.slice(4)
  }
}

export function parseWebLinkText(text: string): WebLinkRow[] {
  return (text ?? '').split(/\r?\n/).map((line, index) => parseWebLinkLine(line, index))
}

export function htmlToPlainText(html: string): string {
  return (html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function ensureHttpUrl(raw: string): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^\/\//.test(trimmed)) return `https:${trimmed}`
  return `https://${trimmed}`
}

export function normalizeWebUrl(raw: string): string {
  const withScheme = ensureHttpUrl(raw)
  if (!withScheme) return ''
  try {
    const url = new URL(withScheme)
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    if (url.pathname === '/') {
      url.pathname = ''
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return withScheme.replace(/\/+$/, '').toLowerCase()
  }
}

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const n = m.slice(1).map((x) => Number(x))
  if (n.some((p) => p > 255)) return false
  const a = n[0]
  const b = n[1]
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

export function isPublicHttpUrl(raw: string): boolean {
  const withScheme = ensureHttpUrl(raw)
  if (!withScheme) return false
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (!host) return false
    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return false
    if (host === 'metadata.google.internal' || host.endsWith('.internal')) return false
    if (isPrivateIPv4(host)) return false
    return true
  } catch {
    return false
  }
}

export function collectUniqueUrls(rows: WebLinkRow[], field: WebLinkUrlField): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of rows) {
    if (row.blank || row.isHeader) continue
    const raw = field === 'linkForm' ? row.linkForm : row.linkWeb
    const key = normalizeWebUrl(raw)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(raw.trim())
  }
  return out
}

export function collectUniqueWebUrls(rows: WebLinkRow[]): string[] {
  return collectUniqueUrls(rows, 'linkWeb')
}

export function collectUniqueFormUrls(rows: WebLinkRow[]): string[] {
  return collectUniqueUrls(rows, 'linkForm')
}

export function pageLooksDangerous(snapshot: WebLinkPageSnapshot): boolean {
  const blob = [
    snapshot.finalUrl,
    snapshot.title,
    snapshot.bodyText,
    snapshot.html
  ]
    .join('\n')
    .toLowerCase()

  if (blob.includes('chrome-error://chromewebdata')) return true
  if (blob.includes('interstitial-wrapper')) return true
  if (blob.includes('visited-page-is-dangerous')) return true
  if (blob.includes('safebrowsing-interstitial')) return true
  if (blob.includes('trang web nguy hiểm') || blob.includes('trang web nguy hiem')) return true
  if (blob.includes('quay lại trang an toàn') || blob.includes('quay lai trang an toan')) return true
  if (blob.includes('deceptive site ahead')) return true
  if (/\bdangerous site\b/.test(blob)) return true
  if (blob.includes('attackers on the site')) return true
  if (blob.includes('kẻ tấn công trên trang web') || blob.includes('ke tan cong tren trang web')) {
    return true
  }
  if (blob.includes('those on the site you') && blob.includes('trick you')) return true
  return false
}

export function pageLooksNetlifyMissing(snapshot: WebLinkPageSnapshot): boolean {
  const blob = [
    snapshot.finalUrl,
    snapshot.title,
    snapshot.bodyText,
    snapshot.html
  ]
    .join('\n')
    .toLowerCase()

  if (blob.includes('netlify internal id')) return true
  if (blob.includes("doesn't exist on netlify") || blob.includes('does not exist on netlify')) {
    return true
  }
  if (blob.includes('broken link or entered a url that doesn')) return true
  if (blob.includes('looks like you followed a broken link') && blob.includes('netlify')) return true
  if (/\bsite not found\b/.test(blob) && blob.includes('netlify')) return true
  const onNetlifyHost = /netlify\.app|netlify\.com/.test(snapshot.finalUrl.toLowerCase())
  if (onNetlifyHost && snapshot.statusCode === 404) return true
  return false
}

export function pageLooksGoogleTosViolation(snapshot: WebLinkPageSnapshot): boolean {
  const blob = htmlToPlainText(
    [snapshot.finalUrl, snapshot.title, snapshot.bodyText, snapshot.html].join('\n')
  ).toLowerCase()

  if (blob.includes('in violation of our terms of service')) return true
  if (blob.includes('violation of our terms of service')) return true
  if (blob.includes('access this item') && blob.includes('terms of service') && blob.includes('violation')) {
    return true
  }
  if (blob.includes("can't access this item because it is in violation")) return true
  if (blob.includes('cannot access this item because it is in violation')) return true
  if (blob.includes('you can’t access this item because it is in violation')) return true
  if (blob.includes('vi phạm điều khoản dịch vụ')) return true
  if (
    (blob.includes('không thể truy cập mục này') ||
      blob.includes('không thể truy cập vào mục này')) &&
    (blob.includes('điều khoản') || blob.includes('vi phạm'))
  ) {
    return true
  }
  if (blob.includes("we're sorry") && blob.includes('terms of service') && blob.includes('google')) {
    return true
  }
  return false
}

export function classifyWebLinkPage(snapshot: WebLinkPageSnapshot): WebLinkClassification {
  if (pageLooksDangerous(snapshot)) {
    return { verdict: 'inactive', reason: 'dangerous_site' }
  }
  if (pageLooksNetlifyMissing(snapshot)) {
    return { verdict: 'inactive', reason: 'netlify_not_found' }
  }
  return { verdict: 'active', reason: null }
}

export function classifyFormLinkPage(snapshot: WebLinkPageSnapshot): WebLinkClassification {
  if (pageLooksGoogleTosViolation(snapshot)) {
    return { verdict: 'inactive', reason: 'google_tos_violation' }
  }
  return { verdict: 'active', reason: null }
}

export function applyWebLinkStatuses(
  text: string,
  statusByNormalizedUrl: Map<string, string>,
  field: WebLinkUrlField = 'linkWeb'
): string {
  const lines = (text ?? '').split(/\r?\n/)
  return lines
    .map((line, index) => {
      const row = parseWebLinkLine(line, index)
      if (row.blank || row.isHeader) return line
      const raw = field === 'linkForm' ? row.linkForm : row.linkWeb
      const key = normalizeWebUrl(raw)
      if (!key) return line
      const nextStatus = statusByNormalizedUrl.get(key)
      if (!nextStatus) return line
      const parts = line.split('|')
      if (parts.length < 3) return line
      if (parts.length === 3) return `${line}|${nextStatus}`
      parts[3] = nextStatus
      return parts.join('|')
    })
    .join('\n')
}

export function summarizeInactiveWarnings(
  rows: WebLinkRow[],
  reasonByNormalizedUrl: Map<string, WebLinkInactiveReason>,
  field: WebLinkUrlField = 'linkWeb'
): WebLinkWarning[] {
  const grouped = new Map<string, WebLinkWarning>()
  for (const row of rows) {
    if (row.blank || row.isHeader) continue
    const raw = field === 'linkForm' ? row.linkForm : row.linkWeb
    const key = normalizeWebUrl(raw)
    const reason = reasonByNormalizedUrl.get(key)
    if (!reason) continue
    const existing = grouped.get(key)
    if (existing) {
      existing.rows += 1
      continue
    }
    grouped.set(key, {
      key,
      linkForm: row.linkForm,
      group: row.group,
      linkWeb: row.linkWeb,
      reason,
      reasonLabel: WEB_LINK_REASON_LABEL[reason],
      rows: 1
    })
  }
  return [...grouped.values()].sort(
    (a, b) =>
      a.group.localeCompare(b.group, 'vi') ||
      (field === 'linkForm' ? a.linkForm : a.linkWeb).localeCompare(
        field === 'linkForm' ? b.linkForm : b.linkWeb
      )
  )
}

export function classifyAnyLinkPage(snapshot: WebLinkPageSnapshot): WebLinkClassification {
  const form = classifyFormLinkPage(snapshot)
  if (form.verdict === 'inactive') return form
  return classifyWebLinkPage(snapshot)
}

export type UrlLineVerdict = 'valid' | 'error' | 'skipped'
export type UrlLineErrorCode = WebLinkInactiveReason | 'invalid_url' | 'unreachable' | 'http_error'
export type UrlCheckRole = 'form' | 'web'
export type UrlListCheckTarget = 'all' | UrlCheckRole

export const URL_LINE_ERROR_LABEL: Record<UrlLineErrorCode, string> = {
  netlify_not_found: WEB_LINK_REASON_LABEL.netlify_not_found,
  dangerous_site: WEB_LINK_REASON_LABEL.dangerous_site,
  google_tos_violation: WEB_LINK_REASON_LABEL.google_tos_violation,
  invalid_url: 'URL không hợp lệ',
  unreachable: 'Không truy cập được (mạng, DNS hoặc hết thời gian chờ)',
  http_error: 'Máy chủ trả về lỗi HTTP'
}

export interface UrlCheckItem {
  url: string
  role: UrlCheckRole
}

export interface UrlListLine {
  line: number
  raw: string
  url: string
  urls: UrlCheckItem[]
  blank: boolean
}

export interface UrlLineResult {
  line: number
  raw: string
  url: string
  verdict: UrlLineVerdict
  errorCode?: UrlLineErrorCode
  errorLabel?: string
  formError: boolean
  webError: boolean
}

export interface UrlListCheckResult {
  lines: UrlLineResult[]
  valid: number
  error: number
  skipped: number
  formError: number
  webError: number
  uniqueChecked: number
  cancelled: boolean
  target: UrlListCheckTarget
}

export interface UrlProbeVerdict {
  verdict: 'valid' | 'error'
  errorCode?: UrlLineErrorCode
  errorLabel?: string
}

export function looksLikeHttpUrl(value: string): boolean {
  const v = (value ?? '').trim()
  if (!v || /[\s<>]/.test(v)) return false
  if (v.includes('|')) return false
  return isPublicHttpUrl(v)
}

export function inferUrlCheckRole(url: string): UrlCheckRole {
  const u = (url ?? '').toLowerCase()
  if (u.includes('forms.gle') || u.includes('docs.google.com/forms') || u.includes('google.com/forms')) {
    return 'form'
  }
  return 'web'
}

/** Tách URL từ một dòng: URL thuần, hoặc Link_form|Nhóm|Link_web. */
export function extractCheckUrlsFromLine(raw: string): UrlCheckItem[] {
  const line = (raw ?? '').trim()
  if (!line || isWebLinkHeaderLine(line)) return []

  if (line.includes('|')) {
    const parts = line.split('|').map((part) => part.trim())
    if (parts.length >= 3 && looksLikeHttpUrl(parts[0]) && looksLikeHttpUrl(parts[2])) {
      return [
        { url: parts[0], role: 'form' },
        { url: parts[2], role: 'web' }
      ]
    }
    const fromParts = parts
      .filter((part) => looksLikeHttpUrl(part))
      .map((url) => ({ url, role: inferUrlCheckRole(url) }))
    if (fromParts.length) return fromParts
  }

  if (looksLikeHttpUrl(line)) return [{ url: line, role: inferUrlCheckRole(line) }]
  return []
}

export function parseUrlListLines(text: string): UrlListLine[] {
  const out: UrlListLine[] = []
  const rawLines = (text ?? '').split(/\r?\n/)
  let lineNo = 0
  for (const raw of rawLines) {
    lineNo += 1
    if (!raw.trim()) {
      out.push({ line: lineNo, raw, url: '', urls: [], blank: true })
      continue
    }
    const urls = extractCheckUrlsFromLine(raw)
    out.push({
      line: lineNo,
      raw,
      url: urls[0]?.url ?? raw.trim(),
      urls,
      blank: false
    })
  }
  return out
}

export function collectUniqueCheckItems(
  lines: UrlListLine[],
  target: UrlListCheckTarget = 'all'
): UrlCheckItem[] {
  const seen = new Set<string>()
  const out: UrlCheckItem[] = []
  for (const row of lines) {
    if (row.blank) continue
    for (const item of row.urls) {
      if (target !== 'all' && item.role !== target) continue
      const key = normalizeWebUrl(item.url)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

export function collectUniquePlainUrls(
  lines: UrlListLine[],
  target: UrlListCheckTarget = 'all'
): string[] {
  return collectUniqueCheckItems(lines, target).map((item) => item.url)
}

export function httpErrorLabel(statusCode: number): string {
  return `Máy chủ trả về HTTP ${statusCode}`
}

/** 400/401/403/429 thường là Google chặn bot, cần mở Chrome mới thấy trang thật. */
export function httpStatusNeedsBrowser(statusCode: number): boolean {
  return statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 429
}

export function classifySnapshotToProbe(
  snapshot: WebLinkPageSnapshot,
  role: UrlCheckRole | 'all' = 'all'
): UrlProbeVerdict {
  const hit =
    role === 'form'
      ? classifyFormLinkPage(snapshot)
      : role === 'web'
        ? classifyWebLinkPage(snapshot)
        : classifyAnyLinkPage(snapshot)
  if (hit.verdict === 'inactive' && hit.reason) {
    return {
      verdict: 'error',
      errorCode: hit.reason,
      errorLabel: WEB_LINK_REASON_LABEL[hit.reason]
    }
  }
  // 400/401/403 thường do chặn bot, không đủ để kết luận link chết.
  if (snapshot.statusCode === 404 || snapshot.statusCode === 410 || snapshot.statusCode >= 500) {
    return {
      verdict: 'error',
      errorCode: 'http_error',
      errorLabel: httpErrorLabel(snapshot.statusCode)
    }
  }
  return { verdict: 'valid' }
}

function emptyLineFlags(): Pick<UrlLineResult, 'formError' | 'webError'> {
  return { formError: false, webError: false }
}

function probeOneUrl(
  url: string,
  byNormalizedUrl: Map<string, UrlProbeVerdict>,
  cancelled: boolean
): UrlProbeVerdict | null {
  if (!isPublicHttpUrl(url)) {
    return {
      verdict: 'error',
      errorCode: 'invalid_url',
      errorLabel: URL_LINE_ERROR_LABEL.invalid_url
    }
  }
  const probed = byNormalizedUrl.get(normalizeWebUrl(url))
  if (!probed) {
    if (cancelled) return null
    return {
      verdict: 'error',
      errorCode: 'unreachable',
      errorLabel: URL_LINE_ERROR_LABEL.unreachable
    }
  }
  return probed
}

export function mapUrlListResults(
  lines: UrlListLine[],
  byNormalizedUrl: Map<string, UrlProbeVerdict>,
  target: UrlListCheckTarget = 'all',
  options?: { cancelled?: boolean }
): UrlLineResult[] {
  const cancelled = Boolean(options?.cancelled)
  return lines.map((row) => {
    if (row.blank || isWebLinkHeaderLine(row.raw)) {
      return {
        line: row.line,
        raw: row.raw,
        url: '',
        verdict: 'skipped' as const,
        ...emptyLineFlags()
      }
    }
    const items =
      target === 'all' ? row.urls : row.urls.filter((item) => item.role === target)
    if (items.length === 0) {
      if (row.urls.length > 0) {
        return {
          line: row.line,
          raw: row.raw,
          url: row.url,
          verdict: 'skipped' as const,
          ...emptyLineFlags()
        }
      }
      return {
        line: row.line,
        raw: row.raw,
        url: row.url,
        verdict: 'error',
        errorCode: 'invalid_url',
        errorLabel: URL_LINE_ERROR_LABEL.invalid_url,
        ...emptyLineFlags()
      }
    }
    let firstError: UrlProbeVerdict | null = null
    let formError = false
    let webError = false
    let sawUnchecked = false
    for (const item of items) {
      const hit = probeOneUrl(item.url, byNormalizedUrl, cancelled)
      if (!hit) {
        sawUnchecked = true
        continue
      }
      if (hit.verdict !== 'error') continue
      if (!firstError) firstError = hit
      if (item.role === 'form') formError = true
      if (item.role === 'web') webError = true
    }
    if (!firstError && sawUnchecked) {
      return {
        line: row.line,
        raw: row.raw,
        url: row.url,
        verdict: 'skipped' as const,
        ...emptyLineFlags()
      }
    }
    if (firstError) {
      return {
        line: row.line,
        raw: row.raw,
        url: row.url,
        verdict: 'error',
        errorCode: firstError.errorCode,
        errorLabel: firstError.errorLabel ?? URL_LINE_ERROR_LABEL.unreachable,
        formError,
        webError
      }
    }
    return {
      line: row.line,
      raw: row.raw,
      url: row.url,
      verdict: 'valid',
      ...emptyLineFlags()
    }
  })
}

export function summarizeUrlList(
  lines: UrlLineResult[]
): Pick<UrlListCheckResult, 'valid' | 'error' | 'skipped' | 'formError' | 'webError'> {
  let valid = 0
  let error = 0
  let skipped = 0
  let formError = 0
  let webError = 0
  for (const row of lines) {
    if (row.verdict === 'valid') valid += 1
    else if (row.verdict === 'error') error += 1
    else skipped += 1
    if (row.formError) formError += 1
    if (row.webError) webError += 1
  }
  return { valid, error, skipped, formError, webError }
}
