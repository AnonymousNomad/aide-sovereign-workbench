$ErrorActionPreference = 'Stop'

Write-Host "desktop lifecycle smoke: starting from $((Get-Location).Path); script root $PSScriptRoot"
$bundleCandidates = @(
  (Join-Path $PSScriptRoot '..\desktop\target\release\bundle'),
  (Join-Path ((Get-Location).Path) 'desktop\target\release\bundle'),
  (Join-Path $PSScriptRoot '..\target\release\bundle'),
  (Join-Path ((Get-Location).Path) 'target\release\bundle')
)
Write-Host "desktop lifecycle smoke: bundle candidates $($bundleCandidates -join '; ')"
$bundleRoot = $null
foreach ($candidate in $bundleCandidates) {
  if (Test-Path -LiteralPath $candidate -PathType Container) { $bundleRoot = $candidate; break }
}
if (-not $bundleRoot) { throw "desktop bundle directory is missing; checked: $($bundleCandidates -join ', ')" }
$bundleFiles = @(Get-ChildItem -LiteralPath $bundleRoot -Recurse -File)
Write-Host "desktop lifecycle smoke: bundle root $bundleRoot"
Write-Host 'desktop lifecycle smoke: bundle files'
$bundleFiles | ForEach-Object { Write-Host " - $($_.FullName)" }
$msi = $bundleFiles | Where-Object { $_.Extension -ieq '.msi' } | Select-Object -First 1
$nsis = $bundleFiles | Where-Object {
  $_.Extension -ieq '.exe' -and
  $_.FullName -match '(?i)\\nsis\\' -and
  $_.Name -notmatch '(?i)(uninstall|AIDE Sovereign Workbench\.exe$)'
} | Select-Object -First 1
if (-not $msi -and -not $nsis) { throw "no Windows installer found under $bundleRoot; bundle files: $($bundleFiles.Name -join ', ')" }

$installer = if ($msi) { $msi.FullName } else { $nsis.FullName }
$installerKind = if ($msi) { 'msi' } else { 'nsis' }
$productName = 'AIDE Sovereign Workbench'
$appExeName = "$productName.exe"
$installLog = Join-Path $env:TEMP 'aide-desktop-msi-install.log'

function Get-UninstallEntries {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($root in $roots) {
    Get-ItemProperty -Path $root -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq $productName }
  }
}

function Find-InstalledExe {
  $entries = @(Get-UninstallEntries)
  foreach ($entry in $entries) {
    if ($entry.InstallLocation) {
      $candidate = Join-Path $entry.InstallLocation $appExeName
      if (Test-Path -LiteralPath $candidate) { return [PSCustomObject]@{ Exe = $candidate; Entry = $entry } }
    }
  }
  $roots = @(
    $env:LOCALAPPDATA,
    (Join-Path $env:LOCALAPPDATA 'Programs'),
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)}
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  foreach ($root in $roots) {
    foreach ($directory in @($root, (Join-Path $root $productName), (Join-Path $root 'AIDE Sovereign Workbench'))) {
      $candidate = Join-Path $directory $appExeName
      if (Test-Path -LiteralPath $candidate) { return [PSCustomObject]@{ Exe = $candidate; Entry = ($entries | Select-Object -First 1) } }
    }
  }
  return $null
}

function Invoke-Installer {
  param([string]$Mode)
  Write-Host "desktop lifecycle smoke: invoking $Mode installer"
  if ($installerKind -eq 'msi') {
    $installerArg = '"' + $installer + '"'
    $logArg = '"' + $installLog + '"'
    $arguments = if ($Mode -eq 'uninstall') {
      @('/x', $installerArg, '/qn', '/norestart', '/L*v', $logArg)
    } else {
      @('/i', $installerArg, '/qn', '/norestart', '/L*v', $logArg, 'REINSTALL=ALL', 'REINSTALLMODE=amus')
    }
    $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -PassThru
  } else {
    $arguments = if ($Mode -eq 'uninstall') { @('/S') } else { @('/S') }
    $process = Start-Process -FilePath $installer -ArgumentList $arguments -PassThru
  }
  if (-not $process.WaitForExit(180000)) { $process.Kill(); throw "$Mode installer exceeded the 180-second timeout" }
  if ($process.ExitCode -notin @(0, 3010)) { throw "$Mode installer failed with exit code $($process.ExitCode)" }
}

Write-Host "desktop lifecycle smoke: installing $installer ($installerKind)"
Invoke-Installer 'install'
Write-Host 'desktop lifecycle smoke: locating installed executable'
$installed = Find-InstalledExe
if (-not $installed) { throw "installed $productName executable was not found" }

Write-Host "desktop lifecycle smoke: launching $($installed.Exe)"
$app = Start-Process -FilePath $installed.Exe -PassThru
Start-Sleep -Seconds 5
if ($app.HasExited) { throw "installed application exited during launch with code $($app.ExitCode)" }
Write-Host 'desktop lifecycle smoke: checking daemon health'
$health = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4777/health' -TimeoutSec 15
if ($health.StatusCode -ne 200) { throw "installed daemon health returned HTTP $($health.StatusCode)" }
if (-not $app.CloseMainWindow()) { $app.Kill() }
if (-not $app.WaitForExit(15000)) { $app.Kill(); $app.WaitForExit() }

Write-Host 'desktop lifecycle smoke: same-build reinstall/upgrade probe'
Invoke-Installer 'upgrade'
if (-not (Find-InstalledExe)) { throw 'same-build reinstall removed the installed executable' }

$entry = @(Get-UninstallEntries) | Select-Object -First 1
if ($entry -and $entry.PSChildName -match '^\{[0-9A-F-]+\}$' -and $installerKind -eq 'msi') {
  Write-Host 'desktop lifecycle smoke: uninstalling MSI product'
  $uninstallLog = '"' + (Join-Path $env:TEMP 'aide-desktop-msi-uninstall.log') + '"'
  $uninstall = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/x', $entry.PSChildName, '/qn', '/norestart', '/L*v', $uninstallLog) -PassThru
  if (-not $uninstall.WaitForExit(180000)) { $uninstall.Kill(); throw 'uninstall exceeded the 180-second timeout' }
  if ($uninstall.ExitCode -notin @(0, 3010)) { throw "uninstall failed with exit code $($uninstall.ExitCode)" }
} else {
  Invoke-Installer 'uninstall'
}

Start-Sleep -Seconds 2
if (Find-InstalledExe) { throw 'installed application remains after uninstall' }
try {
  Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4777/health' -TimeoutSec 3 | Out-Null
  throw 'daemon remained reachable after desktop uninstall'
} catch [System.Net.WebException] {
  # Expected: the shell-owned daemon is gone after the application closes.
}
Write-Host 'desktop lifecycle smoke passed: install, launch, health, close, reinstall, uninstall, cleanup'
