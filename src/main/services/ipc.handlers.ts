import { ipcMain, app, shell } from 'electron'
import { dirname, resolve } from 'path'
import { copyFileSync, mkdirSync } from 'fs'
import { IPC } from '../../shared/ipc'
import {
  CreateGroupInput,
  CreateProfileInput,
  BulkCreateProfileInput,
  ProfileFilters,
  UpdateGroupInput,
  UpdateProfileInput,
  AppSettings,
  DashboardStats,
  ChromeProfile
} from '../../shared/types'
import { getDb } from '../db/database'
import {
  arrangeProfileWindows,
  bulkLaunch,
  bulkStop,
  computeTileLayout,
  detectChromePath,
  launchProfile,
  maximizeProfileWindows,
  stopProfile
} from './chrome.service'
import { hasGmailCredentials } from '../../shared/gmail'
import { hasProxy } from '../../shared/proxy'
import {
  buildExportPayload,
  formatExportJson,
  parseImportGroupsJson
} from '../../shared/group-import'
import type { GmailLoginOptions, ImagePreview } from '../../shared/types'
import { isAllowedImagePath, isPathInside, safeBasename } from '../utils/path-guard'
import { sanitizeDashboardStats } from '../utils/profile-sanitize'
import { collectProfilesRoots } from '../../shared/profile-roots'
import { getDataRoot } from '../utils/paths'
import { readDiskSpace } from '../utils/disk-space'
import type { DiskSpaceInfo } from '../../shared/disk'
import { createTimestampedBackup, getBackupDir, listBackups, pruneOldBackups } from '../utils/db-backup'
import { checkAppUpdates, downloadAndInstallUpdate } from './app-update'

function applyFilters(profiles: ChromeProfile[], filters?: ProfileFilters): ChromeProfile[] {
  let result = [...profiles]
  const search = filters?.search?.trim().toLowerCase()
  if (search) {
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(search) ||
        p.notes.toLowerCase().includes(search) ||
        p.tags.some((t) => t.toLowerCase().includes(search)) ||
        p.id.toLowerCase().includes(search) ||
        (p.dataDir ?? '').toLowerCase().includes(search) ||
        (p.gmail?.email ?? '').toLowerCase().includes(search)
    )
  }

  if (filters?.groupId !== undefined) {
    if (filters.groupId === null || filters.groupId === 'ungrouped') {
      result = result.filter((p) => !p.groupId)
    } else if (filters.groupId !== 'all') {
      result = result.filter((p) => p.groupId === filters.groupId)
    }
  }

  if (filters?.status && filters.status !== 'all') {
    result = result.filter((p) => p.status === filters.status)
  }

  if (filters?.proxy === 'with') {
    result = result.filter((p) => hasProxy(p.proxy))
  } else if (filters?.proxy === 'without') {
    result = result.filter((p) => !hasProxy(p.proxy))
  }

  const sortBy = filters?.sortBy ?? 'name'
  const sortDir = filters?.sortDir ?? 'asc'
  result.sort((a, b) => {
    const av = a[sortBy] ?? ''
    const bv = b[sortBy] ?? ''
    const cmp = String(av).localeCompare(String(bv), 'vi', { sensitivity: 'base' })
    return sortDir === 'asc' ? cmp : -cmp
  })

  return result
}

