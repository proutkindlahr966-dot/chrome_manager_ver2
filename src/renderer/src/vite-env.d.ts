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
} from '@shared/types'
import type { ImportGroupsResult } from '@shared/group-import'
import type { DataImportPreview, DataImportResult } from '@shared/data-import'
import type { DiskSpaceInfo } from '@shared/disk'
import type { DbBackupInfo, UpdateCheckResult } from '@shared/app-ops'
import type { WebLinkCheckProgress, WebLinkCheckResult, UrlListCheckResult } from '@shared/web-link'

export interface AppApi {
  profiles: {
    list: (filters?: ProfileFilters) => Promise<ChromeProfile[]>
    get: (id: string) => Promise<ChromeProfile | null>
    create: (input: CreateProfileInput) => Promise<ChromeProfile>
    bulkCreate: (input: BulkCreateProfileInput) => Promise<ChromeProfile[]>
    update: (id: string, input: UpdateProfileInput) => Promise<ChromeProfile>
    remove: (id: string) => Promise<boolean>
    reset: (id: string) => Promise<ChromeProfile>
    duplicate: (id: string) => Promise<ChromeProfile>
    bulkDelete: (ids: string[]) => Promise<BulkResult>
    bulkUpdate: (ids: string[], input: UpdateProfileInput) => Promise<BulkResult>
    launch: (id: string) => Promise<LaunchResult>
    stop: (id: string) => Promise<LaunchResult>
    bulkLaunch: (ids: string[]) => Promise<BulkResult>
    bulkStop: (ids: string[]) => Promise<BulkResult>
    loginGmail: (id: string, options?: GmailLoginOptions) => Promise<GmailLoginResult>
    loginGmailBulk: (ids: string[]) => Promise<BulkResult>
    tileLayout: (count: number) => Promise<WindowBounds[]>
    arrangeWindows: (ids: string[]) => Promise<boolean>
    maximizeWindows: (ids: string[]) => Promise<boolean>
    loadGmailList: () => Promise<{ content: string; path: string }>
    saveGmailList: (content: string) => Promise<{ path: string; count: number }>
    loadFailedGmailEmails: () => Promise<string[]>
    saveFailedGmailEmails: (emails: string[]) => Promise<{ path: string; count: number }>
    loadGmailSetup: () => Promise<GmailPostSetupConfig>
    saveGmailSetup: (
      config: GmailPostSetupConfig
    ) => Promise<{ path: string; config: GmailPostSetupConfig }>
    listDrivePdfLanes: () => Promise<DrivePdfLaneInfo[]>
    pickImageFile: () => Promise<string | null>
    pickPdfFile: () => Promise<string | null>
    readImagePreview: (path: string) => Promise<ImagePreview>
    pickScriptTextFile: () => Promise<string | null>
    onStatusChanged: (cb: (patch: ProfileStatusPatch) => void) => () => void
    onLoginProgress: (cb: (progress: GmailLoginProgress) => void) => () => void
  }
  groups: {
    list: () => Promise<ProfileGroup[]>
    create: (input: CreateGroupInput) => Promise<ProfileGroup>
    update: (id: string, input: UpdateGroupInput) => Promise<ProfileGroup>
    remove: (id: string) => Promise<boolean>
    importJson: (raw: string) => Promise<ImportGroupsResult>
    exportJson: (groupIds?: string[] | null) => Promise<string>
    pickImportFile: () => Promise<string | null>
    saveExportFile: (content: string, defaultName?: string) => Promise<string | null>
    pickDataPath: () => Promise<string | null>
    previewDataImport: (selectedPath: string) => Promise<DataImportPreview>
    importDataPath: (
      selectedPath: string,
      options?: { groupId?: string | null }
    ) => Promise<DataImportResult>
  }
  dashboard: {
    stats: () => Promise<DashboardStats>
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (patch: Partial<AppSettings>) => Promise<AppSettings>
    detectChrome: () => Promise<string>
    pickProfilesDir: () => Promise<string | null>
    diskSpace: (paths?: string[]) => Promise<DiskSpaceInfo[]>
    openPath: (targetPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
  }
  app: {
    info: () => Promise<{ name: string; version: string; packaged: boolean; backupDir: string }>
    checkUpdates: (feedUrl?: string) => Promise<UpdateCheckResult>
    installUpdate: (feedUrl?: string) => Promise<{ ok: true } | { ok: false; error: string }>
  }
  backup: {
    list: () => Promise<DbBackupInfo[]>
    exportFile: () => Promise<string | null>
    restoreFile: () => Promise<{ profiles: number; groups: number } | null>
    restoreNamed: (filePath: string) => Promise<{ profiles: number; groups: number }>
  }
  webLinks: {
    load: () => Promise<{ content: string; path: string }>
    save: (content: string) => Promise<{ path: string; count: number }>
    check: (content: string, target?: 'web' | 'form') => Promise<WebLinkCheckResult>
    checkList: (content: string, target?: 'all' | 'web' | 'form') => Promise<UrlListCheckResult>
    cancel: () => Promise<boolean>
    pickFile: () => Promise<string | null>
    exportFile: (content: string) => Promise<string | null>
    onProgress: (cb: (progress: WebLinkCheckProgress) => void) => () => void
  }
}

declare global {
  interface Window {
    api: AppApi
  }
}

export {}
