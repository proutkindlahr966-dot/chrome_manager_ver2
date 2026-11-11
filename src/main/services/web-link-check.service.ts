import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { BrowserWindow } from 'electron'
import { getDb } from '../db/database'
import { detectChromePath } from './chrome.service'
import { IPC } from '../../shared/ipc'
import { DEFAULT_USER_AGENT } from '../../shared/types'
import { getWebLinkCheckProfileDir, getWebLinksKindPath, getWebLinksPath, migrateLegacyDataFile } from '../utils/paths'
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
  pageLooksDangerous,
  RENDER_DANGER_SETTLE_MS,
  RENDER_WAKE_POLL_MS,
  RENDER_WAKE_TIMEOUT_MS,
  shouldWaitForRenderWake,
  summarizeInactiveWarnings,
  summarizeUrlList,
  URL_LINE_ERROR_LABEL,
  WEB_LINK_STATUS_ACTIVE,
  WEB_LINK_STATUS_INACTIVE,
  WEB_LINKS_MAX_UNIQUE,
  chromeLayoutForLinkWeb,
  type UrlCheckRole,
  type UrlLineResult,
  type UrlListCheckResult,
  type UrlListCheckTarget,
  type UrlProbeVerdict,
  type WebLinkCheckTarget,
  type WebLinkClassification,
  type WebLinkCheckProgress,
  type WebLinkCheckResult,
  type WebLinkHostKind,
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
let suppressProgress = false

function ensureMigrated(): void {
  migrateLegacyDataFile('web-links.txt')
  const legacy = getWebLinksPath()
  const netlify = getWebLinksKindPath('netlify')
  if (existsSync(netlify) || !existsSync(legacy)) return
  try {
    const dir = dirname(netlify)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    renameSync(legacy, netlify)
  } catch (error) {
    console.error('[web-link] Không tách được danh sách Netlify cũ', error)
  }
}

function readListFile(filePath: string): string {
  if (!existsSync(filePath)) return ''
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

export function getWebLinksFilePath(kind: WebLinkHostKind = 'netlify'): string {
  ensureMigrated()
  return getWebLinksKindPath(kind)
}

export interface WebLinkStoredList {
  content: string
  path: string
}

export function loadWebLinkLists(): { netlify: WebLinkStoredList; render: WebLinkStoredList } {
  ensureMigrated()
  const netlifyPath = getWebLinksKindPath('netlify')
  const renderPath = getWebLinksKindPath('render')
  return {
    netlify: { content: readListFile(netlifyPath), path: netlifyPath },
    render: { content: readListFile(renderPath), path: renderPath }
  }
}

export function loadWebLinks(): WebLinkStoredList {
  return loadWebLinkLists().netlify
}

export function saveWebLinks(content: string, kind: WebLinkHostKind = 'netlify'): { path: string; count: number } {
  const filePath = getWebLinksFilePath(kind)
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
  if (suppressProgress) return
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.WEB_LINKS_PROGRESS, payload)
  }
}

