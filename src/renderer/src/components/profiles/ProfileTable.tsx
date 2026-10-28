import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import {
  Eraser,
  History,
  Pencil,
  Play,
  Square,
  Trash2
} from 'lucide-react'
import type { ChromeProfile, ProfileGroup } from '@shared/types'
import { hasAttachedEmail, hasGmailCredentials } from '@shared/gmail'
import { hasProxy } from '@shared/proxy'
import { storageDriveLabel } from '@shared/profile-roots'
import { Badge } from '@/components/ui/Badge'
import { Switch } from '@/components/ui/Switch'
import { cn, formatRelative, statusBadgeTone, statusLabel } from '@/lib/utils'
import {
  DEFAULT_COLUMN_WEIGHTS,
  isColumnVisible,
  PROFILE_COLUMNS,
  type ColumnWeights,
  type ProfileColumnId
} from './profile-columns'

interface ProfileTableProps {
  profiles: ChromeProfile[]
  groups: ProfileGroup[]
  selectedIds: Set<string>
  visibleColumns: ProfileColumnId[]
  columnWeights: ColumnWeights
  onColumnWeightsChange: (weights: ColumnWeights) => void
  onToggle: (id: string) => void
  onSelectAll: () => void
  /** Chọn một dải id (kéo chuột / Shift+click) */
  onSelectIds: (ids: string[]) => void
  onLaunch: (id: string) => void
  onStop: (id: string) => void
  onWipe: (id: string) => void
  onToggleRestore: (groupId: string, enabled: boolean) => void
  onEdit: (profile: ChromeProfile) => void
  onDelete: (id: string) => void
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, label, [role="switch"], [data-no-row-select]'
    )
  )
}

function rangeIds(profiles: ChromeProfile[], from: number, to: number): string[] {
  const a = Math.min(from, to)
  const b = Math.max(from, to)
  return profiles.slice(a, b + 1).map((p) => p.id)
}

