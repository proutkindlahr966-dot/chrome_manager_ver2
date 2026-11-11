import { app, shell, BrowserWindow, screen, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { isSafeExternalUrl } from '../shared/external-url'
import { registerIpcHandlers } from './services/ipc.handlers'
import { keepRenderListRunning, renderListCanRunHidden } from './services/web-link-keepalive.service'
import { detectChromePath, stopAllRunning } from './services/chrome.service'
import { getDb } from './db/database'
import { runStartupDataCleanup } from './utils/data-retention'
import { getProjectRoot } from './utils/paths'
import { isPathInside } from './utils/path-guard'
import { createTimestampedBackup } from './utils/db-backup'

let isQuitting = false
let allowQuit = false
let tray: Tray | null = null

function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(getProjectRoot(), 'build', 'icon.png')
}

function showMainWindow(): void {
  if (!app.isReady()) return
  const existing = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
  const win = existing ?? createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function ensureTray(): void {
  if (tray && !tray.isDestroyed()) return
  const image = nativeImage.createFromPath(appIconPath())
  tray = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }))
  tray.setToolTip('Chrome Manager — Danh sách Render đang chạy ẩn')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mở Chrome Manager', click: () => showMainWindow() },
      {
        label: 'Thoát hẳn',
        click: () => {
          allowQuit = true
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', () => showMainWindow())
}

function hideMainWindow(): void {
  const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed())
  if (!win) return
  keepRenderListRunning()
  win.hide()
  ensureTray()
  if (getDb().getSettings().closeOnExit) void stopAllRunning()
  tray?.displayBalloon?.({
    title: 'Danh sách Render vẫn đang chạy',
    content: 'Lịch làm mới tiếp tục ở nền. Mở lại từ biểu tượng cạnh đồng hồ.'
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })
}

function isBoundsOnScreen(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    )
  })
}

function isAppNavigation(url: string): boolean {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    try {
      return new URL(url).origin === new URL(process.env['ELECTRON_RENDERER_URL']).origin
    } catch {
      return false
    }
  }
  try {
    return isPathInside(fileURLToPath(url), join(__dirname, '../renderer'))
  } catch {
    return false
  }
}

function persistWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const bounds = win.getNormalBounds()
  getDb().updateWindowState({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: win.isMaximized()
  })
}

function createWindow(): BrowserWindow {
  const saved = getDb().getSettings().windowState
  const restore =
    saved &&
    saved.width >= 800 &&
    saved.height >= 560 &&
    isBoundsOnScreen({
      x: saved.x,
      y: saved.y,
      width: saved.width,
      height: saved.height
    })
      ? saved
      : null

  const mainWindow = new BrowserWindow({
    width: restore?.width ?? 1280,
    height: restore?.height ?? 800,
    ...(restore ? { x: restore.x, y: restore.y } : {}),
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'Chrome Manager',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(getProjectRoot(), 'build', 'icon.png'),
    backgroundColor: '#0B1220',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (restore?.isMaximized) mainWindow.maximize()
    mainWindow.show()
  })

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      persistWindowState(mainWindow)
    }, 400)
  }
  mainWindow.on('resize', scheduleSave)
  mainWindow.on('move', scheduleSave)
  mainWindow.on('close', (event) => {
    if (saveTimer) clearTimeout(saveTimer)
    persistWindowState(mainWindow)
    if (allowQuit || !renderListCanRunHidden()) return
    event.preventDefault()
    hideMainWindow()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppNavigation(url)) event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

if (gotLock) {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.chromemanager.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const db = getDb()
    runStartupDataCleanup()
    try {
      createTimestampedBackup(db.getStoreFilePath())
    } catch (error) {
      console.error('[startup] Không sao lưu được DB', error)
    }
    const settings = db.getSettings()
    if (!settings.chromePath) {
      const detected = detectChromePath()
      if (detected) db.updateSettings({ chromePath: detected })
    }

    // Reset stale running statuses after restart
    db.transaction(() => {
      for (const profile of db.listProfiles()) {
        if (profile.status !== 'idle') {
          db.setProfileStatus(profile.id, 'idle')
        }
      }
    })

    registerIpcHandlers()
    createWindow()

    app.on('activate', () => {
      showMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (allowQuit) return
    if (renderListCanRunHidden()) return
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', async (event) => {
    if (isQuitting) return
    if (!allowQuit && renderListCanRunHidden()) {
      event.preventDefault()
      hideMainWindow()
      return
    }
    const db = getDb()
    db.flush()
    const settings = db.getSettings()
    if (!settings.closeOnExit) return
    event.preventDefault()
    isQuitting = true
    try {
      await stopAllRunning()
    } finally {
      db.flush()
      app.exit(0)
    }
  })
}
