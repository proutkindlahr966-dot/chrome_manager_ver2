import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AppSettings,
  BulkResult,
  ChromeProfile,
  CreateGroupInput,
  CreateProfileInput,
  BulkCreateProfileInput,
  DashboardStats,
  GmailLoginResult,
  GmailLoginOptions,
  GmailLoginProgress,
  GmailPostSetupConfig,
  DrivePdfLaneInfo,
  ImagePreview,
  LaunchResult,
  ProfileFilters,
  ProfileGroup,
  ProfileStatusPatch,
  UpdateGroupInput,
  UpdateProfileInput,
  WindowBounds
} from '../shared/types'
import type { ImportGroupsResult } from '../shared/group-import'
import type { DataImportPreview, DataImportResult } from '../shared/data-import'
import type { DiskSpaceInfo } from '../shared/disk'
import type { DbBackupInfo, UpdateCheckResult } from '../shared/app-ops'
import type { WebLinkCheckProgress, WebLinkCheckResult, UrlListCheckResult } from '../shared/web-link'

const api = {
  profiles: {
    list: (filters?: ProfileFilters): Promise<ChromeProfile[]> =>
      ipcRenderer.invoke(IPC.PROFILES_LIST, filters),
    get: (id: string): Promise<ChromeProfile | null> => ipcRenderer.invoke(IPC.PROFILES_GET, id),
    create: (input: CreateProfileInput): Promise<ChromeProfile> =>
      ipcRenderer.invoke(IPC.PROFILES_CREATE, input),
    bulkCreate: (input: BulkCreateProfileInput): Promise<ChromeProfile[]> =>
      ipcRenderer.invoke(IPC.PROFILES_BULK_CREATE, input),
    update: (id: string, input: UpdateProfileInput): Promise<ChromeProfile> =>
      ipcRenderer.invoke(IPC.PROFILES_UPDATE, id, input),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.PROFILES_DELETE, id),
    reset: (id: string): Promise<ChromeProfile> => ipcRenderer.invoke(IPC.PROFILES_RESET, id),
    duplicate: (id: string): Promise<ChromeProfile> =>
      ipcRenderer.invoke(IPC.PROFILES_DUPLICATE, id),
    bulkDelete: (ids: string[]): Promise<BulkResult> =>
      ipcRenderer.invoke(IPC.PROFILES_BULK_DELETE, ids),
    bulkUpdate: (ids: string[], input: UpdateProfileInput): Promise<BulkResult> =>
      ipcRenderer.invoke(IPC.PROFILES_BULK_UPDATE, ids, input),
    launch: (id: string): Promise<LaunchResult> => ipcRenderer.invoke(IPC.PROFILES_LAUNCH, id),
    stop: (id: string): Promise<LaunchResult> => ipcRenderer.invoke(IPC.PROFILES_STOP, id),
    bulkLaunch: (ids: string[]): Promise<BulkResult> =>
      ipcRenderer.invoke(IPC.PROFILES_BULK_LAUNCH, ids),
    bulkStop: (ids: string[]): Promise<BulkResult> =>
      ipcRenderer.invoke(IPC.PROFILES_BULK_STOP, ids),
    loginGmail: (id: string, options?: GmailLoginOptions): Promise<GmailLoginResult> =>
      ipcRenderer.invoke(IPC.PROFILES_LOGIN_GMAIL, id, options),
    loginGmailBulk: (ids: string[]): Promise<BulkResult> =>
      ipcRenderer.invoke(IPC.PROFILES_LOGIN_GMAIL_BULK, ids),
    tileLayout: (count: number): Promise<WindowBounds[]> =>
      ipcRenderer.invoke(IPC.PROFILES_TILE_LAYOUT, count),
    arrangeWindows: (ids: string[]): Promise<boolean> =>
      ipcRenderer.invoke(IPC.PROFILES_ARRANGE_WINDOWS, ids),
    maximizeWindows: (ids: string[]): Promise<boolean> =>
      ipcRenderer.invoke(IPC.PROFILES_MAXIMIZE_WINDOWS, ids),
    loadGmailList: (): Promise<{ content: string; path: string }> =>
      ipcRenderer.invoke(IPC.GMAIL_LIST_LOAD),
    saveGmailList: (content: string): Promise<{ path: string; count: number }> =>
      ipcRenderer.invoke(IPC.GMAIL_LIST_SAVE, content),
    loadFailedGmailEmails: (): Promise<string[]> => ipcRenderer.invoke(IPC.GMAIL_FAILED_LOAD),
    saveFailedGmailEmails: (emails: string[]): Promise<{ path: string; count: number }> =>
      ipcRenderer.invoke(IPC.GMAIL_FAILED_SAVE, emails),
    loadGmailSetup: (): Promise<GmailPostSetupConfig> => ipcRenderer.invoke(IPC.GMAIL_SETUP_LOAD),
    saveGmailSetup: (
      config: GmailPostSetupConfig
    ): Promise<{ path: string; config: GmailPostSetupConfig }> =>
      ipcRenderer.invoke(IPC.GMAIL_SETUP_SAVE, config),
    listDrivePdfLanes: (): Promise<DrivePdfLaneInfo[]> =>
      ipcRenderer.invoke(IPC.GMAIL_DRIVE_PDF_LANES),
    pickImageFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.DIALOG_OPEN_IMAGE),
    pickPdfFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.DIALOG_OPEN_PDF),
    readImagePreview: (path: string): Promise<ImagePreview> =>
      ipcRenderer.invoke(IPC.FILE_IMAGE_PREVIEW, path),
    pickScriptTextFile: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.DIALOG_OPEN_SCRIPT_TEXT),
    onStatusChanged: (cb: (patch: ProfileStatusPatch) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, patch: ProfileStatusPatch): void =>
        cb(patch)
      ipcRenderer.on(IPC.PROFILE_STATUS_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC.PROFILE_STATUS_CHANGED, listener)
    },
    onLoginProgress: (cb: (progress: GmailLoginProgress) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: GmailLoginProgress): void =>
        cb(progress)
      ipcRenderer.on(IPC.GMAIL_LOGIN_PROGRESS, listener)
      return () => ipcRenderer.removeListener(IPC.GMAIL_LOGIN_PROGRESS, listener)
    }
  },
  groups: {
    list: (): Promise<ProfileGroup[]> => ipcRenderer.invoke(IPC.GROUPS_LIST),
    create: (input: CreateGroupInput): Promise<ProfileGroup> =>
      ipcRenderer.invoke(IPC.GROUPS_CREATE, input),
    update: (id: string, input: UpdateGroupInput): Promise<ProfileGroup> =>
      ipcRenderer.invoke(IPC.GROUPS_UPDATE, id, input),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.GROUPS_DELETE, id),
    importJson: (raw: string): Promise<ImportGroupsResult> =>
      ipcRenderer.invoke(IPC.GROUPS_IMPORT, raw),
    exportJson: (groupIds?: string[] | null): Promise<string> =>
      ipcRenderer.invoke(IPC.GROUPS_EXPORT, groupIds),
    pickImportFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.DIALOG_OPEN_JSON),
    saveExportFile: (content: string, defaultName?: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.DIALOG_SAVE_JSON, content, defaultName),
    pickDataPath: (): Promise<string | null> => ipcRenderer.invoke(IPC.DIALOG_OPEN_DATA_DIR),
    previewDataImport: (selectedPath: string): Promise<DataImportPreview> =>
      ipcRenderer.invoke(IPC.DATA_IMPORT_PREVIEW, selectedPath),
    importDataPath: (
      selectedPath: string,
      options?: { groupId?: string | null }
    ): Promise<DataImportResult> => ipcRenderer.invoke(IPC.DATA_IMPORT, selectedPath, options)
  },
  dashboard: {
    stats: (): Promise<DashboardStats> => ipcRenderer.invoke(IPC.DASHBOARD_STATS)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC.SETTINGS_UPDATE, patch),
    detectChrome: (): Promise<string> => ipcRenderer.invoke(IPC.SETTINGS_DETECT_CHROME),
    pickProfilesDir: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.SETTINGS_PICK_PROFILES_DIR),
    diskSpace: (paths?: string[]): Promise<DiskSpaceInfo[]> =>
      ipcRenderer.invoke(IPC.SETTINGS_DISK_SPACE, paths),
    openPath: (targetPath: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.SETTINGS_OPEN_PATH, targetPath)
  },
  app: {
    info: (): Promise<{ name: string; version: string; packaged: boolean; backupDir: string }> =>
      ipcRenderer.invoke(IPC.APP_INFO),
    checkUpdates: (feedUrl?: string): Promise<UpdateCheckResult> =>
      ipcRenderer.invoke(IPC.APP_CHECK_UPDATES, feedUrl),
    installUpdate: (feedUrl?: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.APP_INSTALL_UPDATE, feedUrl)
  },
  backup: {
    list: (): Promise<DbBackupInfo[]> => ipcRenderer.invoke(IPC.DATA_BACKUP_LIST),
    exportFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.DATA_BACKUP_EXPORT),
    restoreFile: (): Promise<{ profiles: number; groups: number } | null> =>
      ipcRenderer.invoke(IPC.DATA_BACKUP_RESTORE),
    restoreNamed: (filePath: string): Promise<{ profiles: number; groups: number }> =>
      ipcRenderer.invoke(IPC.DATA_BACKUP_RESTORE_FILE, filePath)
  },
  webLinks: {
    load: (): Promise<{ content: string; path: string }> => ipcRenderer.invoke(IPC.WEB_LINKS_LOAD),
    save: (content: string): Promise<{ path: string; count: number }> =>
      ipcRenderer.invoke(IPC.WEB_LINKS_SAVE, content),
    check: (content: string, target?: 'web' | 'form'): Promise<WebLinkCheckResult> =>
      ipcRenderer.invoke(IPC.WEB_LINKS_CHECK, content, target),
    checkList: (content: string, target?: 'all' | 'web' | 'form'): Promise<UrlListCheckResult> =>
      ipcRenderer.invoke(IPC.WEB_LINKS_CHECK_LIST, content, target),
    cancel: (): Promise<boolean> => ipcRenderer.invoke(IPC.WEB_LINKS_CANCEL),
    pickFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.WEB_LINKS_PICK),
    exportFile: (content: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.WEB_LINKS_EXPORT, content),
    onProgress: (cb: (progress: WebLinkCheckProgress) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: WebLinkCheckProgress): void =>
        cb(progress)
      ipcRenderer.on(IPC.WEB_LINKS_PROGRESS, listener)
      return () => ipcRenderer.removeListener(IPC.WEB_LINKS_PROGRESS, listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    // Chỉ expose typed API — không expose ipcRenderer generic / process.env
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  Object.assign(window, { api })
}

export type AppApi = typeof api