/** Quét Link_web bằng Chrome trong lúc làm mới. Trả về các dòng bị trang nguy hiểm. */
export async function scanRenderDangerousLines(content: string): Promise<UrlLineResult[]> {
  if (running || !content.trim()) return []
  suppressProgress = true
  try {
    const result = await checkUrlList(content, 'web', 'render')
    return result.lines.filter(
      (row) => row.verdict === 'error' && row.errorCode === 'dangerous_site' && row.raw.trim()
    )
  } catch (error) {
    console.error('[web-link] Không quét được trang nguy hiểm lúc làm mới', error)
    return []
  } finally {
    suppressProgress = false
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
  pages: () => Promise<PageLike[]>
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

/** Puppeteer mặc định tắt phát hiện lừa đảo, nên trang đỏ của Chrome không bao giờ hiện. */
const SAFE_BROWSING_RESTORE_ARGS = [
  '--disable-client-side-phishing-detection',
  '--disable-background-networking',
  '--enable-automation'
]

function chromeUserDataDir(): string {
  const local = process.env.LOCALAPPDATA
  if (!local) return ''
  return join(local, 'Google', 'Chrome', 'User Data')
}

/**
 * Hồ sơ kiểm tra là thư mục riêng, không có danh sách chặn của Chrome.
 * Sao chép kho Safe Browsing đang có trên máy để trang đỏ hiện đúng như Chrome thường.
 */
function seedSafeBrowsingStores(userDataDir: string): void {
  const sourceRoot = chromeUserDataDir()
  if (!sourceRoot || !existsSync(sourceRoot)) return
  mkdirSync(userDataDir, { recursive: true })
  const from = join(sourceRoot, 'Safe Browsing')
  if (existsSync(from)) {
    try {
      cpSync(from, join(userDataDir, 'Safe Browsing'), { recursive: true, force: true })
    } catch (error) {
      console.error('[web-link] Không sao chép được kho Safe Browsing của Chrome', error)
    }
  }
  const prefsPath = join(userDataDir, 'Default', 'Preferences')
  try {
    mkdirSync(dirname(prefsPath), { recursive: true })
    let prefs: Record<string, unknown> = {}
    if (existsSync(prefsPath)) {
      try {
        prefs = JSON.parse(readFileSync(prefsPath, 'utf-8')) as Record<string, unknown>
      } catch {
        prefs = {}
      }
    }
    const current =
      prefs.safebrowsing && typeof prefs.safebrowsing === 'object'
        ? (prefs.safebrowsing as Record<string, unknown>)
        : {}
    prefs.safebrowsing = { ...current, enabled: true, enhanced: true }
    writeFileSync(prefsPath, JSON.stringify(prefs))
  } catch (error) {
    console.error('[web-link] Không bật được Safe Browsing cho hồ sơ kiểm tra', error)
  }
}

async function closeExtraCheckerPages(browser: BrowserLike, keep: Set<PageLike>): Promise<void> {
  const extras = (await browser.pages()).filter((page) => !keep.has(page))
  await Promise.all(extras.map((page) => page.close().catch(() => undefined)))
}

async function openCheckerPages(browser: BrowserLike, count: number): Promise<PageLike[]> {
  const pages: PageLike[] = []
  for (let i = 0; i < count; i += 1) {
    const page = await browser.newPage()
    await page.setUserAgent(DEFAULT_USER_AGENT)
    pages.push(page)
  }
  const keep = new Set(pages)
  await closeExtraCheckerPages(browser, keep)
  await sleep(200)
  await closeExtraCheckerPages(browser, keep)
  return pages
}

async function launchChecker(
  chromePath: string,
  userDataDir: string,
  windowIndex = 0
): Promise<BrowserLike> {
  mkdirSync(userDataDir, { recursive: true })
  seedSafeBrowsingStores(userDataDir)
  const puppeteer = (await import('puppeteer-core')).default
  const shift = windowIndex * 48
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    defaultViewport: { width: 1100, height: 720 },
    ignoreDefaultArgs: SAFE_BROWSING_RESTORE_ARGS,
    args: [
      `--window-position=${-2800 + shift},${-2800 + shift}`,
      '--window-size=1100,720',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-popup-blocking',
      '--disable-session-crashed-bubble',
      '--disable-features=Translate,MediaRouter,ChromeWhatsNew',
      '--lang=vi-VN'
    ]
  })
  await new Promise((r) => setTimeout(r, 700))
  return browser as unknown as BrowserLike
}

async function openOneCheckerBrowser(chromePath: string, windowIndex: number): Promise<BrowserLike> {
  const dir = getWebLinkCheckProfileDir()
  const profileDir = windowIndex === 0 ? dir : `${dir}-w${windowIndex}`
  try {
    return await launchChecker(chromePath, profileDir, windowIndex)
  } catch (error) {
    console.error('[web-link] Chrome profile bận, thử thư mục tạm', error)
    return launchChecker(chromePath, `${profileDir}-${Date.now()}`, windowIndex)
  }
}

async function openCheckerBrowsers(chromePath: string, count: number): Promise<BrowserLike[]> {
  const n = Math.max(1, count)
  const settled = await Promise.allSettled(
    Array.from({ length: n }, (_, i) => openOneCheckerBrowser(chromePath, i))
  )
  const browsers: BrowserLike[] = []
  for (const item of settled) {
    if (item.status === 'fulfilled') browsers.push(item.value)
    else console.error('[web-link] Không mở được Chrome kiểm tra', item.reason)
  }
  return browsers
}

