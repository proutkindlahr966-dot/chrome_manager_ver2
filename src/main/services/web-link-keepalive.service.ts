import { existsSync, readFileSync, writeFileSync } from 'fs'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import { DEFAULT_USER_AGENT } from '../../shared/types'
import { getWebLinkKeepAlivePath } from '../utils/paths'
import { loadWebLinkLists, saveWebLinks, scanRenderDangerousLines } from './web-link-check.service'
import {
  clampRenderKeepAliveMinutes,
  collectUniqueCheckItems,
  ensureHttpUrl,
  isPublicHttpUrl,
  omitMatchingRawLines,
  parseUrlListLines,
  RENDER_KEEPALIVE_INTERVAL_MS,
  WEB_LINKS_MAX_UNIQUE,
  type UrlLineResult,
  type WebLinkHostKind,
  type WebLinkKeepAliveStatus
} from '../../shared/web-link'

const PING_TIMEOUT_MS = 15_000
const PING_CONCURRENCY = 4
const FIRST_DELAY_MS = 2_000

interface PersistedKeepAlive {
  auto: boolean
  hostKind: WebLinkHostKind
  intervalMs: number
  urls: string[]
  lastRunAt: number | null
  lastOk: number
  lastFail: number
}

let auto = false
let hostKind: WebLinkHostKind = 'netlify'
let intervalMs = RENDER_KEEPALIVE_INTERVAL_MS
let urls: string[] = []
let listText = ''
let lastRunAt: number | null = null
let nextRunAt: number | null = null
let lastOk = 0
let lastFail = 0
let running = false
let timer: ReturnType<typeof setTimeout> | null = null
let inCycle = false

function jobEnabled(): boolean {
  return auto && hostKind === 'render' && urls.length > 0
}

function emptyPersist(): PersistedKeepAlive {
  return {
    auto: false,
    hostKind: 'netlify',
    intervalMs: RENDER_KEEPALIVE_INTERVAL_MS,
    urls: [],
    lastRunAt: null,
    lastOk: 0,
    lastFail: 0
  }
}

function loadPersist(): PersistedKeepAlive {
  const filePath = getWebLinkKeepAlivePath()
  if (!existsSync(filePath)) return emptyPersist()
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<PersistedKeepAlive> & {
      enabled?: boolean
    }
    const list = Array.isArray(parsed.urls)
      ? parsed.urls.filter((item): item is string => typeof item === 'string' && isPublicHttpUrl(item))
      : []
    const savedInterval = typeof parsed.intervalMs === 'number' ? parsed.intervalMs : RENDER_KEEPALIVE_INTERVAL_MS
    const legacyEnabled = Boolean(parsed.enabled)
    const savedAuto = typeof parsed.auto === 'boolean' ? parsed.auto : legacyEnabled
    const savedHost: WebLinkHostKind =
      parsed.hostKind === 'render' || parsed.hostKind === 'netlify'
        ? parsed.hostKind
        : legacyEnabled
          ? 'render'
          : 'netlify'
    return {
      auto: savedAuto,
      hostKind: savedHost,
      intervalMs: clampRenderKeepAliveMinutes(savedInterval / 60_000) * 60_000,
      urls: list.slice(0, WEB_LINKS_MAX_UNIQUE),
      lastRunAt: typeof parsed.lastRunAt === 'number' ? parsed.lastRunAt : null,
      lastOk: typeof parsed.lastOk === 'number' ? parsed.lastOk : 0,
      lastFail: typeof parsed.lastFail === 'number' ? parsed.lastFail : 0
    }
  } catch {
    return emptyPersist()
  }
}

function persist(): void {
  const payload: PersistedKeepAlive = {
    auto,
    hostKind,
    intervalMs,
    urls,
    lastRunAt,
    lastOk,
    lastFail
  }
  try {
    writeFileSync(getWebLinkKeepAlivePath(), JSON.stringify(payload), 'utf8')
  } catch (error) {
    console.error('[web-link] Không lưu được lịch giữ server Render', error)
  }
}

function snapshot(): WebLinkKeepAliveStatus {
  return {
    auto,
    enabled: jobEnabled(),
    intervalMs,
    urlCount: urls.length,
    running,
    lastRunAt,
    nextRunAt,
    lastOk,
    lastFail
  }
}

function emit(extra?: Pick<WebLinkKeepAliveStatus, 'removedLines'>): void {
  const payload: WebLinkKeepAliveStatus = { ...snapshot(), ...extra }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(IPC.WEB_LINKS_KEEPALIVE_EVENT, payload)
  }
}

function currentRenderText(): string {
  if (listText.trim()) return listText
  try {
    return loadWebLinkLists().render.content
  } catch {
    return ''
  }
}

function clearTimer(): void {
  if (timer) clearTimeout(timer)
  timer = null
  nextRunAt = null
}

function extractWebUrls(content: string): string[] {
  return collectUniqueCheckItems(parseUrlListLines(content), 'web')
    .map((item) => item.url)
    .filter((url) => isPublicHttpUrl(url))
    .slice(0, WEB_LINKS_MAX_UNIQUE)
}

function schedule(delayMs: number): void {
  clearTimer()
  if (!jobEnabled()) {
    emit()
    return
  }
  const wait = Math.max(0, delayMs)
  nextRunAt = Date.now() + wait
  timer = setTimeout(() => {
    timer = null
    void cycle()
  }, wait)
  emit()
}