export function registerIpcHandlers(): void {
  const db = getDb()

  ipcMain.handle(IPC.PROFILES_LIST, (_e, filters?: ProfileFilters) => {
    return applyFilters(db.listProfiles(), filters)
  })

  ipcMain.handle(IPC.PROFILES_GET, (_e, id: string) => db.getProfile(id) ?? null)

  ipcMain.handle(IPC.PROFILES_CREATE, (_e, input: CreateProfileInput) => db.createProfile(input))

  ipcMain.handle(IPC.PROFILES_BULK_CREATE, (_e, input: BulkCreateProfileInput) =>
    db.createProfiles(input)
  )

  ipcMain.handle(IPC.PROFILES_UPDATE, (_e, id: string, input: UpdateProfileInput) =>
    db.updateProfile(id, input)
  )

  ipcMain.handle(IPC.PROFILES_DELETE, async (_e, id: string) => {
    const stopped = await stopProfile(id)
    if (!stopped.success) {
      throw new Error(stopped.error ?? 'Không thể đóng Chrome trước khi xóa')
    }
    db.deleteProfile(id)
    return true
  })

  ipcMain.handle(IPC.PROFILES_RESET, async (_e, id: string) => {
    const stopped = await stopProfile(id)
    if (!stopped.success) {
      throw new Error(stopped.error ?? 'Không thể đóng Chrome trước khi xóa sạch')
    }
    // Windows: chờ Chrome nhả khóa file trong user-data-dir
    await new Promise((r) => setTimeout(r, 600))
    return db.resetProfile(id)
  })

  ipcMain.handle(IPC.PROFILES_DUPLICATE, (_e, id: string) => db.duplicateProfile(id))

  ipcMain.handle(IPC.PROFILES_BULK_DELETE, async (_e, ids: string[]) => {
    const successIds: string[] = []
    const failed: Array<{ id: string; error: string }> = []
    const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id.length > 0) : []
    for (const id of list) {
      try {
        const stopped = await stopProfile(id)
        if (!stopped.success) {
          failed.push({ id, error: stopped.error ?? 'Không thể đóng Chrome trước khi xóa' })
          continue
        }
        successIds.push(id)
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : 'Không thể xóa'
        })
      }
    }
    if (successIds.length > 0) db.deleteProfiles(successIds)
    return { successIds, failed }
  })

  ipcMain.handle(IPC.PROFILES_BULK_UPDATE, (_e, ids: string[], input: UpdateProfileInput) =>
    db.updateProfiles(ids, input)
  )

  ipcMain.handle(IPC.PROFILES_LAUNCH, async (_e, id: string) => {
    const result = await launchProfile(id, { startMaximized: true })
    return result
  })
  ipcMain.handle(IPC.PROFILES_STOP, (_e, id: string) => stopProfile(id))
  ipcMain.handle(IPC.PROFILES_BULK_LAUNCH, (_e, ids: string[]) => bulkLaunch(ids))
  ipcMain.handle(IPC.PROFILES_BULK_STOP, (_e, ids: string[]) => bulkStop(ids))
  ipcMain.handle(IPC.PROFILES_LOGIN_GMAIL, async (_e, id: string, options?: GmailLoginOptions) => {
    const { loginGmailForProfile } = await import('./gmail-login.service')
    return loginGmailForProfile(id, options)
  })
  ipcMain.handle(IPC.PROFILES_LOGIN_GMAIL_BULK, async (_e, ids: string[]) => {
    const { bulkLoginGmail } = await import('./gmail-login.service')
    return bulkLoginGmail(ids)
  })
  ipcMain.handle(IPC.PROFILES_TILE_LAYOUT, (_e, count: number) => computeTileLayout(count))
  ipcMain.handle(IPC.PROFILES_ARRANGE_WINDOWS, async (_e, ids: string[]) => {
    await arrangeProfileWindows(ids)
    return true
  })
  ipcMain.handle(IPC.PROFILES_MAXIMIZE_WINDOWS, async (_e, ids: string[]) => {
    await maximizeProfileWindows(ids)
    return true
  })

  ipcMain.handle(IPC.GMAIL_LIST_LOAD, async () => {
    const { loadGmailList, getGmailListPath } = await import('./gmail-list.service')
    return { content: loadGmailList(), path: getGmailListPath() }
  })
  ipcMain.handle(IPC.GMAIL_LIST_SAVE, async (_e, content: string) => {
    const { saveGmailList } = await import('./gmail-list.service')
    return saveGmailList(content)
  })
  ipcMain.handle(IPC.GMAIL_FAILED_LOAD, async () => {
    const { loadFailedGmailEmails } = await import('./gmail-list.service')
    return loadFailedGmailEmails()
  })
  ipcMain.handle(IPC.GMAIL_FAILED_SAVE, async (_e, emails: string[]) => {
    const { saveFailedGmailEmails } = await import('./gmail-list.service')
    return saveFailedGmailEmails(emails)
  })
  ipcMain.handle(IPC.GMAIL_SETUP_LOAD, async () => {
    const { loadGmailSetup } = await import('./gmail-list.service')
    return loadGmailSetup()
  })
  ipcMain.handle(IPC.GMAIL_SETUP_SAVE, async (_e, config) => {
    const { saveGmailSetup } = await import('./gmail-list.service')
    return saveGmailSetup(config)
  })
  ipcMain.handle(IPC.GMAIL_DRIVE_PDF_LANES, async () => {
    const { listDrivePdfLanes } = await import('./gmail-post-setup.service')
    return listDrivePdfLanes()
  })
  ipcMain.handle(IPC.DIALOG_OPEN_IMAGE, async () => {
    const { dialog, BrowserWindow } = await import('electron')
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: 'Chọn ảnh đại diện',
          properties: ['openFile'],
          filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }
          ]
        })
      : await dialog.showOpenDialog({
          title: 'Chọn ảnh đại diện',
          properties: ['openFile'],
          filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }
          ]
        })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.DIALOG_OPEN_PDF, async () => {
    const { dialog, BrowserWindow } = await import('electron')
    const win = BrowserWindow.getFocusedWindow()
    const options = {
      title: 'Chọn file PDF',
      properties: ['openFile'] as 'openFile'[],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.FILE_IMAGE_PREVIEW, async (_e, filePath: string): Promise<ImagePreview> => {
    const empty: ImagePreview = { exists: false, dataUrl: '', size: 0, name: '' }
    if (!isAllowedImagePath(filePath)) return empty

    const { readFileSync, statSync } = await import('fs')
    const { extname, resolve } = await import('path')
    const target = resolve(filePath.trim())

    try {
      const stat = statSync(target)
      const name = safeBasename(target)
      // Ảnh quá lớn: vẫn báo hợp lệ nhưng không nhúng base64 vào renderer
      if (stat.size > 8 * 1024 * 1024) {
        return { exists: true, dataUrl: '', size: stat.size, name }
      }
      const mimeByExt: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon'
      }
      const mime = mimeByExt[extname(target).toLowerCase()]
      if (!mime) return empty
      const base64 = readFileSync(target).toString('base64')
      return { exists: true, dataUrl: `data:${mime};base64,${base64}`, size: stat.size, name }
    } catch {
      return empty
    }
  })

  ipcMain.handle(IPC.DIALOG_OPEN_SCRIPT_TEXT, async () => {
    const { dialog, BrowserWindow } = await import('electron')
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      title: 'Chọn file code Apps Script (.txt)',
      properties: ['openFile'] as ('openFile')[],
      filters: [
        { name: 'Text / Script', extensions: ['txt', 'gs', 'js'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.GROUPS_LIST, () => db.listGroups())
  ipcMain.handle(IPC.GROUPS_CREATE, (_e, input: CreateGroupInput) => db.createGroup(input))
  ipcMain.handle(IPC.GROUPS_UPDATE, (_e, id: string, input: UpdateGroupInput) =>
    db.updateGroup(id, input)
  )
  ipcMain.handle(IPC.GROUPS_DELETE, async (_e, id: string) => {
    const profiles = db.listProfiles().filter((p) => p.groupId === id)
    const blocked: string[] = []
    for (const profile of profiles) {
      const stopped = await stopProfile(profile.id)
      if (!stopped.success) blocked.push(profile.name || profile.id)
    }
    if (blocked.length > 0) {
      throw new Error(
        `Không đóng được Chrome của: ${blocked.slice(0, 3).join(', ')}. Nhóm chưa bị xóa.`
      )
    }
    db.deleteGroup(id)
    return true
  })

  ipcMain.handle(IPC.GROUPS_IMPORT, (_e, raw: string) => {
    const payload = parseImportGroupsJson(typeof raw === 'string' ? raw : '')
    return db.importGroups(payload)
  })

  ipcMain.handle(IPC.GROUPS_EXPORT, (_e, groupIds?: string[] | null) => {
    let groups = db.listGroups()
    if (Array.isArray(groupIds) && groupIds.length > 0) {
      const want = new Set(groupIds)
      groups = groups.filter((g) => want.has(g.id))
    }
    const profiles = db.listProfiles()
    return formatExportJson(buildExportPayload(groups, profiles))
  })

  ipcMain.handle(IPC.DIALOG_OPEN_JSON, async () => {
    const { dialog, BrowserWindow } = await import('electron')
    const { readFileSync } = await import('fs')
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      title: 'Chọn file JSON nhóm / hồ sơ',
      properties: ['openFile'] as ('openFile')[],
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths[0]) return null
    try {
      return readFileSync(result.filePaths[0], 'utf8')
    } catch (error) {
      throw new Error(
        error instanceof Error ? `Không đọc được file: ${error.message}` : 'Không đọc được file'
      )
    }
  })

  ipcMain.handle(IPC.DIALOG_SAVE_JSON, async (_e, content: string, defaultName?: string) => {
    const { dialog, BrowserWindow } = await import('electron')
    const { writeFileSync } = await import('fs')
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      title: 'Lưu file JSON',
      defaultPath: defaultName?.trim() || 'chrome-manager-groups.json',
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, typeof content === 'string' ? content : '', 'utf8')
    return result.filePath
  })

  ipcMain.handle(IPC.DIALOG_OPEN_DATA_DIR, async () => {
    const { dialog, BrowserWindow } = await import('electron')
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      title: 'Chọn thư mục hồ sơ Chrome (UUID, chrome-profiles, hoặc data)',
      properties: ['openDirectory'] as ('openDirectory')[]
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.DATA_IMPORT_PREVIEW, (_e, selectedPath: string) =>
    db.previewDataImport(typeof selectedPath === 'string' ? selectedPath : '')
  )

  ipcMain.handle(IPC.DATA_IMPORT, (_e, selectedPath: string, options?: { groupId?: string | null }) =>
    db.importFromDataPath(typeof selectedPath === 'string' ? selectedPath : '', options ?? {})
  )

function isLocalToday(iso: string | null | undefined): boolean {
  if (!iso) return false
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return false
  const now = new Date()
  return (
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  )
}

ipcMain.handle(IPC.DASHBOARD_STATS, (): DashboardStats => {
    db.rememberUsageFromLastLaunch()
    const profiles = db.listProfiles()
    const groups = db.listGroups()
    const groupMap = new Map(groups.map((g) => [g.id, g.name]))

    const groupBreakdownMap = new Map<string | null, { count: number; withGmail: number }>()
    let withGmail = 0
    let withProxy = 0
    let runningProfiles = 0
    let ranToday = 0
    let idleProfiles = 0
    let errorProfiles = 0
    let startingOrStopping = 0

    for (const p of profiles) {
      const hasMail = hasGmailCredentials(p.gmail)
      if (hasMail) withGmail += 1
      if (hasProxy(p.proxy)) withProxy += 1

      if (p.status === 'running') runningProfiles += 1
      else if (p.status === 'idle') idleProfiles += 1
      else if (p.status === 'error') errorProfiles += 1
      else if (p.status === 'starting' || p.status === 'stopping') startingOrStopping += 1

      const openNow = p.status === 'running' || p.status === 'starting' || p.status === 'stopping'
      if (openNow || isLocalToday(p.lastLaunchedAt)) ranToday += 1

      const bucket = groupBreakdownMap.get(p.groupId) ?? { count: 0, withGmail: 0 }
      bucket.count += 1
      if (hasMail) bucket.withGmail += 1
      groupBreakdownMap.set(p.groupId, bucket)
    }

    return sanitizeDashboardStats({
      totalProfiles: profiles.length,
      runningProfiles,
      ranToday,
      ranYesterday: db.countProfilesUsedOn(1),
      idleProfiles,
      totalGroups: groups.length,
      withGmail,
      withoutGmail: profiles.length - withGmail,
      withProxy,
      errorProfiles,
      startingOrStopping,
      recentlyLaunched: [...profiles]
        .filter((p) => p.lastLaunchedAt)
        .sort((a, b) => String(b.lastLaunchedAt).localeCompare(String(a.lastLaunchedAt)))
        .slice(0, 8),
      groupBreakdown: [...groupBreakdownMap.entries()]
        .map(([groupId, { count, withGmail: gmailCount }]) => ({
          groupId,
          groupName: groupId ? (groupMap.get(groupId) ?? 'Không rõ') : 'Chưa nhóm',
          count,
          withGmail: gmailCount
        }))
        .sort((a, b) => b.count - a.count)
    })
  })

  ipcMain.handle(IPC.SETTINGS_GET, () => db.getSettings())
  ipcMain.handle(IPC.SETTINGS_UPDATE, (_e, patch: Partial<AppSettings>) => db.updateSettings(patch))
  ipcMain.handle(IPC.SETTINGS_DETECT_CHROME, () => {
    const path = detectChromePath()
    if (path) db.updateSettings({ chromePath: path })
    return path
  })
  ipcMain.handle(IPC.SETTINGS_PICK_PROFILES_DIR, async () => {
    const { dialog, BrowserWindow } = await import('electron')
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      title: 'Chọn thư mục lưu hồ sơ Chrome',
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.SETTINGS_DISK_SPACE, (_e, paths?: string[]): DiskSpaceInfo[] => {
    const settings = db.getSettings()
    const list =
      Array.isArray(paths) && paths.length > 0
        ? paths
        : collectProfilesRoots(settings)
    return list.filter((p): p is string => typeof p === 'string' && Boolean(p.trim())).map((p) =>
      readDiskSpace(p)
    )
  })

  ipcMain.handle(IPC.SETTINGS_OPEN_PATH, async (_e, targetPath: string) => {
    const raw = typeof targetPath === 'string' ? targetPath.trim() : ''
    if (!raw) return { ok: false as const, error: 'Thiếu đường dẫn' }
    const target = resolve(raw)
    const settings = db.getSettings()
    const allowed = [
      ...collectProfilesRoots(settings),
      getDataRoot(),
      getBackupDir(),
      settings.chromePath ? dirname(settings.chromePath) : '',
      ...db.listProfiles().map((p) => p.dataDir)
    ].filter(Boolean)
    const allowedOpen = allowed.some((root) => {
      const resolvedRoot = resolve(root)
      return target === resolvedRoot || isPathInside(target, resolvedRoot)
    })
    if (!allowedOpen) return { ok: false as const, error: 'Không được mở đường dẫn này' }
    const err = await shell.openPath(target)
    if (err) return { ok: false as const, error: err }
    return { ok: true as const }
  })

  ipcMain.handle(IPC.APP_INFO, () => {
    const backupDir = getBackupDir()
    mkdirSync(backupDir, { recursive: true })
    return {
      name: app.getName(),
      version: app.getVersion(),
      packaged: app.isPackaged,
      backupDir
    }
  })

  ipcMain.handle(IPC.APP_CHECK_UPDATES, (_e, feedUrl?: string) => checkAppUpdates(feedUrl))
  ipcMain.handle(IPC.APP_INSTALL_UPDATE, (_e, feedUrl?: string) =>
    downloadAndInstallUpdate(feedUrl)
  )

  ipcMain.handle(IPC.DATA_BACKUP_LIST, () => listBackups())

  ipcMain.handle(IPC.DATA_BACKUP_EXPORT, async () => {
    db.flush()
    const source = db.getStoreFilePath()
    const { dialog, BrowserWindow } = await import('electron')
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      title: 'Sao lưu dữ liệu Chrome Manager',
      defaultPath: 'chrome-manager-db-backup.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    copyFileSync(source, result.filePath)
    return result.filePath
  })

  ipcMain.handle(IPC.DATA_BACKUP_RESTORE, async () => {
    const { dialog, BrowserWindow } = await import('electron')
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      title: 'Khôi phục từ file sao lưu',
      properties: ['openFile'] as ('openFile')[],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths[0]) return null
    db.flush()
    createTimestampedBackup(db.getStoreFilePath(), { prune: false })
    const restored = db.replaceFromBackup(result.filePaths[0])
    pruneOldBackups()
    return restored
  })

  ipcMain.handle(IPC.DATA_BACKUP_RESTORE_FILE, (_e, filePath: string) => {
    const raw = typeof filePath === 'string' ? filePath.trim() : ''
    if (!raw) throw new Error('Thiếu đường dẫn sao lưu')
    const target = resolve(raw)
    if (!isPathInside(target, getBackupDir()) && target !== resolve(getBackupDir())) {
      throw new Error('Chỉ khôi phục file trong thư mục sao lưu của app')
    }
    db.flush()
    createTimestampedBackup(db.getStoreFilePath(), { prune: false })
    const restored = db.replaceFromBackup(target)
    pruneOldBackups()
    return restored
  })

  ipcMain.handle(IPC.WEB_LINKS_LOAD, async () => {
    const { loadWebLinks } = await import('./web-link-check.service')
    return loadWebLinks()
  })
  ipcMain.handle(IPC.WEB_LINKS_SAVE, async (_e, content: string) => {
    const { saveWebLinks } = await import('./web-link-check.service')
    return saveWebLinks(typeof content === 'string' ? content : '')
  })
  ipcMain.handle(IPC.WEB_LINKS_CHECK, async (_e, content: string, target?: 'web' | 'form') => {
    const { checkWebLinks } = await import('./web-link-check.service')
    const kind = target === 'form' ? 'form' : 'web'
    return checkWebLinks(typeof content === 'string' ? content : '', kind)
  })
  ipcMain.handle(IPC.WEB_LINKS_CHECK_LIST, async (_e, content: string, target?: 'all' | 'web' | 'form') => {
    const { checkUrlList } = await import('./web-link-check.service')
    const scope = target === 'web' || target === 'form' ? target : 'all'
    return checkUrlList(typeof content === 'string' ? content : '', scope)
  })
  ipcMain.handle(IPC.WEB_LINKS_CANCEL, async () => {
    const { cancelWebLinkCheck } = await import('./web-link-check.service')
    cancelWebLinkCheck()
    return true
  })
  ipcMain.handle(IPC.WEB_LINKS_PICK, async () => {
    const { dialog, BrowserWindow } = await import('electron')
    const { readFileSync } = await import('fs')
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      title: 'Chọn file danh sách Link_web',
      properties: ['openFile'] as ('openFile')[],
      filters: [
        { name: 'Text', extensions: ['txt', 'csv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths[0]) return null
    try {
      return readFileSync(result.filePaths[0], 'utf8')
    } catch (error) {
      throw new Error(
        error instanceof Error ? `Không đọc được file: ${error.message}` : 'Không đọc được file'
      )
    }
  })
  ipcMain.handle(IPC.WEB_LINKS_EXPORT, async (_e, content: string) => {
    const { dialog, BrowserWindow } = await import('electron')
    const { writeFileSync } = await import('fs')
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      title: 'Xuất danh sách Link_web',
      defaultPath: 'web-links.txt',
      filters: [
        { name: 'Text', extensions: ['txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, typeof content === 'string' ? content : '', 'utf8')
    return result.filePath
  })
}
