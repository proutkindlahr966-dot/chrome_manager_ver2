import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateCheckResult } from '../../shared/app-ops'
import { getDb } from '../db/database'

let configured = false

function ensureUpdater(): void {
  if (configured) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  configured = true
}

function resolveFeedUrl(feedOverride?: string): string {
  const fromArg = (feedOverride ?? '').trim()
  const fromSettings = (getDb().getSettings().updateFeedUrl ?? '').trim()
  return (fromArg || fromSettings).replace(/\/+$/, '')
}

export async function checkAppUpdates(feedOverride?: string): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  if (!app.isPackaged) return { status: 'dev', current }

  const feed = resolveFeedUrl(feedOverride)
  if (!feed) return { status: 'unconfigured', current }

  ensureUpdater()
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: `${feed}/` })
    const result = await autoUpdater.checkForUpdates()
    const next = result?.updateInfo?.version
    if (!next || next === current) return { status: 'latest', current }
    return { status: 'available', current, version: next }
  } catch (error) {
    return {
      status: 'error',
      current,
      error: error instanceof Error ? error.message : 'Không kiểm tra được cập nhật'
    }
  }
}

export async function downloadAndInstallUpdate(
  feedOverride?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!app.isPackaged) return { ok: false, error: 'Bản dev không cài cập nhật' }
  const feed = resolveFeedUrl(feedOverride)
  if (!feed) return { ok: false, error: 'Chưa có URL nguồn cập nhật' }
  ensureUpdater()
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: `${feed}/` })
    await autoUpdater.checkForUpdates()
    await autoUpdater.downloadUpdate()
    autoUpdater.quitAndInstall(false, true)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Không tải được bản cập nhật'
    }
  }
}
