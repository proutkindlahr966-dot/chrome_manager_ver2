import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, FileText, Filter, Link2, RefreshCw, Save, Square, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { askConfirm, toast } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import {
  clampRenderKeepAliveMinutes,
  collectUniqueCheckItems,
  omitMatchingRawLines,
  parseUrlListLines,
  summarizeUrlList,
  RENDER_KEEPALIVE_DEFAULT_MINUTES,
  RENDER_KEEPALIVE_MAX_MINUTES,
  RENDER_KEEPALIVE_MIN_MINUTES,
  WEB_LINKS_MAX_UNIQUE,
  type UrlLineResult,
  type UrlListCheckResult,
  type UrlListCheckTarget,
  type WebLinkCheckProgress,
  type WebLinkHostKind,
  type WebLinkKeepAliveStatus
} from '@shared/web-link'

const URL_LIST_PLACEHOLDER: Record<WebLinkHostKind, string> = {
  netlify: `https://docs.google.com/forms/d/e/1FAIpQLSxxxxxxxxxxxxxxxx/viewform|10.01_KR|https://site.netlify.app/recaptcha
https://docs.google.com/forms/d/e/1FAIpQLSyyyyyyyyyyyyyyyy/viewform`,
  render: `https://docs.google.com/forms/d/e/1FAIpQLSxxxxxxxxxxxxxxxx/viewform|10.01_KR|https://bluebadge-ownershipvalidation.onrender.com/recaptcha
https://docs.google.com/forms/d/e/1FAIpQLSyyyyyyyyyyyyyyyy/viewform`
}

const URL_LIST_STORAGE_KEY = 'cm-url-check-list'
const HOST_KIND_STORAGE_KEY = 'cm-url-check-host-kind'
const EMPTY_LISTS: Record<WebLinkHostKind, string> = { netlify: '', render: '' }

function listStorageKey(kind: WebLinkHostKind): string {
  return kind === 'render' ? 'cm-url-check-list-render' : 'cm-url-check-list-netlify'
}

function readStoredList(kind: WebLinkHostKind): string {
  try {
    const own = localStorage.getItem(listStorageKey(kind))
    if (own) return own
    if (kind === 'netlify') return localStorage.getItem(URL_LIST_STORAGE_KEY) ?? ''
    return ''
  } catch {
    return ''
  }
}

function readHostKind(): WebLinkHostKind {
  try {
    return localStorage.getItem(HOST_KIND_STORAGE_KEY) === 'render' ? 'render' : 'netlify'
  } catch {
    return 'netlify'
  }
}

function persistHostKind(kind: WebLinkHostKind): void {
  try {
    localStorage.setItem(HOST_KIND_STORAGE_KEY, kind)
  } catch {
    // ignore
  }
}

