export interface DbBackupInfo {
  path: string
  name: string
  mtime: string
  size: number
}

export type UpdateCheckResult =
  | { status: 'dev'; current: string }
  | { status: 'unconfigured'; current: string }
  | { status: 'latest'; current: string }
  | { status: 'available'; current: string; version: string }
  | { status: 'error'; current: string; error: string }
