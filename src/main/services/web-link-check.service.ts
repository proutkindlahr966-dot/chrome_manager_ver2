import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { BrowserWindow } from 'electron'
import { getDb } from '../db/database'
import { detectChromePath } from './chrome.service'
import { IPC } from '../../shared/ipc'
import { DEFAULT_USER_AGENT } from '../../shared/types'
import { getWebLinkCheckProfileDir, getWebLinksPath, migrateLegacyDataFile } from '../utils/paths'
import {
  applyWebLinkStatuses,
  classifyFormLinkPage,
  classifyWebLinkPage,
  classifySnapshotToProbe,
  collectUniqueUrls,
  collectUniqueCheckItems,
  ensureHttpUrl,
  htmlToPlainText,
  httpStatusNeedsBrowser,
  isPublicHttpUrl,
  mapUrlListResults,
  normalizeWebUrl,
  parseUrlListLines,
  parseWebLinkText,
  summarizeInactiveWarnings,
  summarizeUrlList,
  URL_LINE_ERROR_LABEL,
  WEB_LINK_STATUS_ACTIVE,
  WEB_LINK_STATUS_INACTIVE,
  WEB_LINKS_MAX_UNIQUE,
  type UrlCheckRole,
  type UrlListCheckResult,
  type UrlListCheckTarget,
  type UrlProbeVerdict,
  type WebLinkCheckTarget,
  type WebLinkClassification,
  type WebLinkCheckProgress,
  type WebLinkCheckResult,
  type WebLinkInactiveReason,
  type WebLinkPageSnapshot,
  type WebLinkUrlField
} from '../../shared/web-link'

const FETCH_TIMEOUT_MS = 12_000
const PAGE_TIMEOUT_MS = 16_000
const HTTP_CONCURRENCY = 4
const MAX_REDIRECTS = 6
const MAX_BODY = 400_000

let cancelled = false
let running = false

function ensureMigrated(): void {
  migrateLegacyDataFile('web-links.txt')
}

export function getWebLinksFilePath(): string {
  ensureMigrated()
  return getWebLinksPath()
}

export function loadWebLinks(): { content: string; path: string } {
  const filePath = getWebLinksFilePath()
  if (!existsSync(filePath)) return { content: '', path: filePath }
  try {
    return { content: readFileSync(filePath, 'utf-8'), path: filePath }
  } catch {
    return { content: '', path: filePath }
  }
}

export function saveWebLinks(content: string): { path: string; count: number } {
  const filePath = getWebLinksFilePath()
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, content ?? '', 'utf-8')
  const count = parseWebLinkText(content ?? '').filter((row) => !row.blank && !row.isHeader).length
  return { path: filePath, count }
}

export function cancelWebLinkCheck(): void {
  cancelled = true
}

function emitProgress(payload: WebLinkCheckProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.WEB_LINKS_PROGRESS, payload)
  }
}

function resolveChromePath(): string {
  const settings = getDb().getSettings()
  if (settings.chromePath && existsSync(settings.chromePath)) return settings.chromePath
  return detectChromePath()
}

function assertPublic(url: string): void {
  if (!isPublicHttpUrl(url)) {
    throw new Error('URL không hợp lệ hoặc không được phép kiểm tra')
  }
}

async function fetchWithRedirects(startUrl: string, signal: AbortSignal): Promise<WebLinkPageSnapshot> {
  let current = ensureHttpUrl(startUrl)
  for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
    assertPublic(current)
    const response = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi,en;q=0.8',
        'User-Agent': DEFAULT_USER_AGENT
      }
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const loc = response.headers.get('location')
      if (!loc) break
      current = new URL(loc, current).toString()
      continue
    }
    const buffer = new Uint8Array(await response.arrayBuffer())
    const slice = buffer.byteLength > MAX_BODY ? buffer.slice(0, MAX_BODY) : buffer
    const html = new TextDecoder('utf-8', { fatal: false }).decode(slice)
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    return {
      finalUrl: response.url || current,
      statusCode: response.status,
      title,
      bodyText: htmlToPlainText(html).slice(0, 12_000),
      html: html.slice(0, 20_000)
    }
  }
  throw new Error('Quá nhiều chuyển hướng')
}

async function probeHttp(url: string): Promise<{ snapshot?: WebLinkPageSnapshot; error?: string }> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const snapshot = await fetchWithRedirects(url, ac.signal)
    return { snapshot }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không tải được trang'
    return { error: message }
  } finally {
    clearTimeout(timer)
  }
}

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function run(): Promise<void> {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      out[index] = await worker(items[index], index)
    }
  }
  const n = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: n }, () => run()))
  return out
}

