import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { basename, join } from 'path'
import { getDataRoot } from './paths'
import type { DbBackupInfo } from '../../shared/app-ops'

const KEEP = 10

export function getBackupDir(): string {
  return join(getDataRoot(), 'backups')
}

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function createTimestampedBackup(
  sourceFile: string,
  options?: { prune?: boolean }
): string | null {
  if (!existsSync(sourceFile)) return null
  const dir = getBackupDir()
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, `chrome-manager-db-${stamp()}.json`)
  copyFileSync(sourceFile, dest)
  if (options?.prune !== false) pruneBackups()
  return dest
}

export function pruneOldBackups(): void {
  pruneBackups()
}

export function listBackups(): DbBackupInfo[] {
  const dir = getBackupDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.startsWith('chrome-manager-db-') && name.endsWith('.json'))
    .map((name) => {
      const path = join(dir, name)
      const st = statSync(path)
      return {
        path,
        name,
        mtime: st.mtime.toISOString(),
        size: st.size
      }
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
}

function pruneBackups(): void {
  const extras = listBackups().slice(KEEP)
  for (const item of extras) {
    try {
      rmSync(item.path, { force: true })
    } catch {
      // ignore
    }
  }
}

export function backupFileName(info: DbBackupInfo): string {
  return basename(info.path)
}
