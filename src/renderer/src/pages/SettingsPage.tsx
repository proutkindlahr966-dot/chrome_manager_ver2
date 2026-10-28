import { FormEvent, useEffect, useState } from 'react'
import { ExternalLink, FolderOpen, HardDrive, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Switch } from '@/components/ui/Switch'
import { useAppStore } from '@/stores/app-store'
import { askConfirm, toast } from '@/stores/ui-store'
import type { AppSettings } from '@shared/types'
import {
  clampStepSpeed,
  sliderToStepSpeed,
  STEP_SPEED_DEFAULT,
  stepSpeedLabel,
  stepSpeedToSlider
} from '@shared/step-speed'
import {
  collectProfilesRoots,
  resolveCreateProfilesRoot,
  SUGGESTED_EXTRA_PROFILES_ROOT,
  uniqueRootPaths
} from '@shared/profile-roots'
import {
  diskUsageLabel,
  isLowDisk,
  type DiskSpaceInfo
} from '@shared/disk'
import { cn, formatDate } from '@/lib/utils'
import type { DbBackupInfo, UpdateCheckResult } from '@shared/app-ops'

function omitWindowState(value: AppSettings): Omit<AppSettings, 'windowState'> {
  const { windowState: _windowState, ...rest } = value
  return rest
}

function DiskHint({ info }: { info?: DiskSpaceInfo }): JSX.Element {
  if (!info) {
    return <div className="mt-1.5 text-[11px] text-ink-muted">Đang đọc dung lượng ổ đĩa…</div>
  }
  return (
    <div
      className={cn(
        'mt-1.5 text-[11px]',
        isLowDisk(info) ? 'font-medium text-warning' : 'text-ink-muted'
      )}
    >
      {diskUsageLabel(info)}
      {isLowDisk(info) ? ' — gần hết chỗ, nên tạo hồ sơ sang ổ khác.' : ''}
    </div>
  )
}