type BrowserLike = {
  newPage: () => Promise<PageLike>
  close: () => Promise<void>
}

type PageLike = {
  setUserAgent: (ua: string) => Promise<void>
  goto: (
    url: string,
    opts: { waitUntil: 'domcontentloaded'; timeout: number }
  ) => Promise<unknown>
  url: () => string
  evaluate: <T>(fn: () => T) => Promise<T>
  close: () => Promise<void>
}

async function launchChecker(chromePath: string, userDataDir: string): Promise<BrowserLike> {
  mkdirSync(userDataDir, { recursive: true })
  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    defaultViewport: { width: 1100, height: 720 },
    args: [
      '--window-position=-2800,-2800',
      '--window-size=1100,720',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-popup-blocking',
      '--disable-features=Translate,MediaRouter',
      '--lang=vi-VN'
    ]
  })
  await new Promise((r) => setTimeout(r, 700))
  return browser as unknown as BrowserLike
}

async function openCheckerBrowser(chromePath: string): Promise<BrowserLike> {
  const dir = getWebLinkCheckProfileDir()
  try {
    return await launchChecker(chromePath, dir)
  } catch (error) {
    console.error('[web-link] Chrome profile chính bận, thử thư mục tạm', error)
    return launchChecker(chromePath, `${dir}-${Date.now()}`)
  }
}

async function probeChrome(browser: BrowserLike, url: string): Promise<{ snapshot?: WebLinkPageSnapshot; error?: string }> {
  const page = await browser.newPage()
  try {
    await page.setUserAgent(DEFAULT_USER_AGENT)
    await page.goto(ensureHttpUrl(url), {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT_MS
    })
    await new Promise((r) => setTimeout(r, 900))
    const info = await page.evaluate(() => ({
      url: location.href,
      title: document.title || '',
      bodyText: (document.body?.innerText || '').slice(0, 12000),
      html: (document.documentElement?.outerHTML || '').slice(0, 20000)
    }))
    return {
      snapshot: {
        finalUrl: info.url || page.url(),
        statusCode: 200,
        title: info.title,
        bodyText: info.bodyText,
        html: info.html
      }
    }
  } catch (error) {
    try {
      const href = page.url()
      if (href && /chrome-error|chromewebdata|interstitial/i.test(href)) {
        return {
          snapshot: {
            finalUrl: href,
            statusCode: 0,
            title: '',
            bodyText: '',
            html: href
          }
        }
      }
    } catch {
      // ignore
    }
    return { error: error instanceof Error ? error.message : 'Chrome không mở được trang' }
  } finally {
    await page.close().catch(() => undefined)
  }
}

function pickAnySnapshot(
  http: WebLinkPageSnapshot | undefined,
  chrome: WebLinkPageSnapshot | undefined,
  role: UrlCheckRole | 'all' = 'all'
): WebLinkPageSnapshot | undefined {
  if (chrome) {
    const hit = classifySnapshotToProbe(chrome, role)
    if (hit.verdict === 'error') return chrome
  }
  if (http) {
    const hit = classifySnapshotToProbe(http, role)
    if (hit.verdict === 'error') return http
  }
  return chrome ?? http
}

function knownInactiveReason(code?: UrlProbeVerdict['errorCode']): WebLinkInactiveReason | null {
  if (code === 'netlify_not_found' || code === 'dangerous_site' || code === 'google_tos_violation') {
    return code
  }
  return null
}

function classifyForTarget(
  snapshot: WebLinkPageSnapshot,
  target: WebLinkCheckTarget
): WebLinkClassification {
  return target === 'form' ? classifyFormLinkPage(snapshot) : classifyWebLinkPage(snapshot)
}

function pickSnapshot(
  http: WebLinkPageSnapshot | undefined,
  chrome: WebLinkPageSnapshot | undefined,
  target: WebLinkCheckTarget
): WebLinkPageSnapshot | undefined {
  if (chrome) {
    const chromeHit = classifyForTarget(chrome, target)
    if (chromeHit.verdict === 'inactive') return chrome
  }
  if (http) {
    const httpHit = classifyForTarget(http, target)
    if (httpHit.verdict === 'inactive') return http
  }
  return chrome ?? http
}

