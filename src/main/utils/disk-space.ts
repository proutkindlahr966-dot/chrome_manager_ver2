import { existsSync, mkdirSync, statfsSync } from 'fs'
import { dirname, resolve } from 'path'
import type { DiskSpaceInfo } from '../../shared/disk'

function probeExistingPath(dir: string): string {
  let current = resolve(dir)
  for (let i = 0; i < 8; i++) {
    if (existsSync(current)) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return resolve(dir)
}

export function readDiskSpace(dir: string): DiskSpaceInfo {
  const path = resolve((dir ?? '').trim() || '.')
  try {
    if (!existsSync(path)) mkdirSync(path, { recursive: true })
  } catch {
    // Thư mục có thể không tạo được; vẫn đo dung lượng ổ cha.
  }
  const probe = probeExistingPath(path)
  try {
    const stats = statfsSync(probe)
    const bsize = Number(stats.bsize) || 0
    const freeBytes = Number(stats.bavail) * bsize
    const totalBytes = Number(stats.blocks) * bsize
    return {
      path,
      exists: existsSync(path),
      freeBytes: Number.isFinite(freeBytes) ? freeBytes : 0,
      totalBytes: Number.isFinite(totalBytes) ? totalBytes : 0
    }
  } catch {
    return { path, exists: existsSync(path), freeBytes: 0, totalBytes: 0 }
  }
}
