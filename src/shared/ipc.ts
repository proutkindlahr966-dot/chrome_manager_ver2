export const IPC = {
  // Profiles
  PROFILES_LIST: 'profiles:list',
  PROFILES_GET: 'profiles:get',
  PROFILES_CREATE: 'profiles:create',
  PROFILES_BULK_CREATE: 'profiles:bulkCreate',
  PROFILES_UPDATE: 'profiles:update',
  PROFILES_DELETE: 'profiles:delete',
  PROFILES_RESET: 'profiles:reset',
  PROFILES_DUPLICATE: 'profiles:duplicate',
  PROFILES_BULK_DELETE: 'profiles:bulkDelete',
  PROFILES_BULK_UPDATE: 'profiles:bulkUpdate',

  // Launch
  PROFILES_LAUNCH: 'profiles:launch',
  PROFILES_STOP: 'profiles:stop',
  PROFILES_BULK_LAUNCH: 'profiles:bulkLaunch',
  PROFILES_BULK_STOP: 'profiles:bulkStop',
  PROFILES_LOGIN_GMAIL: 'profiles:loginGmail',
  PROFILES_LOGIN_GMAIL_BULK: 'profiles:loginGmailBulk',
  PROFILES_TILE_LAYOUT: 'profiles:tileLayout',
  PROFILES_ARRANGE_WINDOWS: 'profiles:arrangeWindows',
  PROFILES_MAXIMIZE_WINDOWS: 'profiles:maximizeWindows',
  PROFILE_STATUS_CHANGED: 'profiles:statusChanged',
  GMAIL_LOGIN_PROGRESS: 'gmail:loginProgress',

  // Gmail list file
  GMAIL_LIST_LOAD: 'gmailList:load',
  GMAIL_LIST_SAVE: 'gmailList:save',
  GMAIL_FAILED_LOAD: 'gmailList:failedLoad',
  GMAIL_FAILED_SAVE: 'gmailList:failedSave',
  GMAIL_SETUP_LOAD: 'gmailSetup:load',
  GMAIL_SETUP_SAVE: 'gmailSetup:save',
  GMAIL_DRIVE_PDF_LANES: 'gmail:drivePdfLanes',
  DIALOG_OPEN_IMAGE: 'dialog:openImage',
  DIALOG_OPEN_PDF: 'dialog:openPdf',
  DIALOG_OPEN_SCRIPT_TEXT: 'dialog:openScriptText',
  FILE_IMAGE_PREVIEW: 'file:imagePreview',

  // Groups
  GROUPS_LIST: 'groups:list',
  GROUPS_CREATE: 'groups:create',
  GROUPS_UPDATE: 'groups:update',
  GROUPS_DELETE: 'groups:delete',
  GROUPS_IMPORT: 'groups:import',
  GROUPS_EXPORT: 'groups:export',
  DATA_IMPORT_PREVIEW: 'data:importPreview',
  DATA_IMPORT: 'data:import',
  DIALOG_OPEN_JSON: 'dialog:openJson',
  DIALOG_SAVE_JSON: 'dialog:saveJson',
  DIALOG_OPEN_DATA_DIR: 'dialog:openDataDir',

  // Dashboard & settings
  DASHBOARD_STATS: 'dashboard:stats',
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_DETECT_CHROME: 'settings:detectChrome',
  SETTINGS_PICK_PROFILES_DIR: 'settings:pickProfilesDir',
  SETTINGS_DISK_SPACE: 'settings:diskSpace',
  SETTINGS_OPEN_PATH: 'settings:openPath',
  APP_INFO: 'app:info',
  APP_CHECK_UPDATES: 'app:checkUpdates',
  APP_INSTALL_UPDATE: 'app:installUpdate',
  DATA_BACKUP_EXPORT: 'data:backupExport',
  DATA_BACKUP_RESTORE: 'data:backupRestore',
  DATA_BACKUP_LIST: 'data:backupList',
  DATA_BACKUP_RESTORE_FILE: 'data:backupRestoreFile',

  WEB_LINKS_LOAD: 'webLinks:load',
  WEB_LINKS_SAVE: 'webLinks:save',
  WEB_LINKS_CHECK: 'webLinks:check',
  WEB_LINKS_CHECK_LIST: 'webLinks:checkList',
  WEB_LINKS_CANCEL: 'webLinks:cancel',
  WEB_LINKS_PROGRESS: 'webLinks:progress',
  WEB_LINKS_PICK: 'webLinks:pick',
  WEB_LINKS_EXPORT: 'webLinks:export'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