async function closeCheckerBrowsers(browsers: BrowserLike[]): Promise<void> {
  await Promise.all(browsers.map((browser) => browser.close().catch(() => undefined)))
}

async function launchCheckerPool(
  chromePath: string,
  windows: number,
  tabsPerWindow: number
): Promise<{ browsers: BrowserLike[]; pages: PageLike[] }> {
  if (!chromePath || windows <= 0) return { browsers: [], pages: [] }
  const browsers = await openCheckerBrowsers(chromePath, windows)
  const pages: PageLike[] = []
  try {
    const tabs = Math.max(0, tabsPerWindow)
    if (tabs > 0) {
      for (const browser of browsers) {
        pages.push(...(await openCheckerPages(browser, tabs)))
      }
    }
    return { browsers, pages }
  } catch (error) {
    await closeCheckerPages(pages)
    await closeCheckerBrowsers(browsers)
    throw error
  }
}

async function closeCheckerPages(pages: PageLike[]): Promise<void> {
  await Promise.all(pages.map((page) => page.close().catch(() => undefined)))
}

async function runChromeWebPool(
  pages: PageLike[],
  urls: string[],
  worker: (page: PageLike | null, url: string) => Promise<void>
): Promise<void> {
  if (urls.length === 0) return
  if (pages.length === 0) {
    for (const url of urls) {
      if (cancelled) break
      await worker(null, url)
    }
    return
  }
  let next = 0
  async function run(page: PageLike): Promise<void> {
    while (!cancelled) {
      const index = next
      next += 1
      if (index >= urls.length) return
      await worker(page, urls[index])
    }
  }
  await Promise.all(pages.map((page) => run(page)))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function httpResponseStatus(response: unknown): number | undefined {
  if (!response || typeof response !== 'object' || !('status' in response)) return undefined
  const status = (response as { status: unknown }).status
  if (typeof status !== 'function') return undefined
  const code = status.call(response)
  return typeof code === 'number' ? code : undefined
}

async function readCheckerPage(
  page: PageLike,
  statusCode = 200
): Promise<WebLinkPageSnapshot> {
  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title || '',
    bodyText: (document.body?.innerText || '').slice(0, 12000),
    html: (document.documentElement?.outerHTML || '').slice(0, 20000)
  }))
  return {
    finalUrl: info.url || page.url(),
    statusCode,
    title: info.title,
    bodyText: info.bodyText,
    html: info.html
  }
}

function blockedNavigationSnapshot(message: string): WebLinkPageSnapshot | null {
  const blob = message.toLowerCase()
  const blocked =
    blob.includes('err_blocked_by_client') ||
    blob.includes('err_blocked_by_administrator') ||
    blob.includes('safebrowsing') ||
    blob.includes('safe browsing') ||
    blob.includes('trang web nguy hiểm')
  if (!blocked) return null
  return {
    finalUrl: 'chrome-error://chromewebdata/',
    statusCode: 0,
    title: 'Trang web nguy hiểm',
    bodyText: 'Trang web nguy hiểm. Quay lại trang an toàn',
    html: message
  }
}

async function readVisibleOrBlocked(
  page: PageLike,
  message = '',
  statusCode = 200
): Promise<WebLinkPageSnapshot | null> {
  if (/err_blocked_by_client|err_blocked_by_administrator/i.test(message)) {
    await sleep(800)
  }
  try {
    const snapshot = await readCheckerPage(page, statusCode)
    if (pageLooksDangerous(snapshot)) return snapshot
  } catch {
    // Trang lỗi của Chrome đôi khi chưa đọc được ngay sau khi điều hướng bị chặn.
  }
  return blockedNavigationSnapshot(message)
}

async function settleDangerInterstitial(
  page: PageLike,
  snapshot: WebLinkPageSnapshot
): Promise<WebLinkPageSnapshot> {
  if (pageLooksDangerous(snapshot)) return snapshot
  const until = Date.now() + RENDER_DANGER_SETTLE_MS
  let current = snapshot
  while (!cancelled && Date.now() < until) {
    await sleep(1_200)
    const seen = await readVisibleOrBlocked(page)
    if (seen && pageLooksDangerous(seen)) return seen
    if (seen) current = seen
  }
  return current
}

