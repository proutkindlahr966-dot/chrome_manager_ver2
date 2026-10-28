/** Cảnh báo khi còn dưới 2 GB trống. */
export const LOW_DISK_BYTES = 2 * 1024 * 1024 * 1024

export interface DiskSpaceInfo {
  path: string
  exists: boolean
  freeBytes: number
  totalBytes: number
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const gb = bytes / 1024 ** 3
  if (gb >= 1) {
    return `${gb.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} GB`
  }
  const mb = bytes / 1024 ** 2
  return `${Math.max(0, Math.round(mb)).toLocaleString('vi-VN')} MB`
}

export function isLowDisk(info: DiskSpaceInfo | null | undefined): boolean {
  if (!info || info.totalBytes <= 0) return false
  return info.freeBytes < LOW_DISK_BYTES
}

export function diskUsageLabel(info: DiskSpaceInfo | null | undefined): string {
  if (!info || info.totalBytes <= 0) return 'Không đọc được dung lượng'
  return `${formatBytes(info.freeBytes)} trống / ${formatBytes(info.totalBytes)}`
}
