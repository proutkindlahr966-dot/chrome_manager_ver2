import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  type Dirent
} from 'fs'
import { dirname, join } from 'path'
import { getDataRoot, getDebugScreenshotsDir } from './paths'

/** File log chính tối đa 2 MB + 1 bản `.1` → tổng không quá ~4 MB. */
const LOG_MAX_BYTES = 2 * 1024 * 1024

/** Ảnh chẩn đoán: giữ tối đa 40 file / 20 MB / 7 ngày. */
const SCREENSHOT_MAX_FILES = 40
const SCREENSHOT_MAX_BYTES = 20 * 1024 * 1024
const SCREENSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Kích thước log đang giữ trong RAM — tránh statSync mỗi dòng (login ghi rất nhiều). */
const logSizes = new Map<string, number>()

function knownSize(filePath: string): number {
  const cached = logSizes.get(filePath)
  if (cached !== undefined) return cached
  try {
    mkdirSync(dirname(filePath), { recursive: true })
  } catch {
    // ignore
  }
  let size = 0
  try {
    if (existsSync(filePath)) size = statSync(filePath).size
  } catch {
    size = 0
  }
  logSizes.set(filePath, size)
  return size
}

function rotateLog(filePath: string): void {
  const archive = `${filePath}.1`
  try {
    rmSync(archive, { force: true })
    renameSync(filePath, archive)
  } catch {
    try {
      rmSync(filePath, { force: true })
    } catch {
      return
    }
  }
  logSizes.set(filePath, 0)
}

/** Ghi thêm 1 dòng log, tự xoay vòng khi vượt hạn mức. */
export function appendRotatingLog(filePath: string, line: string): void {
  const payload = line.endsWith('\n') ? line : `${line}\n`
  const bytes = Buffer.byteLength(payload, 'utf8')
  try {
    const size = knownSize(filePath)
    if (size + bytes > LOG_MAX_BYTES) rotateLog(filePath)
    appendFileSync(filePath, payload, 'utf8')
    logSizes.set(filePath, knownSize(filePath) + bytes)
  } catch {
    // Lỗi ghi log không được làm hỏng luồng chính
  }
}

interface RetentionEntry {
  path: string
  mtimeMs: number
  size: number
}

function listFiles(dir: string): RetentionEntry[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: RetentionEntry[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(dir, entry.name)
    try {
      const stat = statSync(path)
      files.push({ path, mtimeMs: stat.mtimeMs, size: stat.size })
    } catch {
      // ignore
    }
  }
  return files
}

/** Xóa ảnh chẩn đoán cũ — giữ thư mục gọn, không phình vô hạn theo số lần lỗi. */
export function pruneDebugScreenshots(): void {
  const files = listFiles(getDebugScreenshotsDir()).sort((a, b) => b.mtimeMs - a.mtimeMs)
  const now = Date.now()
  let keptFiles = 0
  let keptBytes = 0

  for (const file of files) {
    const expired = now - file.mtimeMs > SCREENSHOT_MAX_AGE_MS
    const overCount = keptFiles >= SCREENSHOT_MAX_FILES
    const overSize = keptBytes + file.size > SCREENSHOT_MAX_BYTES
    if (!expired && !overCount && !overSize) {
      keptFiles += 1
      keptBytes += file.size
      continue
    }
    try {
      rmSync(file.path, { force: true })
    } catch {
      // ignore
    }
  }
}

/**
 * Dọn rác runtime khi mở app: log vượt hạn mức, ảnh chẩn đoán cũ,
 * file `.tmp` còn treo do lần thoát trước bị kill.
 */
export function runStartupDataCleanup(): void {
  pruneDebugScreenshots()

  for (const file of listFiles(getDataRoot())) {
    if (file.path.endsWith('.tmp')) {
      try {
        rmSync(file.path, { force: true })
      } catch {
        // ignore
      }
      continue
    }
    if (file.path.endsWith('.log') && file.size > LOG_MAX_BYTES) {
      logSizes.set(file.path, file.size)
      rotateLog(file.path)
    }
  }
}
