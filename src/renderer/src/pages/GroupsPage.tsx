import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Pencil, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Switch } from '@/components/ui/Switch'
import { useAppStore } from '@/stores/app-store'
import { askConfirm, toast } from '@/stores/ui-store'
import { GROUP_COLORS, type ChromeProfile, type ProfileGroup, type ProfileStatusPatch } from '@shared/types'
import {
  parseImportGroupsJson,
  summarizeImportPayload
} from '@shared/group-import'
import { summarizeDataImport, type DataImportPreview } from '@shared/data-import'
import {
  DEFAULT_PROFILE_PREFIX,
  cn,
  formatDate,
  formatProfileName,
  formatRelative,
  suggestNextIndex
} from '@/lib/utils'

type GroupSortKey = 'name' | 'count' | 'lastUse' | 'updatedAt' | 'restore'

const IMPORT_EXAMPLE = `{
  "version": 1,
  "groups": [
    {
      "name": "Dự án A",
      "color": "#0F766E",
      "description": "",
      "restoreLastSession": true,
      "profiles": [
        {
          "name": "Dự án A 01",
          "proxy": "host:port:user:pass",
          "gmail": "mail@gmail.com|password|2fasecret"
        }
      ]
    }
  ]
}`

export function GroupsPage(): JSX.Element {
  const groups = useAppStore((s) => s.groups)
  const [groupProfiles, setGroupProfiles] = useState<ChromeProfile[]>([])
  const createGroup = useAppStore((s) => s.createGroup)
  const createProfiles = useAppStore((s) => s.createProfiles)
  const updateGroup = useAppStore((s) => s.updateGroup)
  const deleteGroup = useAppStore((s) => s.deleteGroup)
  const importGroups = useAppStore((s) => s.importGroups)
  const exportGroups = useAppStore((s) => s.exportGroups)
  const importDataPath = useAppStore((s) => s.importDataPath)
  const refreshGroups = useAppStore((s) => s.refreshGroups)
  const settings = useAppStore((s) => s.settings)

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<ProfileGroup | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string>(GROUP_COLORS[0])
  const [restoreLastSession, setRestoreLastSession] = useState(true)
  const [profileCount, setProfileCount] = useState(0)

  const [importOpen, setImportOpen] = useState(false)
  const [importRaw, setImportRaw] = useState('')
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [dataPath, setDataPath] = useState('')
  const [dataPreview, setDataPreview] = useState<DataImportPreview | null>(null)
  const [dataPreviewError, setDataPreviewError] = useState<string | null>(null)
  const [importTab, setImportTab] = useState<'folder' | 'json'>('folder')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<GroupSortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const loadGroupProfiles = useCallback(async (): Promise<void> => {
    const all = await window.api.profiles.list()
    setGroupProfiles(all)
  }, [])

  useEffect(() => {
    void loadGroupProfiles()
    return window.api.profiles.onStatusChanged((patch: ProfileStatusPatch) => {
      setGroupProfiles((current) =>
        current.map((profile) =>
          profile.id === patch.id
            ? {
                ...profile,
                status: patch.status,
                lastLaunchedAt: patch.lastLaunchedAt,
                updatedAt: patch.updatedAt
              }
            : profile
        )
      )
    })
  }, [loadGroupProfiles])

  const profileCountByGroup = useMemo(() => {
    const map = new Map<string, number>()
    for (const profile of groupProfiles) {
      if (!profile.groupId) continue
      map.set(profile.groupId, (map.get(profile.groupId) ?? 0) + 1)
    }
    return map
  }, [groupProfiles])

  const lastUseByGroup = useMemo(() => {
    function isActive(profile: ChromeProfile): boolean {
      return (
        profile.status === 'running' ||
        profile.status === 'starting' ||
        profile.status === 'stopping'
      )
    }

    const best = new Map<string, ChromeProfile>()
    for (const profile of groupProfiles) {
      if (!profile.groupId) continue
      if (!profile.lastLaunchedAt && !isActive(profile)) continue
      const current = best.get(profile.groupId)
      if (!current) {
        best.set(profile.groupId, profile)
        continue
      }
      const nextAt = profile.lastLaunchedAt ?? ''
      const currentAt = current.lastLaunchedAt ?? ''
      if (nextAt > currentAt || (nextAt === currentAt && isActive(profile) && !isActive(current))) {
        best.set(profile.groupId, profile)
      }
    }

    const map = new Map<string, { name: string; at: string | null; active: boolean }>()
    for (const [groupId, profile] of best) {
      map.set(groupId, {
        name: profile.name,
        at: profile.lastLaunchedAt,
        active: isActive(profile)
      })
    }
    return map
  }, [groupProfiles])

  const visibleGroups = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const filtered = keyword
      ? groups.filter((group) =>
          `${group.name} ${group.description}`.toLowerCase().includes(keyword)
        )
      : groups

    function lastUseTime(groupId: string): number {
      const last = lastUseByGroup.get(groupId)
      if (!last) return Number.NEGATIVE_INFINITY
      if (last.at) {
        const time = new Date(last.at).getTime()
        if (!Number.isNaN(time)) return time
      }
      return last.active ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
    }

    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' })
      } else if (sortKey === 'count') {
        cmp = (profileCountByGroup.get(a.id) ?? 0) - (profileCountByGroup.get(b.id) ?? 0)
      } else if (sortKey === 'lastUse') {
        cmp = lastUseTime(a.id) - lastUseTime(b.id)
      } else if (sortKey === 'updatedAt') {
        cmp = a.updatedAt.localeCompare(b.updatedAt)
      } else {
        cmp = Number(a.restoreLastSession !== false) - Number(b.restoreLastSession !== false)
      }
      if (cmp === 0) cmp = a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [groups, query, sortKey, sortDir, profileCountByGroup, lastUseByGroup])

  function toggleSort(key: GroupSortKey): void {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(key === 'name' ? 'asc' : 'desc')
  }

  function sortHeader(key: GroupSortKey, label: string, className?: string): JSX.Element {
    const active = sortKey === key
    const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown
    return (
      <th className={cn('px-3 py-2.5 font-medium', className)}>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 uppercase tracking-wide',
            active ? 'text-ink' : 'hover:text-ink'
          )}
          onClick={() => toggleSort(key)}
        >
          {label}
          <Icon size={12} className={active ? 'text-accent' : 'opacity-40'} />
        </button>
      </th>
    )
  }

  // Giống ProfileFormModal: tiền tố = tên nhóm, số bắt đầu từ 1 (nhóm mới)
  const namePrefix = name.trim() || DEFAULT_PROFILE_PREFIX
  const safeProfileCount = Math.min(500, Math.max(0, Math.floor(profileCount) || 0))
  const startIndex = 1
  const namePad = Math.max(2, String(startIndex + Math.max(safeProfileCount, 1) - 1).length)
  const previewNames = useMemo(() => {
    if (safeProfileCount <= 0) return []
    const samples = Array.from({ length: Math.min(3, safeProfileCount) }, (_, i) =>
      formatProfileName(namePrefix, startIndex + i, namePad)
    )
    if (safeProfileCount > 3) {
      samples.push(`… ${formatProfileName(namePrefix, startIndex + safeProfileCount - 1, namePad)}`)
    }
    return samples
  }, [safeProfileCount, namePrefix, namePad])

  const importPreview = useMemo(() => {
    const text = importRaw.trim()
    if (!text) return null
    try {
      return { ok: true as const, ...summarizeImportPayload(parseImportGroupsJson(text)) }
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : 'JSON không hợp lệ'
      }
    }
  }, [importRaw])

  function openCreate(): void {
    setEditing(null)
    setName('')
    setDescription('')
    setColor(GROUP_COLORS[groups.length % GROUP_COLORS.length])
    setRestoreLastSession(true)
    setProfileCount(0)
    setOpen(true)
  }

  function openEdit(group: ProfileGroup): void {
    setEditing(group)
    setName(group.name)
    setDescription(group.description)
    setColor(group.color)
    setRestoreLastSession(group.restoreLastSession !== false)
    setProfileCount(0)
    setOpen(true)
  }

  function openImport(): void {
    setImportRaw('')
    setDataPath('')
    setDataPreview(null)
    setDataPreviewError(null)
    setImportTab('folder')
    setImportOpen(true)
  }

  async function onPickImportFile(): Promise<void> {
    try {
      const content = await window.api.groups.pickImportFile()
      if (content == null) return
      setImportRaw(content)
      setImportTab('json')
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Không đọc được file',
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  async function onPickDataFolder(): Promise<void> {
    try {
      const selected = await window.api.groups.pickDataPath()
      if (!selected) return
      setDataPath(selected)
      setDataPreviewError(null)
      const preview = await window.api.groups.previewDataImport(selected)
      setDataPreview(preview)
      setImportTab('folder')
    } catch (error) {
      setDataPreview(null)
      setDataPreviewError(error instanceof Error ? error.message : 'Không đọc được thư mục')
    }
  }

  async function onImportDataFolder(): Promise<void> {
    if (importing || !dataPath || !dataPreview) return
    setImporting(true)
    try {
      const result = await importDataPath(dataPath)
      await loadGroupProfiles()
      const summary = summarizeDataImport(result)
      toast({
        tone: summary.tone,
        title: summary.title,
        description: summary.description
      })
      setImportOpen(false)
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Không thể nhập thư mục',
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setImporting(false)
    }
  }

  async function onImportSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (importing || !importPreview?.ok) return
    setImporting(true)
    try {
      const result = await importGroups(importRaw)
      await loadGroupProfiles()
      const skipNote =
        result.skipped.length > 0
          ? ` Bỏ qua ${result.skipped.length} hồ sơ (thường do trùng email).`
          : ''
      toast({
        tone: result.skipped.length > 0 ? 'warning' : 'success',
        title: 'Đã nhập nhóm',
        description: `Tạo ${result.groupsCreated} nhóm, ${result.profilesCreated} hồ sơ.${skipNote}`
      })
      setImportOpen(false)
      setImportRaw('')
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Không thể nhập nhóm',
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setImporting(false)
    }
  }

  async function onReload(): Promise<void> {
    if (reloading) return
    setReloading(true)
    try {
      await Promise.all([refreshGroups(), loadGroupProfiles()])
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Không thể tải lại',
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setReloading(false)
    }
  }

  async function onExportAll(): Promise<void> {
    if (exporting || groups.length === 0) return
    setExporting(true)
    try {
      const json = await exportGroups()
      const path = await window.api.groups.saveExportFile(json, 'chrome-manager-groups.json')
      if (!path) return
      toast({
        tone: 'success',
        title: 'Đã xuất nhóm',
        description: path
      })
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Không thể xuất nhóm',
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setExporting(false)
    }
  }

  async function onExportOne(group: ProfileGroup): Promise<void> {
    try {
      const json = await exportGroups([group.id])
      const safeName = group.name.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'group'
      const path = await window.api.groups.saveExportFile(
        json,
        `chrome-manager-${safeName}.json`
      )
      if (!path) return
      toast({
        tone: 'success',
        title: 'Đã xuất nhóm',
        description: path
      })
    } catch (error) {
      toast({
        tone: 'error',
        title: 'Không thể xuất nhóm',
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      if (editing) {
        await updateGroup(editing.id, { name, description, color, restoreLastSession })
        toast({ tone: 'success', title: 'Đã cập nhật nhóm' })
      } else {
        const group = await createGroup({ name, description, color, restoreLastSession })
        const count = Math.min(500, Math.max(0, Math.floor(profileCount) || 0))
        if (count > 0) {
          // Cùng logic đặt tên với form Tạo hồ sơ (Hồ sơ)
          const nextPrefix = group.name.trim() || DEFAULT_PROFILE_PREFIX
          const all = await window.api.profiles.list()
          const scoped = all.filter((p) => p.groupId === group.id)
          const next = suggestNextIndex(
            scoped.map((p) => p.name),
            nextPrefix
          )
          await createProfiles({
            name: nextPrefix,
            groupId: group.id,
            userAgent: settings?.defaultUserAgent ?? '',
            homepage: 'chrome://newtab/',
            count,
            startIndex: next
          })
          await loadGroupProfiles()
          toast({
            tone: 'success',
            title: 'Đã tạo nhóm',
            description: `Đã tạo ${count} hồ sơ trong nhóm.`
          })
        } else {
          toast({ tone: 'success', title: 'Đã tạo nhóm' })
        }
      }
      setOpen(false)
    } catch (error) {
      toast({
        tone: 'error',
        title: editing ? 'Không thể cập nhật nhóm' : 'Không thể tạo nhóm',
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Nhóm hồ sơ"
        description="Phân loại hồ sơ theo dự án, khách hàng hoặc mục đích vận hành."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void onReload()}
              disabled={reloading}
            >
              <RefreshCw size={16} className={reloading ? 'animate-spin' : undefined} />
              {reloading ? 'Đang tải...' : 'Tải lại'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void onExportAll()}
              disabled={groups.length === 0 || exporting}
            >
              <Download size={16} />
              {exporting ? 'Đang xuất...' : 'Xuất JSON'}
            </button>
            <button type="button" className="btn-secondary" onClick={openImport}>
              <Upload size={16} />
              Nhập nhóm
            </button>
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus size={16} />
              Tạo nhóm
            </button>
          </div>
        }
      />

      {groups.length === 0 ? (
        <EmptyState
          title="Chưa có nhóm"
          description="Tạo nhóm để tổ chức hồ sơ dễ tìm kiếm và thao tác hàng loạt hơn."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className="btn-secondary" onClick={openImport}>
                <Upload size={16} />
                Nhập nhóm
              </button>
              <button type="button" className="btn-primary" onClick={openCreate}>
                Tạo nhóm đầu tiên
              </button>
            </div>
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative min-w-0 sm:max-w-sm sm:flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
              />
              <input
                className="input pl-9"
                placeholder="Tìm theo tên hoặc mô tả nhóm..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="text-xs text-ink-muted">
              {query.trim()
                ? `${visibleGroups.length} / ${groups.length} nhóm`
                : `${groups.length} nhóm`}
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="sticky top-0 z-[1] bg-surface-muted/95 text-xs uppercase tracking-wide text-ink-muted backdrop-blur-sm">
                  <tr>
                    {sortHeader('name', 'Nhóm')}
                    {sortHeader('count', 'Hồ sơ', 'w-20')}
                    {sortHeader('lastUse', 'Lần dùng cuối')}
                    {sortHeader('updatedAt', 'Cập nhật')}
                    {sortHeader('restore', 'Tab cũ', 'w-24')}
                    <th className="w-28 px-3 py-2.5 text-right font-medium">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleGroups.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-sm text-ink-muted">
                        Không có nhóm khớp “{query.trim()}”.
                      </td>
                    </tr>
                  ) : (
                    visibleGroups.map((group) => {
                      const count = profileCountByGroup.get(group.id) ?? 0
                      const lastUse = lastUseByGroup.get(group.id) ?? null
                      const lastUseLabel = !lastUse
                        ? 'Chưa chạy'
                        : lastUse.at
                          ? `${formatDate(lastUse.at)} · ${lastUse.name}`
                          : `Đang chạy · ${lastUse.name}`
                      const lastUseTitle = !lastUse
                        ? 'Chưa có hồ sơ nào trong nhóm được chạy'
                        : lastUse.active
                          ? `${lastUse.name} đang chạy${lastUse.at ? ` · ${formatRelative(lastUse.at)}` : ''}`
                          : `${lastUse.name} · ${formatRelative(lastUse.at)}`
                      return (
                        <tr
                          key={group.id}
                          className="border-t border-line transition hover:bg-surface-muted/40"
                        >
                          <td className="px-3 py-2 align-middle">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: group.color }}
                              />
                              <div className="min-w-0">
                                <div className="truncate font-medium text-ink">{group.name}</div>
                                {group.description ? (
                                  <div className="truncate text-xs text-ink-muted">
                                    {group.description}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 align-middle text-ink-soft">
                            {count}
                          </td>
                          <td
                            className="max-w-[240px] px-3 py-2 align-middle text-xs text-ink-muted"
                            title={lastUseTitle}
                          >
                            <div className="truncate">{lastUseLabel}</div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 align-middle text-xs text-ink-muted">
                            {formatDate(group.updatedAt)}
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <Switch
                              size="sm"
                              checked={group.restoreLastSession}
                              label="Tab cũ"
                              title="Mở lại tab lần chạy trước cho cả nhóm"
                              onChange={(next) =>
                                void updateGroup(group.id, { restoreLastSession: next })
                              }
                            />
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <div className="flex justify-end gap-0.5">
                              <button
                                type="button"
                                className="btn-ghost btn-icon"
                                aria-label="Xuất nhóm"
                                title="Xuất nhóm (JSON)"
                                onClick={() => void onExportOne(group)}
                              >
                                <Download size={15} />
                              </button>
                              <button
                                type="button"
                                className="btn-ghost btn-icon"
                                aria-label="Sửa nhóm"
                                onClick={() => openEdit(group)}
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                type="button"
                                className="btn-ghost btn-icon text-danger"
                                aria-label="Xóa nhóm"
                                onClick={async () => {
                                  const ok = await askConfirm({
                                    title: `Xóa nhóm "${group.name}"?`,
                                    description:
                                      count > 0
                                        ? `Sẽ xóa vĩnh viễn ${count} hồ sơ trong nhóm (kèm dữ liệu Chrome). Không thể hoàn tác.`
                                        : 'Nhóm này không có hồ sơ. Bạn có chắc muốn xóa?',
                                    confirmLabel: 'Xóa nhóm',
                                    danger: true
                                  })
                                  if (!ok) return
                                  try {
                                    await deleteGroup(group.id)
                                    await loadGroupProfiles()
                                    toast({
                                      tone: 'success',
                                      title: 'Đã xóa nhóm',
                                      description:
                                        count > 0 ? `Đã xóa ${count} hồ sơ trong nhóm.` : undefined
                                    })
                                  } catch (error) {
                                    toast({
                                      tone: 'error',
                                      title: 'Không thể xóa nhóm',
                                      description:
                                        error instanceof Error ? error.message : undefined
                                    })
                                  }
                                }}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Sửa nhóm' : 'Tạo nhóm mới'}
      >
        <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
          <div>
            <label className="label">Tên nhóm</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {!editing && (
            <>
              <div>
                <label className="label">Số lượng hồ sơ</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={500}
                  value={profileCount}
                  onChange={(e) => setProfileCount(Number(e.target.value))}
                />
                <p className="mt-1.5 text-xs text-ink-muted">
                  Nhập 0 nếu chỉ tạo nhóm trống. Tên hồ sơ tự động giống trang Hồ sơ.
                </p>
              </div>
              {safeProfileCount > 0 && (
                <div className="rounded-xl border border-line bg-surface-muted/40 p-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Tên tự động
                  </div>
                  <div className="font-mono text-sm text-ink">
                    {previewNames.join(' · ') ||
                      formatProfileName(namePrefix, startIndex, namePad)}
                  </div>
                  <div className="mt-2 text-xs text-ink-muted">
                    Tiền tố <span className="font-medium text-ink-soft">{namePrefix}</span>, bắt
                    đầu từ <span className="font-medium text-ink-soft">{startIndex}</span> (theo
                    hồ sơ trong nhóm)
                  </div>
                </div>
              )}
            </>
          )}
          <div>
            <label className="label">Mô tả</label>
            <textarea
              className="input min-h-[80px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Màu</label>
            <div className="flex flex-wrap gap-2">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="h-8 w-8 rounded-full border-2 border-transparent transition"
                  style={{
                    backgroundColor: c,
                    outline: color === c ? `2px solid ${c}` : undefined,
                    outlineOffset: 2
                  }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface-muted/40 px-4 py-3">
            <div className="min-w-0 text-sm text-ink-soft">
              <div className="font-medium text-ink">Mở lại tab lần chạy trước</div>
              <div className="mt-0.5 text-xs text-ink-muted">
                Áp dụng cho mọi hồ sơ trong nhóm (mặc định bật). Khi bật, trang khởi đầu bị bỏ qua.
              </div>
            </div>
            <Switch
              checked={restoreLastSession}
              label="Mở lại tab lần chạy trước"
              onChange={setRestoreLastSession}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Hủy
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Đang lưu...' : editing ? 'Cập nhật' : 'Tạo nhóm'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Nhập nhóm / hồ sơ">
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              className={importTab === 'folder' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setImportTab('folder')}
            >
              Thư mục hồ sơ
            </button>
            <button
              type="button"
              className={importTab === 'json' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setImportTab('json')}
            >
              JSON
            </button>
          </div>

          {importTab === 'folder' ? (
            <div className="space-y-4">
              <p className="text-sm text-ink-muted">
                Chọn một thư mục UUID (ví dụ{' '}
                <span className="font-mono text-ink-soft">E:\0dde16d0-…</span>) để gắn đúng hồ sơ đó —
                giữ Gmail và tab đang có. Chọn cả{' '}
                <span className="font-medium text-ink-soft">chrome-profiles</span> /{' '}
                <span className="font-medium text-ink-soft">data</span> khi chuyển máy (sẽ copy session).
                Đóng Chrome đang mở thư mục nguồn trước khi nhập. JSON thuần chỉ mang tên, không mang
                session.
              </p>
              <button type="button" className="btn-secondary" onClick={() => void onPickDataFolder()}>
                Chọn thư mục…
              </button>
              {dataPath && (
                <div className="rounded-xl border border-line bg-surface-muted/40 p-3 text-xs text-ink-muted break-all">
                  {dataPath}
                </div>
              )}
              {dataPreviewError && (
                <div className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                  {dataPreviewError}
                </div>
              )}
              {dataPreview && (
                <div className="rounded-xl border border-line bg-surface-muted/40 p-3 text-sm text-ink-soft">
                  Chế độ:{' '}
                  <span className="font-medium text-ink">
                    {dataPreview.mode === 'groups'
                      ? 'Nhóm + hồ sơ'
                      : dataPreview.mode === 'profiles'
                        ? 'Chỉ hồ sơ (có metadata)'
                        : 'Thư mục Chrome → hồ sơ'}
                  </span>
                  <div className="mt-1 text-xs text-ink-muted">
                    DB: {dataPreview.dbFound ? 'có' : 'không'} · Nhóm mới ~{dataPreview.groupCount} ·
                    Hồ sơ mới ~{dataPreview.profileCount} · Thư mục {dataPreview.folderCount} (mồ côi{' '}
                    {dataPreview.orphanFolderCount}, chữa {dataPreview.healCount}, có sẵn{' '}
                    {dataPreview.alreadyPresentCount})
                  </div>
                  {dataPreview.alreadyPresentNames.length > 0 && (
                    <div className="mt-1 text-xs text-ink-muted">
                      Đã có: {dataPreview.alreadyPresentNames.join(' · ')}
                      {dataPreview.alreadyPresentCount > dataPreview.alreadyPresentNames.length
                        ? ' …'
                        : ''}
                    </div>
                  )}
                  {dataPreview.groupNames.length > 0 && (
                    <div className="mt-1 text-xs text-ink-muted">
                      {dataPreview.groupNames.join(' · ')}
                      {dataPreview.groupCount > dataPreview.groupNames.length ? ' …' : ''}
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setImportOpen(false)}>
                  Hủy
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={
                    importing ||
                    !dataPreview ||
                    dataPreview.folderCount +
                      dataPreview.profileCount +
                      dataPreview.groupCount +
                      dataPreview.healCount +
                      dataPreview.alreadyPresentCount ===
                      0
                  }
                  onClick={() => void onImportDataFolder()}
                >
                  {importing ? 'Đang nhập...' : 'Nhập từ thư mục'}
                </button>
              </div>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={(e) => void onImportSubmit(e)}>
              <p className="text-sm text-ink-muted">
                Dán JSON nhóm (không mang session Chrome). Muốn giữ session hãy dùng tab thư mục.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={() => void onPickImportFile()}>
                  Chọn file JSON…
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setImportRaw(IMPORT_EXAMPLE)}
                >
                  Chèn ví dụ
                </button>
              </div>
              <div>
                <label className="label">Nội dung JSON</label>
                <textarea
                  className="input min-h-[220px] font-mono text-xs"
                  value={importRaw}
                  onChange={(e) => setImportRaw(e.target.value)}
                  placeholder={IMPORT_EXAMPLE}
                  spellCheck={false}
                />
              </div>
              {importPreview?.ok === true && (
                <div className="rounded-xl border border-line bg-surface-muted/40 p-3 text-sm text-ink-soft">
                  Sẽ tạo <span className="font-medium text-ink">{importPreview.groupCount}</span> nhóm,{' '}
                  <span className="font-medium text-ink">{importPreview.profileCount}</span> hồ sơ
                  {importPreview.names.length > 0 && (
                    <div className="mt-1 text-xs text-ink-muted">
                      {importPreview.names.slice(0, 5).join(' · ')}
                      {importPreview.names.length > 5 ? ' …' : ''}
                    </div>
                  )}
                </div>
              )}
              {importPreview?.ok === false && (
                <div className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                  {importPreview.error}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setImportOpen(false)}>
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={importing || !importPreview?.ok}
                >
                  {importing ? 'Đang nhập...' : 'Nhập JSON'}
                </button>
              </div>
            </form>
          )}
        </div>
      </Modal>
    </div>
  )
}