async function pingUrl(url: string): Promise<boolean> {
  const ac = new AbortController()
  const timerId = setTimeout(() => ac.abort(), PING_TIMEOUT_MS)
  try {
    await fetch(ensureHttpUrl(url), {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'User-Agent': DEFAULT_USER_AGENT
      }
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timerId)
  }
}

async function mapPool(items: string[], worker: (url: string) => Promise<void>): Promise<void> {
  let next = 0
  async function run(): Promise<void> {
    while (jobEnabled()) {
      const index = next
      next += 1
      if (index >= items.length) return
      await worker(items[index])
    }
  }
  const n = Math.max(1, Math.min(PING_CONCURRENCY, items.length))
  await Promise.all(Array.from({ length: n }, () => run()))
}

async function cycle(): Promise<void> {
  if (inCycle || !jobEnabled()) return
  inCycle = true
  running = true
  nextRunAt = null
  emit()
  const started = Date.now()
  const batch = [...urls]
  const scanned = currentRenderText()
  let ok = 0
  let fail = 0
  let removedLines: UrlLineResult[] = []
  try {
    await mapPool(batch, async (url) => {
      const good = await pingUrl(url)
      if (good) ok += 1
      else fail += 1
    })
    removedLines = await scanRenderDangerousLines(scanned)
    if (removedLines.length) {
      const next = omitMatchingRawLines(
        scanned,
        removedLines.map((row) => row.raw)
      )
      listText = next.text
      urls = extractWebUrls(next.text)
      try {
        saveWebLinks(next.text, 'render')
      } catch (error) {
        console.error('[web-link] Không lưu được danh sách sau khi gỡ trang nguy hiểm', error)
      }
    }
  } finally {
    lastOk = ok
    lastFail = fail
    lastRunAt = Date.now()
    running = false
    inCycle = false
    persist()
    console.info(
      `[web-link] Giữ server Render: ${ok} link phản hồi, ${fail} lỗi, ${removedLines.length} trang nguy hiểm`
    )
    emit(removedLines.length ? { removedLines } : undefined)
    if (jobEnabled()) {
      const elapsed = Date.now() - started
      schedule(Math.max(5_000, intervalMs - elapsed))
    } else {
      clearTimer()
      emit()
    }
  }
}

function applyLoaded(saved: PersistedKeepAlive): void {
  auto = saved.auto
  hostKind = saved.hostKind
  intervalMs = saved.intervalMs
  urls = saved.urls
  lastRunAt = saved.lastRunAt
  lastOk = saved.lastOk
  lastFail = saved.lastFail
}

function armFromLastRun(): void {
  if (!jobEnabled()) {
    clearTimer()
    emit()
    return
  }
  const overdue = lastRunAt == null || Date.now() - lastRunAt >= intervalMs
  schedule(overdue ? FIRST_DELAY_MS : intervalMs - (Date.now() - lastRunAt!))
}

export function renderListCanRunHidden(): boolean {
  return auto && urls.length > 0
}

/** Đóng cửa sổ không được cắt lịch. Bật lại loại Render nếu người dùng đang xem Netlify. */
export function keepRenderListRunning(): void {
  if (!renderListCanRunHidden()) return
  if (hostKind !== 'render') hostKind = 'render'
  if (!listText.trim()) {
    try {
      listText = loadWebLinkLists().render.content
    } catch {
      listText = ''
    }
    if (listText.trim()) urls = extractWebUrls(listText)
  }
  persist()
  if (!timer && !inCycle) armFromLastRun()
  else emit()
}

/** Dừng lịch giữ link trước khi xoá dữ liệu. Không ghi lại file sắp bị xoá. */
export function haltWebLinkKeepAlive(): void {
  auto = false
  urls = []
  clearTimer()
  if (!inCycle) running = false
}

export function getWebLinkKeepAliveStatus(): WebLinkKeepAliveStatus {
  return snapshot()
}

export function resumeWebLinkKeepAlive(): void {
  if (timer || inCycle) return
  applyLoaded(loadPersist())
  try {
    listText = loadWebLinkLists().render.content
  } catch {
    listText = ''
  }
  armFromLastRun()
}

export function setWebLinkKeepAlive(input: {
  hostKind?: WebLinkHostKind
  content?: string
  auto?: boolean
  intervalMinutes?: number
}): WebLinkKeepAliveStatus {
  const prevInterval = intervalMs
  if (input.hostKind === 'render' || input.hostKind === 'netlify') hostKind = input.hostKind
  if (typeof input.auto === 'boolean') auto = input.auto
  if (typeof input.intervalMinutes === 'number') {
    intervalMs = clampRenderKeepAliveMinutes(input.intervalMinutes) * 60_000
  }
  if (hostKind === 'render' && typeof input.content === 'string') {
    listText = input.content
    urls = extractWebUrls(input.content)
  }
  const wasScheduled = Boolean(timer) || inCycle
  const intervalDirty = intervalMs !== prevInterval
  persist()
  if (!jobEnabled()) {
    clearTimer()
    if (!inCycle) running = false
    emit()
    return snapshot()
  }
  if (!wasScheduled || intervalDirty) armFromLastRun()
  else emit()
  return snapshot()
}