function formatRefreshTime(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function mergeDangerousLines(
  current: UrlListCheckResult | null,
  removed: UrlLineResult[]
): UrlListCheckResult {
  const seen = new Set(removed.map((row) => row.raw))
  const lines = [...(current?.lines ?? []).filter((row) => !seen.has(row.raw)), ...removed]
  return {
    lines,
    ...summarizeUrlList(lines),
    uniqueChecked: Math.max(current?.uniqueChecked ?? 0, removed.length),
    cancelled: current?.cancelled ?? false,
    target: current?.target ?? 'web'
  }
}

function persistLocal(kind: WebLinkHostKind, text: string): void {
  try {
    localStorage.setItem(listStorageKey(kind), text)
  } catch {
    // ignore
  }
}

function errorTags(row: UrlLineResult): string {
  const tags: string[] = []
  if (row.formError) tags.push('Link_form')
  if (row.webError) tags.push('Link_web')
  if (!tags.length && row.verdict === 'error') tags.push('Lỗi')
  return tags.join(', ')
}

function OutputLine({ row }: { row: UrlLineResult }): JSX.Element {
  const parts = row.raw.split('|')
  const pipe = parts.length >= 3
  const warn = row.verdict === 'warning'
  const tags = row.verdict === 'error' ? errorTags(row) : warn ? 'Cảnh báo' : ''
  const reason = row.verdict === 'error' || warn ? row.errorLabel : ''

  return (
    <div className={cn('whitespace-pre-wrap break-all', row.verdict === 'skipped' && 'text-ink-muted')}>
      {pipe
        ? parts.map((part, index) => {
            const bad = (index === 0 && row.formError) || (index === 2 && row.webError)
            const warnWeb = warn && index === 2
            return (
              <span key={index}>
                {index > 0 ? '|' : ''}
                <span className={cn(bad && 'text-danger', warnWeb && 'text-warning')}>{part}</span>
              </span>
            )
          })
        : (
            <span
              className={cn(
                row.verdict === 'error' && 'text-danger',
                warn && 'text-warning'
              )}
            >
              {row.raw || ' '}
            </span>
          )}
      {tags ? (
        <span className={cn(warn ? 'text-warning' : 'text-danger')}> [{tags}]</span>
      ) : null}
      {reason ? <span className="text-ink-muted"> ({reason})</span> : null}
    </div>
  )
}

export function WebLinksPage(): JSX.Element {
  const [lists, setLists] = useState<Record<WebLinkHostKind, string>>(EMPTY_LISTS)
  const [paths, setPaths] = useState<Record<WebLinkHostKind, string>>(EMPTY_LISTS)
  const [results, setResults] = useState<Record<WebLinkHostKind, UrlListCheckResult | null>>({
    netlify: null,
    render: null
  })
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState<UrlListCheckTarget | null>(null)
  const [progress, setProgress] = useState<WebLinkCheckProgress | null>(null)
  const [onlyInvalid, setOnlyInvalid] = useState(false)
  const [hostKind, setHostKind] = useState<WebLinkHostKind>(readHostKind)
  const [listReady, setListReady] = useState(false)
  const [prefsReady, setPrefsReady] = useState(false)
  const [keepAlive, setKeepAlive] = useState<WebLinkKeepAliveStatus | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshMinutes, setRefreshMinutes] = useState(RENDER_KEEPALIVE_DEFAULT_MINUTES)
  const [minutesText, setMinutesText] = useState(String(RENDER_KEEPALIVE_DEFAULT_MINUTES))
  const prefsTouched = useRef(false)

  const urlListText = lists[hostKind]
  const filePath = paths[hostKind]
  const listResult = results[hostKind]
  const urlLines = useMemo(() => parseUrlListLines(urlListText), [urlListText])
  const urlLineCount = useMemo(() => urlLines.filter((row) => !row.blank).length, [urlLines])
  const uniqueAll = useMemo(() => collectUniqueCheckItems(urlLines, 'all').length, [urlLines])
  const uniqueWeb = useMemo(() => collectUniqueCheckItems(urlLines, 'web').length, [urlLines])
  const uniqueForm = useMemo(() => collectUniqueCheckItems(urlLines, 'form').length, [urlLines])
  const outputLines = useMemo(() => {
    if (!listResult) return []
    if (!onlyInvalid) return listResult.lines
    return listResult.lines.filter((row) => row.verdict === 'error')
  }, [listResult, onlyInvalid])

  useEffect(() => {
    function pickContent(fileText: string, kind: WebLinkHostKind): string {
      if (fileText.trim()) return fileText
      return readStoredList(kind)
    }
    void window.api.webLinks
      .load()
      .then((loaded) => {
        setPaths({ netlify: loaded.netlify.path, render: loaded.render.path })
        setLists({
          netlify: pickContent(loaded.netlify.content, 'netlify'),
          render: pickContent(loaded.render.content, 'render')
        })
      })
      .catch(() => {
        setLists({
          netlify: readStoredList('netlify'),
          render: readStoredList('render')
        })
      })
      .finally(() => setListReady(true))
  }, [])

  useEffect(() => {
    return window.api.webLinks.onProgress((payload) => setProgress(payload))
  }, [])

  useEffect(() => {
    return window.api.webLinks.onKeepAlive((status) => {
      setKeepAlive(status)
      const removed = (status.removedLines ?? []).filter((row) => row.raw.trim())
      if (!removed.length) return
      setLists((prev) => {
        const { text } = omitMatchingRawLines(
          prev.render,
          removed.map((row) => row.raw)
        )
        persistLocal('render', text)
        void window.api.webLinks.save(text, 'render').catch(() => undefined)
        return { ...prev, render: text }
      })
      setResults((prev) => ({ ...prev, render: mergeDangerousLines(prev.render, removed) }))
      toast({
        tone: 'error',
        title: `Đã gỡ ${removed.length} dòng trang nguy hiểm`,
        description: 'Các dòng này nằm trong Output Render.'
      })
    })
  }, [])

  useEffect(() => {
    void window.api.webLinks
      .keepAliveStatus()
      .then((status) => {
        setKeepAlive(status)
        if (!prefsTouched.current) {
          const minutes = clampRenderKeepAliveMinutes(status.intervalMs / 60_000)
          setAutoRefresh(status.auto)
          setRefreshMinutes(minutes)
          setMinutesText(String(minutes))
        }
      })
      .catch(() => undefined)
      .finally(() => setPrefsReady(true))
  }, [])

  useEffect(() => {
    if (!listReady || !prefsReady) return
    const handle = window.setTimeout(() => {
      void window.api.webLinks
        .setKeepAlive({
          hostKind,
          content: lists.render,
          auto: autoRefresh,
          intervalMinutes: refreshMinutes
        })
        .then((status) => setKeepAlive(status))
        .catch(() => {
          // Lịch giữ server cập nhật lại ở lần sửa danh sách sau.
        })
    }, 400)
    return () => window.clearTimeout(handle)
  }, [listReady, prefsReady, hostKind, lists.render, autoRefresh, refreshMinutes])

  function syncKeepAlive(kind: WebLinkHostKind, auto: boolean, minutes: number, renderText = lists.render): void {
    void window.api.webLinks
      .setKeepAlive({
        hostKind: kind,
        content: renderText,
        auto,
        intervalMinutes: minutes
      })
      .then((status) => setKeepAlive(status))
      .catch(() => undefined)
  }

  function chooseHostKind(kind: WebLinkHostKind): void {
    setHostKind(kind)
    persistHostKind(kind)
    syncKeepAlive(kind, autoRefresh, refreshMinutes)
  }

  function commitMinutes(raw: string): number {
    const minutes = clampRenderKeepAliveMinutes(Number(raw))
    setMinutesText(String(minutes))
    setRefreshMinutes(minutes)
    return minutes
  }

  function toggleAutoRefresh(): void {
    prefsTouched.current = true
    const minutes = commitMinutes(minutesText)
    const next = !autoRefresh
    setAutoRefresh(next)
    syncKeepAlive('render', next, minutes)
  }

  async function clearList(): Promise<void> {
    if (!urlListText.trim()) return
    const ok = await askConfirm({
      title: 'Xóa danh sách?',
      description: `Toàn bộ danh sách ${hostKind === 'render' ? 'Render' : 'Netlify'} sẽ bị xóa khỏi ô nhập và file đã lưu.`,
      confirmLabel: 'Xóa',
      danger: true
    })
    if (!ok) return
    const kind = hostKind
    setLists((prev) => ({ ...prev, [kind]: '' }))
    setResults((prev) => ({ ...prev, [kind]: null }))
    setOnlyInvalid(false)
    persistLocal(kind, '')
    setSaving(true)
    try {
      const saved = await window.api.webLinks.save('', kind)
      setPaths((prev) => ({ ...prev, [kind]: saved.path }))
      toast({ tone: 'success', title: 'Đã xóa danh sách' })
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Đã xóa trên màn hình, chưa ghi được file',
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setSaving(false)
    }
  }

  async function copyValidLines(): Promise<void> {
    const lines = (listResult?.lines ?? []).filter((row) => row.verdict === 'valid' && row.raw.trim())
    if (!lines.length) {
      toast({ tone: 'warning', title: 'Không có dòng không lỗi để sao chép' })
      return
    }
    try {
      await navigator.clipboard.writeText(lines.map((row) => row.raw).join('\n'))
      toast({ tone: 'success', title: `Đã sao chép ${lines.length} dòng không lỗi` })
    } catch {
      toast({
        tone: 'error',
        title: 'Không sao chép được',
        description: 'Hãy kiểm tra quyền clipboard của ứng dụng.'
      })
    }
  }

  async function copyInvalidLines(): Promise<void> {
    const lines = (listResult?.lines ?? []).filter((row) => row.verdict === 'error' && row.raw.trim())
    if (!lines.length) {
      toast({ tone: 'warning', title: 'Không có dòng lỗi để sao chép' })
      return
    }
    try {
      await navigator.clipboard.writeText(lines.map((row) => row.raw).join('\n'))
      toast({ tone: 'success', title: `Đã sao chép ${lines.length} dòng lỗi` })
    } catch {
      toast({
        tone: 'error',
        title: 'Không sao chép được',
        description: 'Hãy kiểm tra quyền clipboard của ứng dụng.'
      })
    }
  }

  async function writeList(kind: WebLinkHostKind, text: string): Promise<boolean> {
    setLists((prev) => ({ ...prev, [kind]: text }))
    persistLocal(kind, text)
    setSaving(true)
    try {
      const saved = await window.api.webLinks.save(text, kind)
      setPaths((prev) => ({ ...prev, [kind]: saved.path }))
      return true
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Đã sửa danh sách trên màn hình, chưa ghi được file',
        description: error instanceof Error ? error.message : undefined
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  async function dropRenderLines(source: string, raws: string[]): Promise<number> {
    const { text, removed } = omitMatchingRawLines(source, raws)
    if (removed === 0) return 0
    await writeList('render', text)
    return removed
  }

  async function removeErrorLinesFromList(): Promise<void> {
    if (hostKind !== 'render' || !listResult) return
    const raws = listResult.lines.filter((row) => row.verdict === 'error' && row.raw.trim()).map((row) => row.raw)
    const preview = omitMatchingRawLines(lists.render, raws)
    if (preview.removed === 0) {
      toast({ tone: 'warning', title: 'Không còn dòng lỗi trong danh sách' })
      return
    }
    const ok = await askConfirm({
      title: 'Xóa dòng lỗi khỏi danh sách?',
      description: `${preview.removed} dòng lỗi sẽ được gỡ khỏi Danh sách Render. Lần kiểm tra sau bỏ qua các dòng đó. Output Render tiếp tục hiện các dòng này.`,
      confirmLabel: 'Xóa dòng lỗi',
      danger: true
    })
    if (!ok) return
    const saved = await writeList('render', preview.text)
    if (saved) {
      toast({
        tone: 'success',
        title: `Đã xóa ${preview.removed} dòng lỗi khỏi danh sách`,
        description: 'Output Render tiếp tục hiện các dòng vừa xóa.'
      })
    }
  }

  async function saveList(): Promise<void> {
    const kind = hostKind
    const text = lists[kind]
    setSaving(true)
    persistLocal(kind, text)
    try {
      const saved = await window.api.webLinks.save(text, kind)
      setPaths((prev) => ({ ...prev, [kind]: saved.path }))
      toast({ tone: 'success', title: 'Đã lưu danh sách', description: `${saved.count} dòng` })
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Không lưu được',
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setSaving(false)
    }
  }

  async function runUrlListCheck(target: UrlListCheckTarget): Promise<void> {
    const uniqueCount = target === 'form' ? uniqueForm : target === 'web' ? uniqueWeb : uniqueAll
    if (!urlLineCount || uniqueCount === 0) {
      toast({
        tone: 'warning',
        title:
          target === 'form'
            ? 'Không có Link_form để kiểm tra'
            : target === 'web'
              ? 'Không có Link_web để kiểm tra'
              : 'Dán ít nhất một URL để kiểm tra'
      })
      return
    }
    const kind = hostKind
    persistLocal(kind, urlListText)
    setRunning(target)
    setProgress({ done: 0, total: uniqueCount, url: '', verdict: 'skipped' })
    try {
      const next = await window.api.webLinks.checkList(
        urlListText,
        target,
        kind === 'render' ? 'render' : 'netlify'
      )
      setResults((prev) => ({ ...prev, [kind]: next }))
      let removedDangerous = 0
      if (kind === 'render') {
        const dangerous = next.lines.filter(
          (row) => row.verdict === 'error' && row.errorCode === 'dangerous_site' && row.raw.trim()
        )
        if (dangerous.length) {
          removedDangerous = await dropRenderLines(
            urlListText,
            dangerous.map((row) => row.raw)
          )
        }
      }
      if (next.cancelled) {
        toast({ tone: 'warning', title: 'Đã dừng kiểm tra', description: 'Output vẫn giữ các dòng đã xong.' })
      } else if (next.error > 0) {
        const bits: string[] = []
        if (next.formError) bits.push(`${next.formError} Link_form`)
        if (next.webError) bits.push(`${next.webError} Link_web`)
        if (next.warning) bits.push(`${next.warning} cảnh báo HTTP 502`)
        if (removedDangerous > 0) {
          bits.push(`đã gỡ ${removedDangerous} dòng trang nguy hiểm khỏi danh sách`)
        }
        toast({
          tone: 'error',
          title: `${next.error} dòng lỗi`,
          description: bits.length ? bits.join(' · ') : 'Xem Output bên phải.'
        })
      } else if (next.warning > 0) {
        toast({
          tone: 'warning',
          title: `${next.warning} dòng cần làm mới lại`,
          description: 'HTTP 502 — giữ nguyên trong danh sách, kiểm tra lại lần sau.'
        })
      } else {
        toast({
          tone: 'success',
          title:
            target === 'form'
              ? 'Mọi Link_form đều hợp lệ'
              : target === 'web'
                ? 'Mọi Link_web đều hợp lệ'
                : 'Mọi link đều hợp lệ',
          description: `Đã kiểm tra ${next.uniqueChecked} URL (lọc trùng).`
        })
      }
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Không kiểm tra được',
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setRunning(null)
      setProgress(null)
    }
  }

  const busy = Boolean(running)

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Kiểm tra Link"
        description="Netlify và Render có hai danh sách riêng. Dán mỗi URL một dòng, hoặc nguyên dòng Link_form|Nhóm|Link_web. Có thể kiểm tra riêng Form hoặc Web."
      />

      <div className="panel p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <div className="rounded-xl border border-line bg-surface-muted/50 px-3 py-2">
              <div className="text-2xs uppercase tracking-wide text-ink-muted">Dòng</div>
              <div className="font-display text-lg font-semibold tabular-nums text-ink">{urlLineCount}</div>
            </div>
            <div className="rounded-xl border border-line bg-surface-muted/50 px-3 py-2">
              <div className="text-2xs uppercase tracking-wide text-ink-muted">Hợp lệ</div>
              <div className="font-display text-lg font-semibold tabular-nums text-success">
                {listResult?.valid ?? '—'}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface-muted/50 px-3 py-2">
              <div className="text-2xs uppercase tracking-wide text-ink-muted">Lỗi Link_form</div>
              <div
                className={cn(
                  'font-display text-lg font-semibold tabular-nums',
                  (listResult?.formError ?? 0) > 0 ? 'text-danger' : 'text-ink'
                )}
              >
                {listResult?.formError ?? '—'}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface-muted/50 px-3 py-2">
              <div className="text-2xs uppercase tracking-wide text-ink-muted">Lỗi Link_web</div>
              <div
                className={cn(
                  'font-display text-lg font-semibold tabular-nums',
                  (listResult?.webError ?? 0) > 0 ? 'text-danger' : 'text-ink'
                )}
              >
                {listResult?.webError ?? '—'}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface-muted/50 px-3 py-2">
              <div className="text-2xs uppercase tracking-wide text-ink-muted">Cảnh báo</div>
              <div
                className={cn(
                  'font-display text-lg font-semibold tabular-nums',
                  (listResult?.warning ?? 0) > 0 ? 'text-warning' : 'text-ink'
                )}
              >
                {listResult?.warning ?? '—'}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || uniqueAll === 0}
              onClick={() => void runUrlListCheck('all')}
            >
              <Link2 size={16} />
              {running === 'all' ? (progress ? `Đang kiểm tra ${progress.done}/${progress.total}` : 'Đang kiểm tra...') : 'Kiểm tra Link'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || uniqueWeb === 0}
              onClick={() => void runUrlListCheck('web')}
            >
              <Link2 size={16} />
              {running === 'web' ? (progress ? `Link_web ${progress.done}/${progress.total}` : 'Đang kiểm tra...') : 'Kiểm tra Link_web'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || uniqueForm === 0}
              onClick={() => void runUrlListCheck('form')}
            >
              <FileText size={16} />
              {running === 'form' ? (progress ? `Link_form ${progress.done}/${progress.total}` : 'Đang kiểm tra...') : 'Kiểm tra Link_form'}
            </button>
            {running ? (
              <button type="button" className="btn-danger" onClick={() => void window.api.webLinks.cancel()}>
                <Square size={16} />
                Dừng
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Loại Link_web</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Loại Link_web">
              <button
                type="button"
                className={cn(hostKind === 'netlify' ? 'btn-primary' : 'btn-secondary', 'btn-sm')}
                aria-pressed={hostKind === 'netlify'}
                disabled={busy}
                onClick={() => chooseHostKind('netlify')}
              >
                Netlify
              </button>
              <button
                type="button"
                className={cn(hostKind === 'render' ? 'btn-primary' : 'btn-secondary', 'btn-sm')}
                aria-pressed={hostKind === 'render'}
                disabled={busy}
                onClick={() => chooseHostKind('render')}
              >
                Render
              </button>
            </div>
          </div>
          {hostKind === 'render' ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs leading-relaxed text-ink-muted">
                Nếu Link_web mở ra màn hình Service waking up / Application loading, bước kiểm tra chờ tối đa 3 phút
                cho server chạy xong rồi mới kết luận. Trang đỏ «Trang web nguy hiểm» của Chrome được tính là lỗi.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <button
                  type="button"
                  className={cn(autoRefresh ? 'btn-primary' : 'btn-secondary', 'btn-sm')}
                  aria-pressed={autoRefresh}
                  onClick={toggleAutoRefresh}
                >
                  <RefreshCw size={14} className={cn(keepAlive?.running && 'animate-spin')} />
                  {autoRefresh ? 'Đang tự làm mới' : 'Tự làm mới server'}
                </button>
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  Mỗi
                  <input
                    type="number"
                    inputMode="numeric"
                    min={RENDER_KEEPALIVE_MIN_MINUTES}
                    max={RENDER_KEEPALIVE_MAX_MINUTES}
                    className="input w-16 py-1.5 text-center tabular-nums"
                    aria-label="Số phút giữa mỗi lần làm mới server"
                    value={minutesText}
                    onChange={(event) => {
                      prefsTouched.current = true
                      setMinutesText(event.target.value)
                    }}
                    onBlur={() => {
                      const minutes = commitMinutes(minutesText)
                      if (autoRefresh) syncKeepAlive('render', true, minutes)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.currentTarget.blur()
                    }}
                  />
                  phút
                </label>
                <div className="rounded-xl border border-line bg-surface-muted/50 px-3 py-2">
                  <div className="text-2xs uppercase tracking-wide text-ink-muted">Làm mới gần nhất</div>
                  <div className="font-display text-lg font-semibold tabular-nums text-ink">
                    {formatRefreshTime(keepAlive?.lastRunAt ?? null)}
                  </div>
                </div>
              </div>
              <p className="text-xs text-ink-muted">
                {autoRefresh
                  ? keepAlive?.urlCount
                    ? keepAlive.running
                      ? `Đang làm mới ${keepAlive.urlCount} Link_web.`
                      : `Tự vào ${keepAlive.urlCount} Link_web mỗi ${refreshMinutes} phút.${
                          keepAlive.nextRunAt ? ` Lần tới ${formatRefreshTime(keepAlive.nextRunAt)}.` : ''
                        } Link dính «Trang web nguy hiểm» được gỡ khỏi danh sách và đưa vào Output Render. Đóng ứng dụng thì lịch này vẫn chạy ẩn; mở lại từ biểu tượng cạnh đồng hồ.`
                    : 'Bật rồi. Thêm Link_web để bắt đầu làm mới.'
                  : `Bấm nút để tự vào Link_web. Server miễn phí ngủ sau khoảng 15 phút, nên chu kỳ từ ${RENDER_KEEPALIVE_MIN_MINUTES} đến ${RENDER_KEEPALIVE_MAX_MINUTES} phút.`}
              </p>
            </div>
          ) : (
            <p className="text-xs text-ink-muted">
              Cách kiểm tra cũ: mở Link_web một lần, rồi đánh dấu Site not found hoặc trang nguy hiểm.
            </p>
          )}
        </div>
        {progress?.message ? (
          <p className="mt-3 break-all text-xs text-accent">{progress.message}</p>
        ) : null}
        {uniqueAll > WEB_LINKS_MAX_UNIQUE ? (
          <p className="mt-3 text-xs text-warning">
            Chỉ kiểm tra {WEB_LINKS_MAX_UNIQUE} URL trùng lọc đầu tiên mỗi lượt để máy không bị quá tải.
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="panel p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-ink">
                Danh sách {hostKind === 'render' ? 'Render' : 'Netlify'}
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Danh sách này chỉ thuộc loại đang chọn. Tiêu đề, tên nhóm và ký tự phân cách được giữ nguyên và không kiểm tra. Chỉ các dòng URL, hoặc{' '}
                <span className="font-mono">Link_form|Nhóm|Link_web</span>, mới được kiểm tra.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="btn-secondary shrink-0"
                disabled={busy || saving || !urlListText.trim()}
                onClick={() => void clearList()}
              >
                <Trash2 size={16} />
                Xóa
              </button>
              <button type="button" className="btn-secondary shrink-0" disabled={busy || saving} onClick={() => void saveList()}>
                <Save size={16} />
                {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
          <textarea
            className={cn(
              'input resize-y font-mono text-xs leading-relaxed',
              hostKind === 'render' ? 'min-h-[70vh]' : 'min-h-[420px]'
            )}
            spellCheck={false}
            disabled={busy}
            value={urlListText}
            placeholder={URL_LIST_PLACEHOLDER[hostKind]}
            onChange={(e) => {
              const kind = hostKind
              const text = e.target.value
              setLists((prev) => ({ ...prev, [kind]: text }))
              setResults((prev) => ({ ...prev, [kind]: null }))
              setOnlyInvalid(false)
            }}
          />
          {filePath ? (
            <p className="mt-2 truncate text-[11px] text-ink-muted" title={filePath}>
              File: {filePath}
            </p>
          ) : null}
        </div>

        <div className="panel flex min-h-[420px] flex-col p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-ink">
              Output {hostKind === 'render' ? 'Render' : 'Netlify'}
            </h2>
            {running && progress ? (
              <Badge tone="accent" dot>
                {progress.done}/{progress.total}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs leading-relaxed text-ink-muted">
            Mỗi dòng một kết quả, sát nhau như danh sách. URL lỗi màu đỏ, HTTP 502 màu vàng (cảnh báo, không xóa dòng), lý do nằm cuối dòng.
            {hostKind === 'render'
              ? ' Khi kiểm tra hoặc làm mới, dòng trang nguy hiểm được gỡ khỏi danh sách và hiện ở đây.'
              : ''}
          </p>
          <div className="mb-3 mt-3 flex flex-wrap gap-2">
            {hostKind === 'render' ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={busy || saving || !listResult || listResult.error === 0}
                onClick={() => void removeErrorLinesFromList()}
              >
                <Trash2 size={14} />
                Xóa dòng lỗi
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={!listResult || listResult.valid === 0}
              onClick={() => void copyValidLines()}
            >
              <Copy size={14} />
              Sao chép đúng
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={!listResult || listResult.error === 0}
              onClick={() => void copyInvalidLines()}
            >
              <Copy size={14} />
              Sao chép lỗi
            </button>
            <button
              type="button"
              className={cn('btn-secondary btn-sm', onlyInvalid && 'ring-1 ring-danger/40')}
              disabled={!listResult || (listResult.error === 0 && !onlyInvalid)}
              onClick={() => setOnlyInvalid((value) => !value)}
            >
              <Filter size={14} />
              {onlyInvalid ? 'Hiện tất cả' : 'Chỉ dòng lỗi'}
            </button>
          </div>
          {!listResult ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-ink-muted">
              Kết quả kiểm tra sẽ hiện ở đây, đúng từng dòng đã dán.
            </div>
          ) : outputLines.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-ink-muted">
              {onlyInvalid ? 'Không còn dòng không hợp lệ.' : 'Không có dòng để hiển thị.'}
            </div>
          ) : (
            <div className="input min-h-[420px] flex-1 overflow-auto font-mono text-xs leading-relaxed">
              {outputLines.map((row, index) => (
                <OutputLine key={`${row.line}-${index}`} row={row} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
