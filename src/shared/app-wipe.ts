import { basename, isAbsolute, relative, resolve, sep } from 'path'

export interface AppWipeSkip {
  path: string
  reason: string
}

export interface AppWipePlan {
  folders: string[]
  files: string[]
  skipped: AppWipeSkip[]
}

const SHORTCUT_FILE = 'chrome manager.lnk'

const APP_DIR_NAMES = new Set([
  'chrome manager',
  'chrome-manager',
  'chrome_manager',
  'chrome-profiles',
  'chrome_manager_new',
  'debug-screenshots'
])

const BROAD_NAMES = new Set([
  'users',
  'windows',
  'program files',
  'program files (x86)',
  'appdata',
  'roaming',
  'local',
  'locallow',
  'programs',
  'microsoft',
  'windowsapps',
  'temp',
  'tmp',
  'desktop',
  'documents',
  'downloads',
  'pictures',
  'videos',
  'music',
  'onedrive',
  'public',
  'default',
  'system32',
  'syswow64',
  'programdata',
  'recovery',
  'perflogs',
  'node_modules',
  'src',
  'scripts',
  '.git'
])

const PROJECT_DATA_ROOTS = ['data', 'chrome-profiles', 'debug-screenshots']

export function normalizeWipePath(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  try {
    return resolve(raw).replace(/[\\/]+$/, '')
  } catch {
    return ''
  }
}

function lower(value: string): string {
  return value.toLowerCase()
}

function isInside(child: string, parent: string): boolean {
  const c = lower(child)
  const p = lower(parent)
  if (!c || !p || c === p) return false
  const prefix = p.endsWith('\\') || p.endsWith('/') ? p : p + sep
  return c.startsWith(lower(prefix))
}

function partsOf(target: string): string[] {
  return target.split(/[\\/]/).filter(Boolean)
}

function isDriveRoot(target: string): boolean {
  return /^[a-z]:$/i.test(target)
}

function isProjectDataPath(target: string, projectRoot: string): boolean {
  const rel = relative(projectRoot, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false
  const normalized = rel.replace(/[\\/]/g, '\\').toLowerCase()
  return PROJECT_DATA_ROOTS.some(
    (name) => normalized === name || normalized.startsWith(`${name}\\`)
  )
}

/** Lý do từ chối xoá. `null` nghĩa là thư mục được phép xoá. */
export function wipeFolderRejectReason(targetPath: string, projectRoot: string): string | null {
  const target = normalizeWipePath(targetPath)
  const project = normalizeWipePath(projectRoot)
  if (!target) return 'đường dẫn không hợp lệ'
  if (isDriveRoot(target)) return 'không xoá gốc ổ đĩa'
  if (project) {
    if (lower(target) === lower(project)) return 'giữ mã nguồn dự án'
    if (isInside(project, target)) return 'không xoá thư mục cha của mã nguồn'
    if (isInside(target, project)) {
      return isProjectDataPath(target, project) ? null : 'nằm ngoài phần dữ liệu của dự án'
    }
  }

  const parts = partsOf(target)
  const leaf = lower(parts[parts.length - 1] ?? '')
  const windows = /^[a-z]:\\windows(\\|$)/i.test(target + '\\')
  if (windows || lower(target) === 'c:\\windows') return 'thư mục hệ thống'

  if (/^[a-z]:\\program files( \(x86\))?$/i.test(target)) return 'thư mục hệ thống'
  if (/^[a-z]:\\program files( \(x86\))?\\/i.test(target) && !APP_DIR_NAMES.has(leaf)) {
    return 'thư mục hệ thống'
  }

  if (parts.length === 2 && lower(parts[1] ?? '') === 'users') return 'thư mục người dùng quá rộng'
  if (parts.length === 3 && lower(parts[1] ?? '') === 'users') return 'thư mục người dùng quá rộng'
  if (
    parts.length === 4 &&
    lower(parts[1] ?? '') === 'users' &&
    BROAD_NAMES.has(lower(parts[3] ?? ''))
  ) {
    return 'thư mục người dùng quá rộng'
  }

  if (BROAD_NAMES.has(leaf)) return 'tên thư mục quá chung'
  if (parts.length < 3 && !APP_DIR_NAMES.has(leaf)) return 'thư mục quá gần gốc ổ đĩa'
  return null
}

function shortcutRejectReason(filePath: string): string | null {
  const target = normalizeWipePath(filePath)
  if (!target) return 'đường dẫn không hợp lệ'
  if (lower(basename(target)) !== SHORTCUT_FILE) return 'chỉ xoá shortcut Chrome Manager'
  return null
}

function displayPath(target: string): string {
  return isDriveRoot(target) ? `${target}\\` : target
}

function rememberSkip(skipped: AppWipeSkip[], path: string, reason: string): void {
  const shown = displayPath(path)
  const key = lower(shown)
  if (skipped.some((item) => lower(item.path) === key)) return
  skipped.push({ path: shown, reason })
}

/**
 * Gộp các thư mục được phép xoá thành danh sách cha (không xoá mã nguồn, ổ đĩa, thư mục hệ thống).
 * File chỉ nhận shortcut `Chrome Manager.lnk`.
 */
export function planAppWipe(
  projectRoot: string,
  folders: Array<string | null | undefined>,
  files: Array<string | null | undefined> = []
): AppWipePlan {
  const project = normalizeWipePath(projectRoot)
  const accepted: string[] = []
  const skipped: AppWipeSkip[] = []

  for (const raw of folders) {
    const target = normalizeWipePath(raw)
    if (!target) continue
    if (accepted.some((parent) => lower(parent) === lower(target) || isInside(target, parent))) {
      continue
    }
    const reason = wipeFolderRejectReason(target, project)
    if (reason) {
      rememberSkip(skipped, target, reason)
      continue
    }
    for (let i = accepted.length - 1; i >= 0; i--) {
      if (isInside(accepted[i], target)) accepted.splice(i, 1)
    }
    accepted.push(target)
  }

  const acceptedFiles: string[] = []
  for (const raw of files) {
    const target = normalizeWipePath(raw)
    if (!target) continue
    const reason = shortcutRejectReason(target)
    if (reason) {
      rememberSkip(skipped, target, reason)
      continue
    }
    if (acceptedFiles.some((file) => lower(file) === lower(target))) continue
    acceptedFiles.push(target)
  }

  return {
    folders: accepted,
    files: acceptedFiles,
    skipped
  }
}