async function probeChromeOnce(
  page: PageLike,
  url: string
): Promise<{ snapshot?: WebLinkPageSnapshot; error?: string }> {
  try {
    const response = await page.goto(ensureHttpUrl(url), {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT_MS
    })
    await sleep(900)
    const statusCode = httpResponseStatus(response) ?? 200
    const blocked = await readVisibleOrBlocked(page, '', statusCode)
    if (blocked && pageLooksDangerous(blocked)) return { snapshot: blocked }
    return { snapshot: await readCheckerPage(page, statusCode) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chrome không mở được trang'
    const blocked = await readVisibleOrBlocked(page, message)
    if (blocked) return { snapshot: blocked }
    return { error: message }
  }
}

async function probeChromeUntilRenderReady(
  page: PageLike,
  url: string,
  onWaiting?: () => void
): Promise<{ snapshot?: WebLinkPageSnapshot; error?: string; stillWaking?: boolean }> {
  const deadline = Date.now() + RENDER_WAKE_TIMEOUT_MS
  let snapshot: WebLinkPageSnapshot | undefined
  let lastError = ''
  let polls = 0
  let sawWaking = false

  while (!cancelled && Date.now() < deadline) {
    const reload = polls === 0 || polls % 4 === 0 || !snapshot
    if (reload) {
      try {
        const response = await page.goto(ensureHttpUrl(url), {
          waitUntil: 'domcontentloaded',
          timeout: PAGE_TIMEOUT_MS
        })
        await sleep(900)
        snapshot = await readCheckerPage(page, httpResponseStatus(response) ?? 200)
        lastError = ''
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Chrome không mở được trang'
        const blocked = await readVisibleOrBlocked(page, lastError)
        if (blocked && pageLooksDangerous(blocked)) return { snapshot: blocked }
      }
    } else {
      try {
        snapshot = await readCheckerPage(page, snapshot?.statusCode ?? 200)
      } catch {
        // Giữ snapshot cũ, lần sau sẽ tải lại.
      }
    }

    if (snapshot && pageLooksDangerous(snapshot)) return { snapshot }
    if (snapshot && shouldWaitForRenderWake(snapshot, 'render')) sawWaking = true
    if (snapshot && !shouldWaitForRenderWake(snapshot, 'render')) {
      const thin =
        sawWaking && snapshot.bodyText.trim().length < 40 && snapshot.title.trim().length < 2
      if (!thin) return { snapshot: await settleDangerInterstitial(page, snapshot) }
    }

    onWaiting?.()
    polls += 1
    const remaining = deadline - Date.now()
    if (remaining <= 0 || cancelled) break
    await sleep(Math.min(RENDER_WAKE_POLL_MS, remaining))
  }

  if (cancelled) {
    return snapshot ? { snapshot } : { error: lastError || 'Đã dừng' }
  }
  const stillThin =
    Boolean(snapshot) &&
    sawWaking &&
    (snapshot?.bodyText.trim().length ?? 0) < 40 &&
    (snapshot?.title.trim().length ?? 0) < 2
  if ((snapshot && shouldWaitForRenderWake(snapshot, 'render')) || stillThin) {
    return { snapshot, stillWaking: true }
  }
  if (snapshot && pageLooksDangerous(snapshot)) return { snapshot }
  if (snapshot) return { snapshot: await settleDangerInterstitial(page, snapshot) }
  return { error: lastError || 'Chrome không mở được trang' }
}

async function probeChrome(
  page: PageLike,
  url: string,
  options?: { waitForRender?: boolean; onWaiting?: () => void }
): Promise<{ snapshot?: WebLinkPageSnapshot; error?: string; stillWaking?: boolean }> {
  if (options?.waitForRender) {
    return await probeChromeUntilRenderReady(page, url, options.onWaiting)
  }
  return await probeChromeOnce(page, url)
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
  if (
    code === 'netlify_not_found' ||
    code === 'dangerous_site' ||
    code === 'google_tos_violation' ||
    code === 'render_suspended'
  ) {
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

  const browsers: BrowserLike[] = []
  const layout = chromeLayoutForLinkWeb(target === 'web' ? unique.length : 0)
  const chromeWindows = layout.windows > 0 ? layout.windows : target === 'form' ? 1 : 0
  const chromeTabs = layout.windows > 0 ? layout.tabsPerWindow : target === 'form' ? 1 : 0
  const chromePath = resolveChromePath()

  try {
    if (layout.windows > 0) {
      emitProgress({
        done: 0,
        total: unique.length,
        url: '',
        verdict: 'skipped',
        message: `Đã đếm ${unique.length} Link_web — mở ${layout.windows} Chrome, mỗi cửa sổ ${layout.tabsPerWindow} tab`
      })
    }
    const chromeLaunch = cancelled
      ? Promise.resolve({ browsers: [] as BrowserLike[], pages: [] as PageLike[] })
      : launchCheckerPool(chromePath, chromeWindows, chromeTabs)
    const [httpResults, launched] = await Promise.all([
      mapPool(unique, HTTP_CONCURRENCY, async (rawUrl) => {
        if (cancelled) {
          return { rawUrl, snapshot: undefined as WebLinkPageSnapshot | undefined, error: 'cancelled' }
        }
        if (!isPublicHttpUrl(rawUrl)) {
          return { rawUrl, snapshot: undefined, error: 'invalid' }
        }
        const probed = await probeHttp(rawUrl)
        return { rawUrl, snapshot: probed.snapshot, error: probed.error }
      }),
      chromeLaunch
    ])
    browsers.push(...launched.browsers)
    const chromePages = launched.pages

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

    const httpByRaw = new Map(httpResults.map((item) => [item.rawUrl, item]))

    async function inspectLegacyChrome(page: PageLike | null, rawUrl: string): Promise<void> {
      if (cancelled) return
      const key = normalizeWebUrl(rawUrl)
      const httpItem = httpByRaw.get(rawUrl)
      let chromeSnap: WebLinkPageSnapshot | undefined
      if (page) {
        const probed = await probeChrome(page, rawUrl)
        chromeSnap = probed.snapshot
      }
      if (cancelled) return
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
        return
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
      } else {
        if (target === 'web') statusByUrl.set(key, WEB_LINK_STATUS_ACTIVE)
        active += 1
        emitProgress({ done: done + 1, total: unique.length, url: rawUrl, verdict: 'active' })
      }
      done += 1
    }

    try {
      if (target === 'web') {
        await runChromeWebPool(chromePages, needChrome, inspectLegacyChrome)
      } else {
        for (const rawUrl of needChrome) {
          if (cancelled) break
          await inspectLegacyChrome(chromePages[0] ?? null, rawUrl)
        }
      }
    } finally {
      await closeCheckerPages(chromePages)
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
      safeBrowsingChecked: target === 'form' || needChrome.length === 0 || browsers.length > 0,
      warnings: summarizeInactiveWarnings(parseWebLinkText(nextText), reasonByUrl, field)
    }
  } finally {
    await closeCheckerBrowsers(browsers)
    running = false
  }
}

export async function checkUrlList(
  text: string,
  target: UrlListCheckTarget = 'all',
  hostKind: WebLinkHostKind = 'netlify'
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

  const browsers: BrowserLike[] = []
  const webLinkCount = uniqueItems.filter((item) => item.role === 'web').length
  const formLinkCount = uniqueItems.filter((item) => item.role === 'form').length
  const layout = chromeLayoutForLinkWeb(webLinkCount)
  const chromeWindows = layout.windows > 0 ? layout.windows : formLinkCount > 0 ? 1 : 0
  const chromeTabs = layout.windows > 0 ? layout.tabsPerWindow : formLinkCount > 0 ? 1 : 0
  const chromePath = resolveChromePath()

  try {
    if (layout.windows > 0) {
      emitProgress({
        done: 0,
        total: unique.length,
        url: '',
        verdict: 'skipped',
        message: `Đã đếm ${webLinkCount} Link_web — mở ${layout.windows} Chrome, mỗi cửa sổ ${layout.tabsPerWindow} tab`
      })
    }
    const chromeLaunch = cancelled
      ? Promise.resolve({ browsers: [] as BrowserLike[], pages: [] as PageLike[] })
      : launchCheckerPool(chromePath, chromeWindows, chromeTabs)
    const [httpResults, launched] = await Promise.all([
      mapPool(unique, HTTP_CONCURRENCY, async (rawUrl) => {
        if (cancelled) {
          return { rawUrl, snapshot: undefined as WebLinkPageSnapshot | undefined, error: 'cancelled' }
        }
        if (!isPublicHttpUrl(rawUrl)) {
          return { rawUrl, snapshot: undefined, error: 'invalid' }
        }
        const probed = await probeHttp(rawUrl)
        return { rawUrl, snapshot: probed.snapshot, error: probed.error }
      }),
      chromeLaunch
    ])
    browsers.push(...launched.browsers)
    const chromePages = launched.pages

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
      const deferRenderWake =
        hostKind === 'render' &&
        role === 'web' &&
        Boolean(item.snapshot) &&
        shouldWaitForRenderWake(item.snapshot as WebLinkPageSnapshot, 'render')
      if (item.snapshot && !deferRenderWake) {
        const hit = classifySnapshotToProbe(item.snapshot, role)
        if (hit.verdict === 'error' || hit.verdict === 'warning') {
          byKey.set(key, hit)
          done += 1
          emitProgress({
            done,
            total: unique.length,
            url: item.rawUrl,
            verdict: hit.verdict === 'error' ? 'inactive' : 'skipped',
            reason: knownInactiveReason(hit.errorCode),
            message: hit.verdict === 'warning' ? hit.errorLabel : undefined
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

    const webUrls = needChrome.filter((rawUrl) => (roleByKey.get(normalizeWebUrl(rawUrl)) ?? 'web') === 'web')
    const formUrls = needChrome.filter((rawUrl) => (roleByKey.get(normalizeWebUrl(rawUrl)) ?? 'web') === 'form')

    const httpByRaw = new Map(httpResults.map((item) => [item.rawUrl, item]))

    async function inspectListChrome(page: PageLike | null, rawUrl: string): Promise<void> {
      if (cancelled) return
      const key = normalizeWebUrl(rawUrl)
      const role = roleByKey.get(key) ?? 'web'
      const httpItem = httpByRaw.get(rawUrl)
      const waitForRender = hostKind === 'render' && role === 'web'
      let chromeSnap: WebLinkPageSnapshot | undefined
      let stillWaking = false
      if (page) {
        const probed = await probeChrome(
          page,
          rawUrl,
          waitForRender
            ? {
                waitForRender: true,
                onWaiting: () => {
                  emitProgress({
                    done,
                    total: unique.length,
                    url: rawUrl,
                    verdict: 'skipped',
                    message: `Đang chờ server Render thức dậy: ${rawUrl}`
                  })
                }
              }
            : undefined
        )
        chromeSnap = probed.snapshot
        stillWaking = waitForRender && Boolean(probed.stillWaking)
      }
      if (cancelled) return
      const httpWaking =
        waitForRender &&
        Boolean(httpItem?.snapshot) &&
        shouldWaitForRenderWake(httpItem?.snapshot as WebLinkPageSnapshot, 'render')
      if (waitForRender && (stillWaking || (httpWaking && !chromeSnap))) {
        byKey.set(key, {
          verdict: 'error',
          errorCode: 'render_still_waking',
          errorLabel: stillWaking
            ? URL_LINE_ERROR_LABEL.render_still_waking
            : 'Server Render đang thức dậy nhưng không mở được Chrome để chờ.'
        })
        done += 1
        emitProgress({ done, total: unique.length, url: rawUrl, verdict: 'error' })
        return
      }
      const snapshot =
        waitForRender && chromeSnap && !shouldWaitForRenderWake(chromeSnap, 'render')
          ? chromeSnap
          : pickAnySnapshot(httpItem?.snapshot, chromeSnap, role)
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
        return
      }
      const hit = classifySnapshotToProbe(snapshot, role)
      byKey.set(key, hit)
      done += 1
      emitProgress({
        done,
        total: unique.length,
        url: rawUrl,
        verdict: hit.verdict === 'error' ? 'inactive' : hit.verdict === 'warning' ? 'skipped' : 'active',
        reason: knownInactiveReason(hit.errorCode),
        message: hit.verdict === 'warning' ? hit.errorLabel : undefined
      })
    }

    try {
      await runChromeWebPool(chromePages, webUrls, inspectListChrome)
      if (formUrls.length > 0) {
        const formPage = chromePages[0] ?? null
        for (const rawUrl of formUrls) {
          if (cancelled) break
          await inspectListChrome(formPage, rawUrl)
        }
      }
    } finally {
      await closeCheckerPages(chromePages)
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
    await closeCheckerBrowsers(browsers)
    running = false
  }
}
