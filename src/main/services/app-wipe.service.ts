import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { collectProfilesRoots } from '../../shared/profile-roots'
import {
  normalizeWipePath,
  planAppWipe,
  wipeFolderRejectReason,
  type AppWipePlan
} from '../../shared/app-wipe'
import { getDb } from '../db/database'
import { getDataRoot, getProjectRoot } from '../utils/paths'
import { stopAllRunning } from './chrome.service'
import { cancelWebLinkCheck } from './web-link-check.service'
import { haltWebLinkKeepAlive } from './web-link-keepalive.service'

const SHORTCUT = 'Chrome Manager.lnk'

const WIPE_SCRIPT = String.raw`
param(
  [Parameter(Mandatory = $true)][int]$PidToWait,
  [Parameter(Mandatory = $true)][string]$FoldersFile,
  [Parameter(Mandatory = $true)][string]$FilesFile,
  [Parameter(Mandatory = $true)][string]$ProtectRoot
)
$ErrorActionPreference = 'SilentlyContinue'

function Norm([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return '' }
  try { $full = [System.IO.Path]::GetFullPath($p.Trim()) } catch { return '' }
  return $full.TrimEnd('\')
}

function Test-Protected([string]$path) {
  $n = Norm $path
  $root = Norm $ProtectRoot
  if (-not $n) { return $true }
  if ($n -match '^[A-Za-z]:$') { return $true }
  if ($root -and $n.Equals($root, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  if ($root -and $root.StartsWith($n + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
  if ($root -and $n.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
    $rel = $n.Substring($root.Length).TrimStart('\').ToLowerInvariant()
    $ok = $rel -eq 'data' -or $rel.StartsWith('data\') -or $rel -eq 'chrome-profiles' -or $rel.StartsWith('chrome-profiles\') -or $rel -eq 'debug-screenshots' -or $rel.StartsWith('debug-screenshots\')
    if (-not $ok) { return $true }
  }
  return $false
}

function Read-Lines([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return @() }
  return @(Get-Content -LiteralPath $file -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Test-CommandUses([string]$cmd, [string]$folder) {
  if ([string]::IsNullOrWhiteSpace($cmd) -or [string]::IsNullOrWhiteSpace($folder)) { return $false }
  $needle = $folder.TrimEnd('\')
  $idx = $cmd.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase)
  while ($idx -ge 0) {
    $after = $idx + $needle.Length
    if ($after -ge $cmd.Length) { return $true }
    $ch = $cmd[$after]
    if ($ch -eq '\' -or $ch -eq '"' -or $ch -eq ' ' -or $ch -eq "'") { return $true }
    $idx = $cmd.IndexOf($needle, $after, [StringComparison]::OrdinalIgnoreCase)
  }
  return $false
}

function Remove-Tree([string]$path) {
  if (Test-Protected $path) { return $false }
  for ($i = 0; $i -lt 6; $i++) {
    if (-not (Test-Path -LiteralPath $path)) { return $true }
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path -LiteralPath $path)) { return $true }
    & cmd.exe /c "rmdir /s /q ""$path""" | Out-Null
    if (-not (Test-Path -LiteralPath $path)) { return $true }
    Start-Sleep -Milliseconds 700
  }
  return -not (Test-Path -LiteralPath $path)
}

while (Get-Process -Id $PidToWait -ErrorAction SilentlyContinue) {
  Start-Sleep -Milliseconds 400
}
Start-Sleep -Seconds 1

$folders = @(Read-Lines $FoldersFile | ForEach-Object { Norm $_ } | Where-Object { $_ -and -not (Test-Protected $_) })
$files = @(Read-Lines $FilesFile | ForEach-Object { Norm $_ } | Where-Object { $_ })

$chrome = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'"
foreach ($proc in @($chrome)) {
  $cmd = [string]$proc.CommandLine
  $hit = $false
  foreach ($folder in $folders) {
    if (Test-CommandUses $cmd $folder) { $hit = $true; break }
  }
  if ($hit) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 1

$removed = New-Object System.Collections.Generic.List[string]
foreach ($file in $files) {
  if ((Split-Path -Leaf $file).ToLowerInvariant() -ne 'chrome manager.lnk') { continue }
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
}
foreach ($folder in $folders) {
  if (Remove-Tree $folder) { [void]$removed.Add((Norm $folder)) }
}

$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
foreach ($rootKey in $uninstallRoots) {
  if (-not (Test-Path $rootKey)) { continue }
  foreach ($item in @(Get-ChildItem $rootKey -ErrorAction SilentlyContinue)) {
    $props = Get-ItemProperty -LiteralPath $item.PSPath -ErrorAction SilentlyContinue
    if (-not $props -or $props.DisplayName -ne 'Chrome Manager') { continue }
    $loc = Norm ([string]$props.InstallLocation)
    if (-not $loc) { continue }
    $match = $false
    foreach ($folder in $removed) {
      if ($loc.Equals($folder, [StringComparison]::OrdinalIgnoreCase)) { $match = $true; break }
    }
    if ($match) { Remove-Item -LiteralPath $item.PSPath -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

Remove-Item -LiteralPath $FoldersFile, $FilesFile, $PSCommandPath -Force -ErrorAction SilentlyContinue
$scriptDir = Split-Path -Parent $PSCommandPath
if ($scriptDir -and (Test-Path -LiteralPath $scriptDir)) {
  Remove-Item -LiteralPath $scriptDir -Recurse -Force -ErrorAction SilentlyContinue
}
`