export async function checkWebLinks(
  text: string,
  target: WebLinkCheckTarget = 'web'
): Promise<WebLinkCheckResult> {
  if (running) throw new Error('Đang có lượt kiểm tra khác')
  running = true
  cancelled = false

  const field: WebLinkUrlField = target === 'form' ? 'linkForm' : 'linkWeb'
  const rows = parseWebLinkText(text)
  const unique = collectUniqueUrls(rows, field).slice(0, WEB_LINKS_MAX_UNIQUE)
  const statusByUrl = new Map<string, string>()
  const reasonByUrl = new Map<string, WebLinkInactiveReason>()
  let active = 0
  let inactive = 0
  let errors = 0
  let skipped = 0
  let done = 0

  let browser: BrowserLike | null = null

  try {
    const httpResults = await mapPool(unique, HTTP_CONCURRENCY, async (rawUrl) => {
      if (cancelled) {
        return { rawUrl, snapshot: undefined as WebLinkPageSnapshot | undefined, error: 'cancelled' }
      }
      if (!isPublicHttpUrl(rawUrl)) {
        return { rawUrl, snapshot: undefined, error: 'invalid' }
      }
      const probed = await probeHttp(rawUrl)
      return { rawUrl, snapshot: probed.snapshot, error: probed.error }
    })

    const needChrome: string[] = []
    for (const item of httpResults) {
      if (!item || item.error === 'cancelled') continue
      const key = normalizeWebUrl(item.rawUrl)
      if (item.error === 'invalid') {
        skipped += 1
        done += 1
        emitProgress({ done, total: unique.length, url: item.rawUrl, verdict: 'skipped' })
        continue
      }
      if (item.snapshot) {
        const hit = classifyForTarget(item.snapshot, target)
        if (hit.verdict === 'inactive' && hit.reason) {
          statusByUrl.set(key, WEB_LINK_STATUS_INACTIVE)
          reasonByUrl.set(key, hit.reason)
          inactive += 1
          done += 1
          emitProgress({
            done,
            total: unique.length,
            url: item.rawUrl,
            verdict: 'inactive',
            reason: hit.reason
          })
          continue
        }
        if (target === 'form' && hit.verdict === 'active' && !httpStatusNeedsBrowser(item.snapshot.statusCode)) {
          active += 1
          done += 1
          emitProgress({ done, total: unique.length, url: item.rawUrl, verdict: 'active' })
          continue
        }
      }
      needChrome.push(item.rawUrl)
    }

    const chromePath = resolveChromePath()
    if (!cancelled && needChrome.length > 0 && chromePath) {
      try {
        browser = await openCheckerBrowser(chromePath)
      } catch (error) {
        console.error('[web-link] Không mở được Chrome kiểm tra', error)
      }
    }

    const httpByRaw = new Map(httpResults.map((item) => [item.rawUrl, item]))

    for (const rawUrl of needChrome) {
      if (cancelled) break
      const key = normalizeWebUrl(rawUrl)
      const httpItem = httpByRaw.get(rawUrl)
      let chromeSnap: WebLinkPageSnapshot | undefined
      if (browser) {
        const probed = await probeChrome(browser, rawUrl)
        chromeSnap = probed.snapshot
      }
      const snapshot = pickSnapshot(httpItem?.snapshot, chromeSnap, target)
      const formBotBlocked =
        target === 'form' &&
        Boolean(httpItem?.snapshot) &&
        httpStatusNeedsBrowser(httpItem?.snapshot?.statusCode ?? 0) &&
        !chromeSnap
      if (!snapshot || formBotBlocked) {
        errors += 1
        done += 1
        emitProgress({ done, total: unique.length, url: rawUrl, verdict: 'error' })
        continue
      }
      const hit = classifyForTarget(snapshot, target)
      if (hit.verdict === 'inactive' && hit.reason) {
        statusByUrl.set(key, WEB_LINK_STATUS_INACTIVE)
        reasonByUrl.set(key, hit.reason)
        inactive += 1
        emitProgress({
          done: done + 1,
          total: unique.length,
          url: rawUrl,
          verdict: 'inactive',
          reason: hit.reason
        })
      } else if (target === 'web') {
        statusByUrl.set(key, WEB_LINK_STATUS_ACTIVE)
        active += 1
        emitProgress({ done: done + 1, total: unique.length, url: rawUrl, verdict: 'active' })
      } else {
        active += 1
        emitProgress({ done: done + 1, total: unique.length, url: rawUrl, verdict: 'active' })
      }
      done += 1
    }

    const nextText = applyWebLinkStatuses(text, statusByUrl, field)
    try {
      saveWebLinks(nextText)
    } catch {
      // Không chặn kết quả nếu ghi file phụ thất bại
    }

    return {
      target,
      text: nextText,
      uniqueChecked: unique.length,
      active,
      inactive,
      errors,
      skipped,
      cancelled,
      safeBrowsingChecked: target === 'form' || needChrome.length === 0 || Boolean(browser),
      warnings: summarizeInactiveWarnings(parseWebLinkText(nextText), reasonByUrl, field)
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
    running = false
  }
}

export async function checkUrlList(
  text: string,
  target: UrlListCheckTarget = 'all'
): Promise<UrlListCheckResult> {
  if (running) throw new Error('Đang có lượt kiểm tra khác')
  running = true
  cancelled = false

  const lines = parseUrlListLines(text)
  const uniqueItems = collectUniqueCheckItems(lines, target).slice(0, WEB_LINKS_MAX_UNIQUE)
  const unique = uniqueItems.map((item) => item.url)
  const roleByKey = new Map(uniqueItems.map((item) => [normalizeWebUrl(item.url), item.role]))
  const byKey = new Map<string, UrlProbeVerdict>()
  let done = 0

  let browser: BrowserLike | null = null

  try {
    const httpResults = await mapPool(unique, HTTP_CONCURRENCY, async (rawUrl) => {
      if (cancelled) {
        return { rawUrl, snapshot: undefined as WebLinkPageSnapshot | undefined, error: 'cancelled' }
      }
      if (!isPublicHttpUrl(rawUrl)) {
        return { rawUrl, snapshot: undefined, error: 'invalid' }
      }
      const probed = await probeHttp(rawUrl)
      return { rawUrl, snapshot: probed.snapshot, error: probed.error }
    })

    const needChrome: string[] = []
    for (const item of httpResults) {
      if (!item || item.error === 'cancelled') continue
      const key = normalizeWebUrl(item.rawUrl)
      const role = roleByKey.get(key) ?? 'web'
      if (item.error === 'invalid') {
        byKey.set(key, {
          verdict: 'error',
          errorCode: 'invalid_url',
          errorLabel: URL_LINE_ERROR_LABEL.invalid_url
        })
        done += 1
        emitProgress({ done, total: unique.length, url: item.rawUrl, verdict: 'skipped' })
        continue
      }
      if (item.snapshot) {
        const hit = classifySnapshotToProbe(item.snapshot, role)
        if (hit.verdict === 'error') {
          byKey.set(key, hit)
          done += 1
          emitProgress({
            done,
            total: unique.length,
            url: item.rawUrl,
            verdict: 'inactive',
            reason: knownInactiveReason(hit.errorCode)
          })
          continue
        }
        if (role === 'form' && !httpStatusNeedsBrowser(item.snapshot.statusCode)) {
          byKey.set(key, { verdict: 'valid' })
          done += 1
          emitProgress({ done, total: unique.length, url: item.rawUrl, verdict: 'active' })
          continue
        }
      }
      needChrome.push(item.rawUrl)
    }

    const chromePath = resolveChromePath()
    if (!cancelled && needChrome.length > 0 && chromePath) {
      try {
        browser = await openCheckerBrowser(chromePath)
      } catch (error) {
        console.error('[web-link] Không mở được Chrome kiểm tra', error)
      }
    }

    const httpByRaw = new Map(httpResults.map((item) => [item.rawUrl, item]))

    for (const rawUrl of needChrome) {
      if (cancelled) break
      const key = normalizeWebUrl(rawUrl)
      const role = roleByKey.get(key) ?? 'web'
      const httpItem = httpByRaw.get(rawUrl)
      let chromeSnap: WebLinkPageSnapshot | undefined
      if (browser) {
        const probed = await probeChrome(browser, rawUrl)
        chromeSnap = probed.snapshot
      }
      const snapshot = pickAnySnapshot(httpItem?.snapshot, chromeSnap, role)
      const formBotBlocked =
        role === 'form' &&
        Boolean(httpItem?.snapshot) &&
        httpStatusNeedsBrowser(httpItem?.snapshot?.statusCode ?? 0) &&
        !chromeSnap
      if (!snapshot || formBotBlocked) {
        byKey.set(key, {
          verdict: 'error',
          errorCode: 'unreachable',
          errorLabel: formBotBlocked
            ? 'Google chặn kiểm tra tự động. Không mở được Chrome để xác nhận Link_form.'
            : URL_LINE_ERROR_LABEL.unreachable
        })
        done += 1
        emitProgress({ done, total: unique.length, url: rawUrl, verdict: 'error' })
        continue
      }
      const hit = classifySnapshotToProbe(snapshot, role)
      byKey.set(key, hit)
      done += 1
      emitProgress({
        done,
        total: unique.length,
        url: rawUrl,
        verdict: hit.verdict === 'error' ? 'inactive' : 'active',
        reason: knownInactiveReason(hit.errorCode)
      })
    }

    const mapped = mapUrlListResults(lines, byKey, target, { cancelled })
    const summary = summarizeUrlList(mapped)
    return {
      lines: mapped,
      ...summary,
      uniqueChecked: unique.length,
      cancelled,
      target
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
    running = false
  }
}