export function ProfileTable({
  profiles,
  groups,
  selectedIds,
  visibleColumns,
  columnWeights,
  onColumnWeightsChange,
  onToggle,
  onSelectAll,
  onSelectIds,
  onLaunch,
  onStop,
  onWipe,
  onToggleRestore,
  onEdit,
  onDelete
}: ProfileTableProps): JSX.Element {
  const groupMap = new Map(groups.map((g) => [g.id, g]))
  const allSelected = profiles.length > 0 && profiles.every((p) => selectedIds.has(p.id))
  const show = (id: ProfileColumnId): boolean => isColumnVisible(visibleColumns, id)
  const colCount =
    1 + // checkbox
    (show('name') ? 1 : 0) +
    (show('notes') ? 1 : 0) +
    (show('group') ? 1 : 0) +
    (show('gmail') ? 1 : 0) +
    (show('proxy') ? 1 : 0) +
    (show('restore') ? 1 : 0) +
    (show('status') ? 1 : 0) +
    (show('lastLaunched') ? 1 : 0) +
    (show('actions') ? 1 : 0)

  const visibleOrder = PROFILE_COLUMNS.map((col) => col.id).filter((id) => show(id))
  const weightSum = visibleOrder.reduce((sum, id) => sum + columnWeights[id], 0) || 1
  const tableRef = useRef<HTMLTableElement>(null)
  const weightsRef = useRef(columnWeights)
  weightsRef.current = columnWeights
  const onWeightsChangeRef = useRef(onColumnWeightsChange)
  onWeightsChangeRef.current = onColumnWeightsChange
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => resizeCleanupRef.current?.()
  }, [])

  function columnWidth(id: ProfileColumnId): string {
    return `calc((100% - 3rem) * ${columnWeights[id] / weightSum})`
  }

  function pairAt(id: ProfileColumnId): { nextId: ProfileColumnId; order: ProfileColumnId[] } | null {
    const order = PROFILE_COLUMNS.map((col) => col.id).filter((cid) =>
      isColumnVisible(visibleColumns, cid)
    )
    const index = order.indexOf(id)
    const nextId = order[index + 1]
    if (index < 0 || !nextId) return null
    return { nextId, order }
  }

  function onResizeStart(event: ReactMouseEvent, id: ProfileColumnId): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const pair = pairAt(id)
    const table = tableRef.current
    if (!pair || !table) return
    resizeCleanupRef.current?.()

    const { nextId, order } = pair
    const startX = event.clientX
    const dataWidth = Math.max(1, table.clientWidth - 48)
    const start = { ...weightsRef.current }
    const total = order.reduce((sum, cid) => sum + start[cid], 0)
    const share = start[id] + start[nextId]
    const min = Math.min(share * 0.45, Math.max(4, total * 0.045))

    function onMove(ev: MouseEvent): void {
      const delta = ((ev.clientX - startX) / dataWidth) * total
      const nextWidth = Math.max(min, Math.min(share - min, start[id] + delta))
      onWeightsChangeRef.current({
        ...weightsRef.current,
        [id]: nextWidth,
        [nextId]: share - nextWidth
      })
    }
    function endResize(): void {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', endResize)
      document.body.classList.remove('cursor-col-resize', 'select-none')
      resizeCleanupRef.current = null
    }
    resizeCleanupRef.current = endResize
    document.body.classList.add('cursor-col-resize', 'select-none')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', endResize)
  }

  function resetBoundary(id: ProfileColumnId): void {
    const pair = pairAt(id)
    if (!pair) return
    const current = weightsRef.current
    const share = current[id] + current[pair.nextId]
    const leftDefault = DEFAULT_COLUMN_WEIGHTS[id]
    const rightDefault = DEFAULT_COLUMN_WEIGHTS[pair.nextId]
    const left = (share * leftDefault) / (leftDefault + rightDefault)
    onWeightsChangeRef.current({
      ...current,
      [id]: left,
      [pair.nextId]: share - left
    })
  }

  function headerCell(
    id: ProfileColumnId,
    content: ReactNode,
    options?: { title?: string; align?: 'right' }
  ): JSX.Element | null {
    if (!show(id)) return null
    const label = PROFILE_COLUMNS.find((col) => col.id === id)?.label ?? id
    const canResize = visibleOrder[visibleOrder.length - 1] !== id
    return (
      <th
        className={cn(
          'relative px-3 py-3 font-medium',
          options?.align === 'right' && 'text-right'
        )}
        style={{ width: columnWidth(id) }}
        title={options?.title}
      >
        {content}
        {canResize ? (
          <span
            role="separator"
            aria-orientation="vertical"
            aria-label={`Chỉnh tỷ lệ cột ${label}`}
            title="Kéo để chỉnh tỷ lệ cột. Nhấp đúp để trả hai cột này về tỷ lệ mặc định."
            data-no-row-select
            className="absolute inset-y-0 right-0 z-[2] w-2 cursor-col-resize touch-none border-r border-line hover:border-accent hover:bg-accent/30"
            onMouseDown={(event) => onResizeStart(event, id)}
            onDoubleClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              resetBoundary(id)
            }}
          />
        ) : null}
      </th>
    )
  }

  const anchorIndexRef = useRef(0)
  const dragRef = useRef<{
    startIndex: number
    additive: boolean
    base: Set<string>
    moved: boolean
    /** Plain click lại dòng đang chọn → bỏ chọn khi mouseup (nếu không kéo) */
    toggleOffId: string | null
  } | null>(null)
  const profilesRef = useRef(profiles)
  profilesRef.current = profiles
  const onSelectIdsRef = useRef(onSelectIds)
  onSelectIdsRef.current = onSelectIds

  useEffect(() => {
    function endDrag(): void {
      dragRef.current = null
      document.body.classList.remove('select-none')
    }
    function onUp(): void {
      const drag = dragRef.current
      if (drag && !drag.moved && !drag.additive && drag.toggleOffId) {
        const next = new Set(drag.base)
        next.delete(drag.toggleOffId)
        onSelectIdsRef.current([...next])
      }
      endDrag()
    }
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
      document.body.classList.remove('select-none')
    }
  }, [])

  function applyDragSelection(toIndex: number): void {
    const drag = dragRef.current
    if (!drag) return
    const ids = rangeIds(profilesRef.current, drag.startIndex, toIndex)
    if (drag.additive) {
      const next = new Set(drag.base)
      for (const id of ids) next.add(id)
      onSelectIdsRef.current([...next])
    } else {
      onSelectIdsRef.current(ids)
    }
  }

  function onRowMouseDown(e: ReactMouseEvent, index: number): void {
    if (e.button !== 0) return
    if (isInteractiveTarget(e.target)) return

    // Shift+click: chọn dải từ anchor
    if (e.shiftKey) {
      e.preventDefault()
      const ids = rangeIds(profiles, anchorIndexRef.current, index)
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(selectedIds)
        for (const id of ids) next.add(id)
        onSelectIds([...next])
      } else {
        onSelectIds(ids)
      }
      return
    }

    e.preventDefault()
    document.body.classList.add('select-none')
    const additive = e.ctrlKey || e.metaKey
    const id = profiles[index]?.id
    dragRef.current = {
      startIndex: index,
      additive,
      base: new Set(selectedIds),
      moved: false,
      toggleOffId: null
    }
    anchorIndexRef.current = index

    if (additive) {
      // Ctrl+click: chọn ↔ bỏ chọn dòng hiện tại; kéo thì cộng dải vào base
      const next = new Set(selectedIds)
      if (id) {
        if (next.has(id)) next.delete(id)
        else next.add(id)
        // base giữ selection sau khi toggle dòng đầu — kéo tiếp chỉ thêm dòng mới
        dragRef.current.base = new Set(next)
        onSelectIds([...next])
      }
    } else if (id && selectedIds.has(id)) {
      // Click lại dòng đang chọn → bỏ chọn khi nhả chuột (nếu không kéo)
      dragRef.current.toggleOffId = id
    } else if (id) {
      // Click dòng chưa chọn → chọn dòng đó
      onSelectIds([id])
    }
  }

  function onRowMouseEnter(index: number): void {
    const drag = dragRef.current
    if (!drag) return
    if (index !== drag.startIndex) drag.moved = true
    applyDragSelection(index)
    anchorIndexRef.current = index
  }

  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table
          ref={tableRef}
          className="w-full table-fixed text-left text-sm"
          style={{ minWidth: Math.max(640, colCount * 96) }}
        >
          <colgroup>
            <col style={{ width: '3rem' }} />
            {visibleOrder.map((id) => (
              <col key={id} style={{ width: columnWidth(id) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-[1] bg-surface-muted/95 text-xs uppercase tracking-wide text-ink-muted backdrop-blur-sm">
            <tr>
              <th className="px-3 py-3" style={{ width: '3rem' }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onSelectAll}
                  aria-label="Chọn tất cả"
                />
              </th>
              {headerCell('name', 'Hồ sơ')}
              {headerCell('notes', 'Ghi chú')}
              {headerCell('group', 'Nhóm')}
              {headerCell('gmail', 'Gmail')}
              {headerCell('proxy', 'Proxy', { title: 'Hồ sơ đã gắn proxy hay chưa' })}
              {headerCell(
                'restore',
                <span className="inline-flex items-center gap-1">
                  <History size={12} />
                  Tab cũ
                </span>,
                { title: 'Áp dụng cho cả nhóm — mở lại tab lần chạy trước (mặc định bật)' }
              )}
              {headerCell('status', 'Trạng thái')}
              {headerCell('lastLaunched', 'Lần chạy')}
              {headerCell('actions', 'Thao tác', { align: 'right' })}
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile, index) => {
              const group = profile.groupId ? groupMap.get(profile.groupId) : null
              const selected = selectedIds.has(profile.id)
              const running = profile.status === 'running'
              const hasGmail = hasGmailCredentials(profile.gmail)
              const emailAttached = hasAttachedEmail(profile.gmail)
              const restoreLastSession = group ? group.restoreLastSession : true
              const canToggleRestore = Boolean(group)

              return (
                <tr
                  key={profile.id}
                  data-profile-index={index}
                  className={cn(
                    'border-t border-line transition hover:bg-surface-muted/40',
                    'cursor-pointer',
                    selected && 'bg-accent-soft/50'
                  )}
                  onMouseDown={(e) => onRowMouseDown(e, index)}
                  onMouseEnter={() => onRowMouseEnter(index)}
                >
                  <td className="px-3 py-2.5 align-middle">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggle(profile.id)}
                      aria-label={`Chọn ${profile.name}`}
                    />
                  </td>
                  {show('name') ? (
                    <td className="px-3 py-2.5 align-middle">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <div className="truncate font-medium text-ink" title={profile.name}>
                          {profile.name}
                        </div>
                        {storageDriveLabel(profile.dataDir) ? (
                          <span title={profile.dataDir}>
                            <Badge className="shrink-0">
                              {storageDriveLabel(profile.dataDir)}
                            </Badge>
                          </span>
                        ) : null}
                      </div>
                      {profile.tags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {profile.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag}>{tag}</Badge>
                          ))}
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                  {show('notes') ? (
                    <td className="px-3 py-2.5 align-middle">
                      <div
                        className="line-clamp-2 text-xs text-ink-soft"
                        title={profile.notes || undefined}
                      >
                        {profile.notes || <span className="text-ink-muted">—</span>}
                      </div>
                    </td>
                  ) : null}
                  {show('group') ? (
                    <td className="px-3 py-2.5 align-middle">
                      {group ? (
                        <span className="inline-flex max-w-full items-center gap-2 text-ink-soft">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: group.color }}
                          />
                          <span className="truncate">{group.name}</span>
                        </span>
                      ) : (
                        <span className="text-ink-muted">Chưa nhóm</span>
                      )}
                    </td>
                  ) : null}
                  {show('gmail') ? (
                    <td className="px-3 py-2.5 align-middle">
                      {emailAttached ? (
                        <div className="min-w-0">
                          <div
                            className="truncate font-mono text-xs text-ink-soft"
                            title={profile.gmail?.email}
                          >
                            {profile.gmail?.email}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge tone="success">Đã gắn</Badge>
                            {hasGmail ? <Badge tone="accent">Gmail</Badge> : null}
                            {profile.autoLoginGmail ? <Badge>Auto</Badge> : null}
                          </div>
                        </div>
                      ) : (
                        <Badge>Chưa gắn</Badge>
                      )}
                    </td>
                  ) : null}
                  {show('proxy') ? (
                    <td className="px-3 py-2.5 align-middle">
                      {hasProxy(profile.proxy) ? (
                        <div className="min-w-0">
                          <Badge tone="success" dot>
                            Có
                          </Badge>
                          <div
                            className="mt-1 truncate font-mono text-[11px] text-ink-muted"
                            title={`${profile.proxy.type} · ${profile.proxy.host}:${profile.proxy.port ?? ''}${
                              profile.proxy.username ? ` · ${profile.proxy.username}` : ''
                            }`}
                          >
                            {profile.proxy.host}:{profile.proxy.port ?? ''}
                          </div>
                        </div>
                      ) : (
                        <Badge>Không</Badge>
                      )}
                    </td>
                  ) : null}
                  {show('restore') ? (
                    <td className="px-3 py-2.5 align-middle">
                      <Switch
                        checked={restoreLastSession}
                        disabled={!canToggleRestore}
                        size="sm"
                        label="Tab cũ"
                        title={
                          !canToggleRestore
                            ? 'Chưa nhóm — mặc định bật. Gán nhóm để tắt/bật cho cả nhóm.'
                            : restoreLastSession
                              ? `Đang bật cho nhóm "${group!.name}"`
                              : `Đang tắt cho nhóm "${group!.name}"`
                        }
                        onChange={(next) => {
                          if (!group) return
                          onToggleRestore(group.id, next)
                        }}
                      />
                    </td>
                  ) : null}
                  {show('status') ? (
                    <td className="px-3 py-2.5 align-middle">
                      <Badge
                        tone={statusBadgeTone(profile.status)}
                        dot={running}
                        className="rounded-full"
                      >
                        {statusLabel(profile.status)}
                      </Badge>
                    </td>
                  ) : null}
                  {show('lastLaunched') ? (
                    <td className="whitespace-nowrap px-3 py-2.5 align-middle text-xs text-ink-muted">
                      {formatRelative(profile.lastLaunchedAt)}
                    </td>
                  ) : null}
                  {show('actions') ? (
                    <td className="px-3 py-2.5 align-middle">
                      <div className="flex items-center justify-end gap-0.5">
                        {running ? (
                          <button
                            type="button"
                            className="btn-ghost btn-icon"
                            title="Đóng"
                            onClick={() => onStop(profile.id)}
                          >
                            <Square size={15} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-ghost btn-icon text-accent"
                            title="Mở"
                            onClick={() => onLaunch(profile.id)}
                          >
                            <Play size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-ghost btn-icon text-danger"
                          title="Xóa sạch hồ sơ (Gmail + dữ liệu Chrome → như mới)"
                          onClick={() => onWipe(profile.id)}
                        >
                          <Eraser size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-icon"
                          title="Sửa"
                          onClick={() => onEdit(profile)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-icon text-danger"
                          title="Xóa"
                          onClick={() => onDelete(profile.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