function existingDirs(paths: Array<string | null | undefined>): string[] {
  const out: string[] = []
  for (const raw of paths) {
    const target = normalizeWipePath(raw)
    if (!target || !existsSync(target)) continue
    out.push(target)
  }
  return out
}

function shortcutCandidates(projectRoot: string): string[] {
  const desktop = app.getPath('desktop')
  const programs = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const publicDesktop = process.env.PUBLIC ? join(process.env.PUBLIC, 'Desktop') : ''
  return [
    join(projectRoot, SHORTCUT),
    join(desktop, SHORTCUT),
    publicDesktop ? join(publicDesktop, SHORTCUT) : '',
    join(programs, SHORTCUT),
    join(programs, 'Chrome Manager', SHORTCUT)
  ].filter((target) => target && existsSync(target))
}

function sourceRoot(): string {
  return app.isPackaged ? '' : getProjectRoot()
}

function collectExplicitFolders(): string[] {
  const localAppData = process.env.LOCALAPPDATA ?? ''
  const roaming = app.getPath('appData')
  const devRoot = sourceRoot()
  const installDir = app.isPackaged ? dirname(app.getPath('exe')) : ''
  return existingDirs([
    getDataRoot(),
    app.getPath('userData'),
    app.getPath('sessionData'),
    join(roaming, 'chrome-manager'),
    join(roaming, 'Chrome Manager'),
    localAppData ? join(localAppData, 'chrome-manager') : '',
    localAppData ? join(localAppData, 'Chrome Manager') : '',
    localAppData ? join(localAppData, 'Programs', 'Chrome Manager') : '',
    devRoot ? join(devRoot, 'chrome-profiles') : '',
    devRoot ? join(devRoot, 'debug-screenshots') : '',
    join(programsDir(), 'Chrome Manager'),
    installDir,
    ...collectProfilesRoots(getDb().getSettings())
  ])
}

function programsDir(): string {
  return join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
}

export function previewAppWipe(): AppWipePlan {
  const projectRoot = sourceRoot()
  const explicit = collectExplicitFolders()
  const profileDirs = getDb()
    .listProfiles()
    .map((profile) => profile.dataDir)
    .filter((dir) => {
      const target = normalizeWipePath(dir)
      if (!target || !existsSync(target)) return false
      if (wipeFolderRejectReason(target, projectRoot)) return false
      const parent = dirname(target)
      return !wipeFolderRejectReason(parent, projectRoot)
    })
  return planAppWipe(projectRoot, [...explicit, ...profileDirs], shortcutCandidates(getProjectRoot()))
}

function writeUtf8Bom(filePath: string, text: string): void {
  writeFileSync(filePath, `\uFEFF${text}`, 'utf8')
}

export async function runAppWipe(): Promise<{ ok: true } | { ok: false; error: string }> {
  const plan = previewAppWipe()
  if (plan.folders.length === 0 && plan.files.length === 0) {
    return { ok: false, error: 'Không có thư mục dữ liệu nào để xoá' }
  }

  try {
    await stopAllRunning()
  } catch (error) {
    console.error('[wipe] Không đóng hết hồ sơ Chrome', error)
  }
  try {
    cancelWebLinkCheck()
    haltWebLinkKeepAlive()
  } catch (error) {
    console.error('[wipe] Không dừng được tiến trình nền', error)
  }

  const dir = join(tmpdir(), `chrome-manager-wipe-${process.pid}-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const foldersFile = join(dir, 'folders.txt')
  const filesFile = join(dir, 'files.txt')
  const scriptFile = join(dir, 'wipe.ps1')
  writeUtf8Bom(foldersFile, plan.folders.join('\r\n'))
  writeUtf8Bom(filesFile, plan.files.join('\r\n'))
  writeUtf8Bom(scriptFile, WIPE_SCRIPT.trimStart())
  const runner = join(dir, 'run.bat')
  const protectRoot = sourceRoot()
  writeFileSync(
    runner,
    [
      '@echo off',
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptFile}" -PidToWait ${process.pid} -FoldersFile "${foldersFile}" -FilesFile "${filesFile}" -ProtectRoot "${protectRoot}"`
    ].join('\r\n'),
    'ascii'
  )

  const child = spawn('cmd.exe', ['/d', '/c', `start "" /min "${runner}"`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: true
  })
  child.unref()

  setTimeout(() => {
    app.exit(0)
  }, 400)
  return { ok: true }
}
