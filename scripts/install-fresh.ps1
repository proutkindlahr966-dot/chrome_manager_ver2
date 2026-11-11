param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot
)

$ErrorActionPreference = 'Continue'
try {
  $ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd('\')
} catch {
  Write-Host "Khong tim thay thu muc du an: $ProjectRoot"
  exit 1
}
Set-Location -LiteralPath $ProjectRoot

function Norm([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
  try { $full = [System.IO.Path]::GetFullPath($Path.Trim()) } catch { return '' }
  return $full.TrimEnd('\')
}

function Test-Inside([string]$Child, [string]$Parent) {
  $child = Norm $Child
  $parent = Norm $Parent
  if (-not $child -or -not $parent) { return $false }
  return $child.StartsWith($parent + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Test-KeepPath([string]$Target, [string]$Project) {
  $target = Norm $Target
  $project = Norm $Project
  if (-not $target) { return $true }
  if ($target -match '^[A-Za-z]:$') { return $true }
  if ($project) {
    if ($target.Equals($project, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    if ($project.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
    if ($target.StartsWith($project + '\', [StringComparison]::OrdinalIgnoreCase)) {
      $rel = $target.Substring($project.Length).TrimStart('\').ToLowerInvariant()
      $data = $rel -eq 'data' -or $rel.StartsWith('data\') -or $rel -eq 'chrome-profiles' -or $rel.StartsWith('chrome-profiles\') -or $rel -eq 'debug-screenshots' -or $rel.StartsWith('debug-screenshots\')
      return -not $data
    }
  }

  $parts = @($target.Split('\') | Where-Object { $_ })
  if ($parts.Count -eq 0) { return $true }
  $leaf = $parts[-1].ToLowerInvariant()
  $appNames = @(
    'chrome manager', 'chrome-manager', 'chrome_manager',
    'chrome-profiles', 'chrome_manager_new', 'debug-screenshots'
  )
  $broad = @(
    'users', 'windows', 'program files', 'program files (x86)', 'appdata', 'roaming', 'local',
    'locallow', 'programs', 'microsoft', 'windowsapps', 'temp', 'tmp', 'desktop', 'documents',
    'downloads', 'pictures', 'videos', 'music', 'onedrive', 'public', 'default', 'system32',
    'syswow64', 'programdata', 'recovery', 'perflogs', 'node_modules', 'src', 'scripts', '.git'
  )
  if (($target + '\') -match '^[A-Za-z]:\\windows(\\|$)') { return $true }
  if ($target -match '^[A-Za-z]:\\program files( \(x86\))?$') { return $true }
  if ($target -match '^[A-Za-z]:\\program files( \(x86\))?\\' -and $appNames -notcontains $leaf) { return $true }
  if ($parts.Count -eq 2 -and $parts[1].ToLowerInvariant() -eq 'users') { return $true }
  if ($parts.Count -eq 3 -and $parts[1].ToLowerInvariant() -eq 'users') { return $true }
  if ($parts.Count -eq 4 -and $parts[1].ToLowerInvariant() -eq 'users' -and $broad -contains $parts[3].ToLowerInvariant()) { return $true }
  if ($broad -contains $leaf) { return $true }
  if ($parts.Count -lt 3 -and $appNames -notcontains $leaf) { return $true }
  return $false
}

function Add-Unique([System.Collections.Generic.List[string]]$List, [string]$Path) {
  $next = Norm $Path
  if (-not $next) { return }
  foreach ($item in $List) {
    if ($item.Equals($next, [StringComparison]::OrdinalIgnoreCase)) { return }
  }
  [void]$List.Add($next)
}

function Remove-Tree([string]$Path) {
  if (Test-KeepPath $Path $ProjectRoot) {
    Write-Host "Giu lai: $Path"
    return $false
  }
  if (-not (Test-Path -LiteralPath $Path)) { return $true }
  Write-Host "Xoa: $Path"
  for ($i = 0; $i -lt 6; $i++) {
    if (-not (Test-Path -LiteralPath $Path)) { return $true }
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path -LiteralPath $Path)) { return $true }
    & cmd.exe /c "rmdir /s /q ""$Path""" | Out-Null
    if (-not (Test-Path -LiteralPath $Path)) { return $true }
    Start-Sleep -Milliseconds 700
  }
  if (Test-Path -LiteralPath $Path) {
    Write-Host "Khong xoa het duoc: $Path"
    return $false
  }
  return $true
}

Write-Host "Dang dong Chrome Manager neu dang mo..."
$electronRoot = Join-Path $ProjectRoot 'node_modules\electron'
$installedExeRoot = ''
if ($env:LOCALAPPDATA) { $installedExeRoot = Join-Path $env:LOCALAPPDATA 'Programs\Chrome Manager' }
Get-CimInstance Win32_Process | ForEach-Object {
  $name = [string]$_.Name
  $exe = [string]$_.ExecutablePath
  $kill = $false
  if ($name -eq 'Chrome Manager.exe') { $kill = $true }
  if ($exe -and $exe.StartsWith($electronRoot, [StringComparison]::OrdinalIgnoreCase)) { $kill = $true }
  if ($installedExeRoot -and $exe -and $exe.StartsWith($installedExeRoot, [StringComparison]::OrdinalIgnoreCase)) { $kill = $true }
  if ($kill) { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

$candidates = New-Object System.Collections.Generic.List[string]
Add-Unique $candidates (Join-Path $ProjectRoot 'data')
Add-Unique $candidates (Join-Path $ProjectRoot 'chrome-profiles')
Add-Unique $candidates (Join-Path $ProjectRoot 'debug-screenshots')
if ($env:APPDATA) {
  Add-Unique $candidates (Join-Path $env:APPDATA 'chrome-manager')
  Add-Unique $candidates (Join-Path $env:APPDATA 'Chrome Manager')
}
if ($env:LOCALAPPDATA) {
  Add-Unique $candidates (Join-Path $env:LOCALAPPDATA 'chrome-manager')
  Add-Unique $candidates (Join-Path $env:LOCALAPPDATA 'Chrome Manager')
  Add-Unique $candidates (Join-Path $env:LOCALAPPDATA 'Programs\Chrome Manager')
}
Add-Unique $candidates 'F:\CODE\chrome_manager_new'

$dbFiles = @(
  $(if ($env:APPDATA) { Join-Path $env:APPDATA 'chrome-manager\chrome-manager-db.json' }),
  $(if ($env:APPDATA) { Join-Path $env:APPDATA 'Chrome Manager\chrome-manager-db.json' }),
  (Join-Path $ProjectRoot 'data\chrome-manager-db.json')
) | Where-Object { $_ }

foreach ($db in $dbFiles) {
  if (-not (Test-Path -LiteralPath $db)) { continue }
  try {
    $json = Get-Content -LiteralPath $db -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    Write-Host "Bo qua file db hong: $db"
    continue
  }
  if ($json.settings) {
    Add-Unique $candidates ([string]$json.settings.profilesRoot)
    Add-Unique $candidates ([string]$json.settings.createProfilesRoot)
    foreach ($root in @($json.settings.additionalProfilesRoots)) {
      Add-Unique $candidates ([string]$root)
    }
  }
  foreach ($profile in @($json.profiles)) {
    $dir = [string]$profile.dataDir
    if (-not $dir) { continue }
    $parent = Split-Path -Parent (Norm $dir)
    if ((Test-KeepPath $dir $ProjectRoot) -or (Test-KeepPath $parent $ProjectRoot)) { continue }
    Add-Unique $candidates $dir
  }
}

$shortcuts = New-Object System.Collections.Generic.List[string]
foreach ($file in @(
  (Join-Path $ProjectRoot 'Chrome Manager.lnk'),
  $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE 'Desktop\Chrome Manager.lnk' }),
  $(if ($env:PUBLIC) { Join-Path $env:PUBLIC 'Desktop\Chrome Manager.lnk' }),
  $(if ($env:APPDATA) { Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Chrome Manager.lnk' }),
  $(if ($env:APPDATA) { Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Chrome Manager\Chrome Manager.lnk' })
)) {
  if ($file -and (Test-Path -LiteralPath $file)) { Add-Unique $shortcuts $file }
}
if ($env:APPDATA) {
  Add-Unique $candidates (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Chrome Manager')
}

$accepted = New-Object System.Collections.Generic.List[string]
foreach ($target in $candidates) {
  if (-not (Test-Path -LiteralPath $target)) { continue }
  $covered = $false
  foreach ($parent in $accepted) {
    if ($target.Equals($parent, [StringComparison]::OrdinalIgnoreCase) -or (Test-Inside $target $parent)) {
      $covered = $true
      break
    }
  }
  if ($covered) { continue }
  if (Test-KeepPath $target $ProjectRoot) {
    Write-Host "Giu lai: $target"
    continue
  }
  for ($i = $accepted.Count - 1; $i -ge 0; $i--) {
    if (Test-Inside $accepted[$i] $target) { $accepted.RemoveAt($i) }
  }
  [void]$accepted.Add($target)
}

Start-Sleep -Seconds 1
$chrome = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'"
foreach ($proc in @($chrome)) {
  $cmd = [string]$proc.CommandLine
  if (-not $cmd) { continue }
  foreach ($folder in $accepted) {
    $needle = $folder.TrimEnd('\')
    if ($cmd.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
      break
    }
  }
}
Start-Sleep -Seconds 1

$removed = New-Object System.Collections.Generic.List[string]
foreach ($file in $shortcuts) {
  if ((Split-Path -Leaf $file).ToLowerInvariant() -ne 'chrome manager.lnk') { continue }
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  Write-Host "Xoa shortcut: $file"
}
foreach ($folder in $accepted) {
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
    if ($match) {
      Remove-Item -LiteralPath $item.PSPath -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host "Go khoi registry: $($props.DisplayName)"
    }
  }
}

Write-Host "Xoa ban build cu..."
foreach ($name in @('node_modules', 'out', 'release')) {
  $path = Join-Path $ProjectRoot $name
  if (-not (Test-Path -LiteralPath $path)) { continue }
  Write-Host "Xoa: $path"
  & cmd.exe /c "rmdir /s /q ""$path""" | Out-Null
  if (Test-Path -LiteralPath $path) {
    Write-Host "Khong xoa het duoc $path. Hay dong app roi chay lai."
    exit 1
  }
}
$buildLog = Join-Path $ProjectRoot 'scripts\last-build.log'
if (Test-Path -LiteralPath $buildLog) { Remove-Item -LiteralPath $buildLog -Force -ErrorAction SilentlyContinue }

Write-Host "Dang cai dependencies..."
& cmd.exe /c "npm install"
if ($LASTEXITCODE -ne 0) {
  Write-Host "npm install that bai."
  exit $LASTEXITCODE
}

Write-Host "Dang build..."
& cmd.exe /c "npm run build"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Build that bai."
  exit $LASTEXITCODE
}

$vbs = Join-Path $ProjectRoot 'scripts\start-silent.vbs'
$lnk = Join-Path $ProjectRoot 'Chrome Manager.lnk'
$ico = Join-Path $ProjectRoot 'build\icon.ico'
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($lnk)
$shortcut.TargetPath = 'wscript.exe'
$shortcut.Arguments = '"' + $vbs + '"'
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Chrome Manager'
if (Test-Path -LiteralPath $ico) { $shortcut.IconLocation = "$ico,0" }
$shortcut.Save()
Write-Host "Da tao shortcut: $lnk"
exit 0
