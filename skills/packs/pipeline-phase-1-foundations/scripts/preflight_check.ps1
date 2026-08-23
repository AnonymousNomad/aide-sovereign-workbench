# preflight_check.ps1 — MANDATORY gate before ANY major training or process launch.
# Run this and get PASS before starting anything that uses GPU/RAM.
# History: 2026-08-20 the 10x llama-server pileup + game = laptop crash. Never again.
# Usage: pwsh -File preflight_check.ps1 [-RequiredRamGB 4] [-RequiredGpuMB 3500] [-AllowGame]
param(
    [double]$RequiredRamGB = 4.0,
    [double]$RequiredGpuMB = 3500,
    [switch]$AllowGame
)

$ErrorActionPreference = "Continue"
$FAIL = 0

Write-Host "===== PREFLIGHT CHECK $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') =====" -ForegroundColor Cyan

# 1. Process audit — anything that could hold GPU/RAM
Write-Host "`n--- Process audit ---"
$bad = @()
Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match "llama|python|torch|train|game|autodesk|steam|epic|battle|riot|minecraft|blender|davinci|obs"
} | ForEach-Object {
    $pid_ = $_.ProcessId
    $cmd = if ($_.CommandLine) { $_.CommandLine.Substring(0, [Math]::Min(90, $_.CommandLine.Length)) } else { $_.ExecutablePath }
    $skip = $false
    if ($_.Name -match "python") {
        # opencode itself may host python-less node; our own scripts must be explicit
        if ($cmd -match "supervisor_v2|gen_chat_corpus") { $skip = $false } # ours = must be audited
    }
    if ($_.Name -eq "node.exe") {
        $skip = $true  # opencode terminals are allowed (user rule: 2 terminals stay)
    }
    Write-Host ("  PID {0,-6} {1,-22} {2}" -f $pid_, $_.Name, $cmd)
    if (-not $skip -and $_.Name -match "llama|python") { $bad += "$($_.Name) PID $pid_" }
}
if ($bad.Count) {
    Write-Host "WARNING: GPU/RAM-holding processes found: $($bad -join ', ')" -ForegroundColor Yellow
    Write-Host "Do NOT start training while these run (or kill them first)." -ForegroundColor Yellow
    $FAIL += 1
}

# 2. RAM gate
$os = Get-CimInstance Win32_OperatingSystem
$freeGB = $os.FreePhysicalMemory / 1MB
Write-Host "`n--- RAM ---"
Write-Host ("  Free: {0:N1} GB / {1:N1} GB  (need >= {2:N1} GB)" -f $freeGB, ($os.TotalVisibleMemorySize/1MB), $RequiredRamGB)
if ($freeGB -lt $RequiredRamGB) {
    Write-Host "  FAIL: not enough free RAM" -ForegroundColor Red
    $FAIL += 1
} else {
    Write-Host "  PASS" -ForegroundColor Green
}

# 3. GPU gate (nvidia-smi)
Write-Host "`n--- GPU ---"
$smi = Get-Command nvidia-smi -EA SilentlyContinue
if ($smi) {
    $gpu = & nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits
    Write-Host "  $gpu"
    $parts = $gpu -split "," | ForEach-Object { $_.Trim() }
    $usedMB = [double]$parts[0]; $totalMB = [double]$parts[1]
    $freeMB = $totalMB - $usedMB
    Write-Host ("  Free VRAM: {0:N0} MB / {1:N0} MB  (need >= {2:N0} MB)" -f $freeMB, $totalMB, $RequiredGpuMB)
    if ($freeMB -lt $RequiredGpuMB) {
        Write-Host "  FAIL: not enough free VRAM" -ForegroundColor Red
        $FAIL += 1
    } else {
        Write-Host "  PASS" -ForegroundColor Green
    }
} else {
    Write-Host "  nvidia-smi not found — verify torch.cuda separately" -ForegroundColor Yellow
}

# 4. A/C power gate
$batt = Get-CimInstance Win32_Battery -EA SilentlyContinue
if ($batt) {
    Write-Host "`n--- Power ---"
    if ($batt.BatteryStatus -eq 2) {
        Write-Host "  On A/C power: PASS" -ForegroundColor Green
    } else {
        Write-Host "  ON BATTERY: FAIL — plug in before any training" -ForegroundColor Red
        $FAIL += 1
    }
}

Write-Host "`n===== RESULT: $(if ($FAIL -eq 0) { 'PASS — safe to start' } else { "FAIL ($FAIL issue(s)) — do NOT start" }) =====" -ForegroundColor $(if ($FAIL -eq 0) { "Green" } else { "Red" })
exit $FAIL