export function SettingsPage(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const detectChrome = useAppStore((s) => s.detectChrome)
  const refreshAll = useAppStore((s) => s.refreshAll)

  const [form, setForm] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [backupDir, setBackupDir] = useState('')
  const [diskByPath, setDiskByPath] = useState<Record<string, DiskSpaceInfo>>({})
  const [backups, setBackups] = useState<DbBackupInfo[]>([])
  const [updateNote, setUpdateNote] = useState<string>('')

  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])

  useEffect(() => {
    void window.api.app
      .info()
      .then((info) => {
        setAppVersion(info.version)
        setBackupDir(info.backupDir ?? '')
      })
      .catch(() => undefined)
    void window.api.backup.list().then(setBackups).catch(() => undefined)
  }, [])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!form) return
    setSaving(true)
    try {
      const extras = uniqueRootPaths(form.additionalProfilesRoots ?? []).length
        ? uniqueRootPaths(form.additionalProfilesRoots ?? [])
        : uniqueRootPaths([SUGGESTED_EXTRA_PROFILES_ROOT])
      const next = {
        ...form,
        additionalProfilesRoots: extras.filter(
          (root) => root.toLowerCase() !== form.profilesRoot.trim().replace(/[/\\]+$/, '').toLowerCase()
        ),
        createProfilesRoot: resolveCreateProfilesRoot({
          ...form,
          additionalProfilesRoots: extras
        }),
        updateFeedUrl: (form.updateFeedUrl ?? '').trim()
      }
      const { windowState: _windowState, ...rest } = next
      await updateSettings(rest)
      setForm({ ...next })
      toast({ tone: 'success', title: 'Đã lưu cài đặt' })
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Không thể lưu',
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setSaving(false)
    }
  }

  async function onThemeChange(theme: AppSettings['theme']): Promise<void> {
    if (!form) return
    setForm({ ...form, theme })
    await updateSettings({ theme })
  }

  async function onDetectChrome(): Promise<void> {
    setDetecting(true)
    try {
      const path = await detectChrome()
      if (path) {
        setForm((prev) => (prev ? { ...prev, chromePath: path } : prev))
        toast({ tone: 'success', title: 'Đã phát hiện Chrome', description: path })
      } else {
        toast({ tone: 'warning', title: 'Không tìm thấy Chrome trên máy' })
      }
    } finally {
      setDetecting(false)
    }
  }

  async function pickRoot(kind: 'primary' | 'extra', index?: number): Promise<void> {
    try {
      const selected = await window.api.settings.pickProfilesDir()
      if (!selected || !form) return
      if (kind === 'primary') {
        setForm({ ...form, profilesRoot: selected })
        return
      }
      const extras = [...(form.additionalProfilesRoots ?? [])]
      const i = index ?? extras.length
      extras[i] = selected
      setForm({ ...form, additionalProfilesRoots: uniqueRootPaths(extras) })
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Không chọn được thư mục',
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  function extraRoots(): string[] {
    const extras = uniqueRootPaths(form?.additionalProfilesRoots ?? [])
    return extras.length ? extras : [SUGGESTED_EXTRA_PROFILES_ROOT]
  }

  const extraKey = extraRoots().join('|')
  const dirty = Boolean(
    form &&
      settings &&
      JSON.stringify(omitWindowState(form)) !== JSON.stringify(omitWindowState(settings))
  )

  useEffect(() => {
    if (!form) return
    const paths = collectProfilesRoots(form)
    let cancelled = false
    void window.api.settings
      .diskSpace(paths)
      .then((list) => {
        if (cancelled) return
        const next: Record<string, DiskSpaceInfo> = {}
        paths.forEach((path, index) => {
          if (list[index]) next[path.trim().toLowerCase()] = list[index]
        })
        setDiskByPath(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [form?.profilesRoot, form?.createProfilesRoot, extraKey])

  async function openFolder(path: string): Promise<void> {
    const result = await window.api.settings.openPath(path)
    if (!result.ok) {
      toast({
        tone: 'error',
        title: 'Không mở được thư mục',
        description: result.error
      })
    }
  }

  function diskFor(path: string): DiskSpaceInfo | undefined {
    return diskByPath[path.trim().toLowerCase()]
  }

  async function exportBackup(): Promise<void> {
    try {
      const saved = await window.api.backup.exportFile()
      if (!saved) return
      toast({ tone: 'success', title: 'Đã sao lưu', description: saved })
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Không sao lưu được',
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  async function restoreBackup(fromList?: string): Promise<void> {
    const ok = await askConfirm({
      title: 'Khôi phục dữ liệu?',
      description:
        'Hồ sơ, nhóm và cài đặt hiện tại sẽ bị thay bằng bản sao lưu. App sẽ giữ một bản hiện tại trong thư mục backups trước khi ghi đè.',
      confirmLabel: 'Khôi phục',
      danger: true
    })
    if (!ok) return
    try {
      const result = fromList
        ? await window.api.backup.restoreNamed(fromList)
        : await window.api.backup.restoreFile()
      if (!result) return
      await refreshAll()
      const list = await window.api.backup.list()
      setBackups(list)
      toast({
        tone: 'success',
        title: 'Đã khôi phục',
        description: `${result.profiles} hồ sơ · ${result.groups} nhóm`
      })
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Không khôi phục được',
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  async function checkUpdates(): Promise<void> {
    setUpdateNote('Đang kiểm tra...')
    try {
      const result: UpdateCheckResult = await window.api.app.checkUpdates(
        (form?.updateFeedUrl ?? '').trim()
      )
      if (result.status === 'dev') {
        setUpdateNote(`Bản dev v${result.current} — đóng gói installer mới kiểm tra được.`)
      } else if (result.status === 'unconfigured') {
        setUpdateNote('Chưa có URL nguồn cập nhật. Dán link thư mục chứa latest.yml rồi lưu.')
      } else if (result.status === 'latest') {
        setUpdateNote(`Đang dùng bản mới nhất (v${result.current}).`)
      } else if (result.status === 'available') {
        setUpdateNote(`Có bản v${result.version} (hiện tại v${result.current}).`)
      } else {
        setUpdateNote(result.error)
      }
    } catch (error) {
      setUpdateNote(error instanceof Error ? error.message : 'Không kiểm tra được')
    }
  }

  if (!form) {
    return (
      <div className="animate-fade-up max-w-3xl space-y-4">
        <PageHeader
          title="Cài đặt"
          description="Cấu hình đường dẫn Chrome, thư mục dữ liệu hồ sơ và hành vi ứng dụng."
        />
        <div className="panel space-y-4 p-5">
          <div className="h-10 animate-pulse rounded-lg bg-surface-muted" />
          <div className="h-10 animate-pulse rounded-lg bg-surface-muted" />
          <div className="h-20 animate-pulse rounded-lg bg-surface-muted" />
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-up max-w-3xl">
      <PageHeader
        title="Cài đặt"
        description="Cấu hình đường dẫn Chrome, thư mục dữ liệu hồ sơ và hành vi ứng dụng."
        actions={
          dirty ? (
            <span className="rounded-lg bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning">
              Chưa lưu
            </span>
          ) : null
        }
      />

      <form className="panel space-y-5 p-5" onSubmit={(e) => void onSubmit(e)}>
        {dirty ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            Có thay đổi chưa lưu. Nhấn Lưu cài đặt để áp dụng.
          </div>
        ) : null}
        <div>
          <label className="label">Đường dẫn Chrome</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="input min-w-0 font-mono text-xs"
              value={form.chromePath}
              onChange={(e) => setForm({ ...form, chromePath: e.target.value })}
              placeholder="C:\Program Files\Google\Chrome\Application\chrome.exe"
            />
            <button
              type="button"
              className="btn-secondary shrink-0"
              disabled={detecting}
              onClick={() => void onDetectChrome()}
            >
              {detecting ? 'Đang tìm...' : 'Tự động tìm'}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Thư mục dữ liệu hồ sơ</label>
            <p className="mb-2 text-xs text-ink-muted">
              Có thể dùng nhiều ổ cùng lúc. Hồ sơ cũ giữ nguyên thư mục; hồ sơ mới tạo vào thư mục
              đang chọn bên dưới. Mở Chrome từ cả hai ổ vẫn chạy song song.
            </p>
            <div className="space-y-2">
              <div className="rounded-xl border border-line bg-surface-muted/30 p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Ổ hiện tại
                  </span>
                  <span className="text-[11px] text-ink-muted">Hồ sơ đã có vẫn nằm đây</span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className="input min-w-0 font-mono text-xs"
                    value={form.profilesRoot}
                    onChange={(e) => setForm({ ...form, profilesRoot: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn-secondary shrink-0"
                    onClick={() => void pickRoot('primary')}
                  >
                    <FolderOpen size={14} />
                    Chọn
                  </button>
                  <button
                    type="button"
                    className="btn-ghost shrink-0"
                    title="Mở trong Explorer"
                    onClick={() => void openFolder(form.profilesRoot)}
                  >
                    <ExternalLink size={14} />
                    Mở
                  </button>
                </div>
                <DiskHint info={diskFor(form.profilesRoot)} />
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
                  <input
                    type="radio"
                    name="create-profiles-root"
                    className="accent-[var(--accent)]"
                    checked={
                      resolveCreateProfilesRoot(form).toLowerCase() ===
                      form.profilesRoot.trim().replace(/[/\\]+$/, '').toLowerCase()
                    }
                    onChange={() => setForm({ ...form, createProfilesRoot: form.profilesRoot })}
                  />
                  Tạo hồ sơ mới vào đây
                </label>
              </div>

              {extraRoots().map((root, index) => (
                <div key={`extra-${index}`} className="rounded-xl border border-line bg-surface-muted/30 p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                      Ổ bổ sung {extraRoots().length > 1 ? index + 1 : ''}
                    </span>
                    {index === 0 ? (
                      <span className="text-[11px] text-ink-muted">
                        Mặc định {SUGGESTED_EXTRA_PROFILES_ROOT}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      className="input min-w-0 font-mono text-xs"
                      value={root}
                      onChange={(e) => {
                        const extras = extraRoots()
                        extras[index] = e.target.value
                        setForm({ ...form, additionalProfilesRoots: extras })
                      }}
                      placeholder={SUGGESTED_EXTRA_PROFILES_ROOT}
                    />
                    <button
                      type="button"
                      className="btn-secondary shrink-0"
                      onClick={() => void pickRoot('extra', index)}
                    >
                      <FolderOpen size={14} />
                      Chọn
                    </button>
                    <button
                      type="button"
                      className="btn-ghost shrink-0"
                      title="Mở trong Explorer"
                      onClick={() => void openFolder(root)}
                    >
                      <ExternalLink size={14} />
                      Mở
                    </button>
                    {extraRoots().length > 1 ? (
                      <button
                        type="button"
                        className="btn-ghost shrink-0 text-danger"
                        title="Gỡ thư mục này"
                        onClick={() => {
                          const extras = extraRoots().filter((_, i) => i !== index)
                          const nextCreate =
                            resolveCreateProfilesRoot({
                              ...form,
                              additionalProfilesRoots: extras
                            }) || form.profilesRoot
                          setForm({
                            ...form,
                            additionalProfilesRoots: extras,
                            createProfilesRoot: nextCreate
                          })
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </div>
                  <DiskHint info={diskFor(root)} />
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
                    <input
                      type="radio"
                      name="create-profiles-root"
                      className="accent-[var(--accent)]"
                      checked={
                        resolveCreateProfilesRoot(form).toLowerCase() ===
                        root.trim().replace(/[/\\]+$/, '').toLowerCase()
                      }
                      onChange={() => setForm({ ...form, createProfilesRoot: root })}
                    />
                    Tạo hồ sơ mới vào đây
                  </label>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn-ghost mt-2 text-sm"
              onClick={() =>
                setForm({
                  ...form,
                  additionalProfilesRoots: uniqueRootPaths([
                    ...extraRoots(),
                    SUGGESTED_EXTRA_PROFILES_ROOT
                  ])
                })
              }
            >
              <Plus size={14} />
              Thêm thư mục
            </button>
            {collectProfilesRoots(form).length > 1 ? (
              <p className="mt-2 text-xs text-ink-muted">
                Đang dùng {collectProfilesRoots(form).length} thư mục. Hồ sơ mới →{' '}
                <span className="font-mono text-ink-soft">{resolveCreateProfilesRoot(form)}</span>
              </p>
            ) : null}
          </div>
        </div>

        <div>
          <label className="label">User Agent mặc định</label>
          <textarea
            className="input min-h-[88px] font-mono text-xs"
            value={form.defaultUserAgent}
            onChange={(e) => setForm({ ...form, defaultUserAgent: e.target.value })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Giao diện</label>
            <select
              className="input"
              value={form.theme}
              onChange={(e) => void onThemeChange(e.target.value as AppSettings['theme'])}
            >
              <option value="system">Theo hệ thống</option>
              <option value="light">Sáng</option>
              <option value="dark">Tối</option>
            </select>
          </div>
          <div>
            <label className="label">Số hồ sơ mở đồng thời tối đa</label>
            <input
              className="input"
              type="number"
              min={1}
              max={25}
              value={form.maxConcurrentLaunches}
              onChange={(e) =>
                setForm({
                  ...form,
                  maxConcurrentLaunches: Math.min(25, Math.max(1, Number(e.target.value) || 1))
                })
              }
            />
            <div className="mt-1 text-[11px] text-ink-muted">
              Khi mở nhiều hồ sơ, app chỉ khởi chạy tối đa số này cùng lúc, mỗi hồ sơ cách nhau 1 giây.
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface-muted/40 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <label className="label !mb-0" htmlFor="step-speed">
              Tốc độ các bước
            </label>
            <span className="text-sm font-medium text-ink">
              ×{clampStepSpeed(form.stepSpeed ?? STEP_SPEED_DEFAULT)} ·{' '}
              {stepSpeedLabel(form.stepSpeed ?? STEP_SPEED_DEFAULT)}
            </span>
          </div>
          <input
            id="step-speed"
            className="mt-3 w-full accent-[var(--accent)]"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(stepSpeedToSlider(form.stepSpeed ?? STEP_SPEED_DEFAULT))}
            onChange={(e) =>
              setForm({ ...form, stepSpeed: sliderToStepSpeed(Number(e.target.value)) })
            }
          />
          <div className="mt-1 flex justify-between text-[11px] text-ink-muted">
            <span>Chậm</span>
            <span>Bình thường</span>
            <span>Nhanh</span>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            ×1 là tốc độ mặc định. Kéo sang phải để đăng nhập Gmail và các bước sau đó (ảnh, Sheet,
            Form) chạy nhanh hơn; kéo sang trái để chậm lại. Thời gian chờ trang tải không bị rút
            ngắn.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-muted/40 px-4 py-3">
          <div className="min-w-0 text-sm text-ink-soft">
            <div className="font-medium text-ink">Đóng hồ sơ khi thoát app</div>
            <div className="mt-0.5 text-xs text-ink-muted">
              Tự động đóng tất cả cửa sổ Chrome do app mở khi thoát.
            </div>
          </div>
          <Switch
            checked={form.closeOnExit}
            label="Đóng hồ sơ khi thoát app"
            onChange={(checked) => setForm({ ...form, closeOnExit: checked })}
          />
        </div>

        <div className="rounded-xl border border-line bg-surface-muted/30 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-ink">
            <HardDrive size={15} />
            Sao lưu dữ liệu
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Mỗi lần mở app tự giữ tối đa 10 bản trong thư mục backups. Có thể xuất file riêng hoặc
            khôi phục.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => void exportBackup()}>
              Xuất file
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => void restoreBackup()}>
              <Upload size={14} />
              Khôi phục từ file
            </button>
            {backupDir ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => void openFolder(backupDir)}
              >
                <FolderOpen size={14} />
                Mở thư mục
              </button>
            ) : null}
          </div>
          {backups.length > 0 ? (
            <ul className="mt-3 max-h-36 space-y-1 overflow-auto text-xs">
              {backups.slice(0, 8).map((item) => (
                <li
                  key={item.path}
                  className="flex items-center justify-between gap-2 rounded-md border border-line px-2 py-1.5"
                >
                  <span className="min-w-0 truncate text-ink-soft" title={item.path}>
                    {formatDate(item.mtime)} · {item.name}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost shrink-0 !px-2 !py-1"
                    onClick={() => void restoreBackup(item.path)}
                  >
                    Dùng
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">Chưa có bản tự động — sẽ có sau lần mở app tới.</p>
          )}
        </div>

        <div className="rounded-xl border border-line bg-surface-muted/30 px-4 py-3 text-sm">
          <div className="font-medium text-ink">Cập nhật phiên bản</div>
          <label className="label mt-3">URL nguồn (generic feed, latest.yml)</label>
          <input
            className="input font-mono text-xs"
            value={form.updateFeedUrl ?? ''}
            onChange={(e) => setForm({ ...form, updateFeedUrl: e.target.value })}
            placeholder="https://example.com/chrome-manager-updates/"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => void checkUpdates()}>
              <RefreshCw size={14} />
              Kiểm tra
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                void (async () => {
                  const ok = await askConfirm({
                    title: 'Cài bản cập nhật?',
                    description: 'App sẽ tải bản mới rồi thoát để cài. Lưu công việc trước.',
                    confirmLabel: 'Tải và cài'
                  })
                  if (!ok) return
                  const result = await window.api.app.installUpdate((form.updateFeedUrl ?? '').trim())
                  if (!result.ok) {
                    toast({ tone: 'error', title: 'Không cài được bản mới', description: result.error })
                  }
                })()
              }}
            >
              Tải và cài
            </button>
          </div>
          {updateNote ? <p className="mt-2 text-xs text-ink-muted">{updateNote}</p> : null}
        </div>

        <div className="rounded-xl border border-line bg-surface-muted/30 px-4 py-3 text-sm">
          <div className="font-medium text-ink">Về ứng dụng</div>
          <p className="mt-1 text-xs text-ink-muted">
            Chrome Manager {appVersion ? `v${appVersion}` : ''} · cửa sổ nhớ kích thước · F1 xem phím
            tắt. Đóng gói: npm run dist
          </p>
        </div>

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
          </button>
        </div>
      </form>
    </div>
  )
}
