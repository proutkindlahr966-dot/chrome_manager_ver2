import { useEffect, useMemo, useState } from 'react'
import { Copy, FileText, Filter, Link2, Save, Square, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { askConfirm, toast } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import {
  collectUniqueCheckItems,
  parseUrlListLines,
  WEB_LINKS_MAX_UNIQUE,
  type UrlLineResult,
  type UrlListCheckResult,
  type UrlListCheckTarget,
  type WebLinkCheckProgress
} from '@shared/web-link'

const URL_LIST_PLACEHOLDER = `https://docs.google.com/forms/d/e/1FAIpQLSxxxxxxxxxxxxxxxx/viewform|10.01_KR|https://site.netlify.app/recaptcha
https://docs.google.com/forms/d/e/1FAIpQLSyyyyyyyyyyyyyyyy/viewform`

const URL_LIST_STORAGE_KEY = 'cm-url-check-list'

function persistLocal(text: string): void {
  try {
    localStorage.setItem(URL_LIST_STORAGE_KEY, text)
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
  const tags = row.verdict === 'error' ? errorTags(row) : ''

  return (
    <div className="whitespace-pre-wrap break-all">
      {pipe
        ? parts.map((part, index) => {
            const bad = (index === 0 && row.formError) || (index === 2 && row.webError)
            return (
              <span key={index}>
                {index > 0 ? '|' : ''}
                <span className={cn(bad && 'text-danger')}>{part}</span>
              </span>
            )
          })
        : (
            <span className={cn(row.verdict === 'error' && 'text-danger')}>{row.raw || ' '}</span>
          )}
      {tags ? <span className="text-danger"> [{tags}]</span> : null}
    </div>
  )
}

export function WebLinksPage(): JSX.Element {
  const [urlListText, setUrlListText] = useState('')
  const [filePath, setFilePath] = useState('')
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState<UrlListCheckTarget | null>(null)
  const [progress, setProgress] = useState<WebLinkCheckProgress | null>(null)
  const [listResult, setListResult] = useState<UrlListCheckResult | null>(null)
  const [onlyInvalid, setOnlyInvalid] = useState(false)

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
    void window.api.webLinks
      .load()
      .then((loaded) => {
        setFilePath(loaded.path)
        if (loaded.content.trim()) {
          setUrlListText(loaded.content)
          return
        }
        try {
          const saved = localStorage.getItem(URL_LIST_STORAGE_KEY)
          if (saved) setUrlListText(saved)
        } catch {
          // ignore
        }
      })
      .catch(() => {
        try {
          const saved = localStorage.getItem(URL_LIST_STORAGE_KEY)
          if (saved) setUrlListText(saved)
        } catch {
          // ignore
        }
      })
  }, [])

  useEffect(() => {
    return window.api.webLinks.onProgress((payload) => setProgress(payload))
  }, [])

  async function clearList(): Promise<void> {
    if (!urlListText.trim()) return
    const ok = await askConfirm({
      title: 'Xóa danh sách?',
      description: 'Toàn bộ nội dung Danh sách sẽ bị xóa khỏi ô nhập và file đã lưu.',
      confirmLabel: 'Xóa',
      danger: true
    })
    if (!ok) return
    setUrlListText('')
    setListResult(null)
    setOnlyInvalid(false)
    persistLocal('')
    setSaving(true)
    try {
      const saved = await window.api.webLinks.save('')
      setFilePath(saved.path)
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

  async function saveList(): Promise<void> {
    setSaving(true)
    persistLocal(urlListText)
    try {
      const saved = await window.api.webLinks.save(urlListText)
      setFilePath(saved.path)
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
    persistLocal(urlListText)
    setRunning(target)
    setProgress({ done: 0, total: uniqueCount, url: '', verdict: 'skipped' })
    try {
      const next = await window.api.webLinks.checkList(urlListText, target)
      setListResult(next)
      if (next.cancelled) {
        toast({ tone: 'warning', title: 'Đã dừng kiểm tra', description: 'Output vẫn giữ các dòng đã xong.' })
      } else if (next.error > 0) {
        const bits: string[] = []
        if (next.formError) bits.push(`${next.formError} Link_form`)
        if (next.webError) bits.push(`${next.webError} Link_web`)
        toast({
          tone: 'error',
          title: `${next.error} dòng lỗi`,
          description: bits.length ? bits.join(' · ') : 'Xem Output bên phải.'
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
        description="Dán mỗi URL một dòng, hoặc nguyên dòng Link_form|Nhóm|Link_web. Link_form dùng link dài docs.google.com/forms/d/e/…/viewform. Có thể kiểm tra riêng Form hoặc Web. Output giữ nguyên danh sách; lỗi tô đỏ và ghi rõ Link_form / Link_web."
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
              <h2 className="font-display text-base font-semibold text-ink">Danh sách</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Mỗi dòng một URL, hoặc{' '}
                <span className="font-mono">Link_form|Nhóm|Link_web</span>. Link_form là link dài{' '}
                <span className="font-mono">…/viewform</span>.
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
            className="input min-h-[420px] resize-y font-mono text-xs leading-relaxed"
            spellCheck={false}
            disabled={busy}
            value={urlListText}
            placeholder={URL_LIST_PLACEHOLDER}
            onChange={(e) => {
              setUrlListText(e.target.value)
              setListResult(null)
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
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-ink">Output</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Cùng nội dung danh sách. URL lỗi tô đỏ, kèm [Link_form] hoặc [Link_web].
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {running && progress ? (
                <Badge tone="accent" dot>
                  {progress.done}/{progress.total}
                </Badge>
              ) : null}
              <button
                type="button"
                className="btn-secondary"
                disabled={!listResult || listResult.valid === 0}
                onClick={() => void copyValidLines()}
              >
                <Copy size={16} />
                Sao chép dòng không lỗi
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!listResult || listResult.error === 0}
                onClick={() => void copyInvalidLines()}
              >
                <Copy size={16} />
                Sao chép dòng lỗi
              </button>
              <button
                type="button"
                className={cn('btn-secondary', onlyInvalid && 'ring-1 ring-danger/40')}
                disabled={!listResult || (listResult.error === 0 && !onlyInvalid)}
                onClick={() => setOnlyInvalid((value) => !value)}
              >
                <Filter size={16} />
                {onlyInvalid ? 'Hiện tất cả' : 'Lọc không hợp lệ'}
              </button>
            </div>
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
              {outputLines.map((row) => (
                <OutputLine key={row.line} row={row} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
