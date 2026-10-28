export type ProfileColumnId =
  | 'name'
  | 'notes'
  | 'group'
  | 'gmail'
  | 'proxy'
  | 'restore'
  | 'status'
  | 'lastLaunched'
  | 'actions'

export interface ProfileColumnDef {
  id: ProfileColumnId
  label: string
  /** Không cho tắt */
  locked?: boolean
}

export const PROFILE_COLUMNS: ProfileColumnDef[] = [
  { id: 'name', label: 'Hồ sơ', locked: true },
  { id: 'notes', label: 'Ghi chú' },
  { id: 'group', label: 'Nhóm' },
  { id: 'gmail', label: 'Gmail' },
  { id: 'proxy', label: 'Proxy' },
  { id: 'restore', label: 'Tab cũ' },
  { id: 'status', label: 'Trạng thái' },
  { id: 'lastLaunched', label: 'Lần chạy' },
  { id: 'actions', label: 'Thao tác', locked: true }
]

export const DEFAULT_VISIBLE_COLUMNS: ProfileColumnId[] = PROFILE_COLUMNS.map((c) => c.id)

/** Tỷ lệ tương đối giữa các cột (cột checkbox chọn dòng giữ cố định). */
export type ColumnWeights = Record<ProfileColumnId, number>

export const DEFAULT_COLUMN_WEIGHTS: ColumnWeights = {
  name: 16,
  notes: 18,
  group: 12,
  gmail: 20,
  proxy: 14,
  restore: 8,
  status: 10,
  lastLaunched: 10,
  actions: 12
}

const STORAGE_KEY = 'chrome-manager.profile-table-columns'
const WIDTH_STORAGE_KEY = 'chrome-manager.profile-table-column-weights'

export function loadVisibleColumns(): ProfileColumnId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [...DEFAULT_VISIBLE_COLUMNS]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [...DEFAULT_VISIBLE_COLUMNS]
    const allowed = new Set(PROFILE_COLUMNS.map((c) => c.id))
    const next = parsed.filter((id): id is ProfileColumnId => typeof id === 'string' && allowed.has(id as ProfileColumnId))
    // Cột mới: chèn Ghi chú ngay sau Hồ sơ nếu preference cũ chưa có
    if (!next.includes('notes')) {
      const nameIdx = next.indexOf('name')
      next.splice(nameIdx >= 0 ? nameIdx + 1 : 0, 0, 'notes')
    }
    // Luôn giữ cột khóa
    for (const col of PROFILE_COLUMNS) {
      if (col.locked && !next.includes(col.id)) next.push(col.id)
    }
    return next.length ? next : [...DEFAULT_VISIBLE_COLUMNS]
  } catch {
    return [...DEFAULT_VISIBLE_COLUMNS]
  }
}

export function saveVisibleColumns(ids: ProfileColumnId[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // ignore
  }
}

export function isColumnVisible(visible: ProfileColumnId[], id: ProfileColumnId): boolean {
  return visible.includes(id)
}

export function loadColumnWeights(): ColumnWeights {
  const next = { ...DEFAULT_COLUMN_WEIGHTS }
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY)
    if (!raw) return next
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return next
    const record = parsed as Record<string, unknown>
    for (const col of PROFILE_COLUMNS) {
      const value = record[col.id]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) next[col.id] = value
    }
    return next
  } catch {
    return next
  }
}

export function saveColumnWeights(weights: ColumnWeights): void {
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, JSON.stringify(weights))
  } catch {
    // ignore
  }
}
