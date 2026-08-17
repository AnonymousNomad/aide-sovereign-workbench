$ErrorActionPreference = "Stop"

$Models = @(
    @{ Name = "qwen-coder-1.5b-q4"; File = "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf"; Port = 8087; Ctx = 4096 },
    @{ Name = "smollm2-360m-q8";    File = "smollm2-360m-instruct-q8_0.gguf";        Port = 8082; Ctx = 2048 },
    @{ Name = "qwen-coder-0.5b-q4"; File = "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf"; Port = 8083; Ctx = 4096 }
)

$BaseDir  = "E:\aide-sovereign-workbench"
$ModelDir = Join-Path $BaseDir "models"
$LogDir   = Join-Path $BaseDir "logs"
$Interp   = "py"
$InterpArgs = @("-3.10", "-E")

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-Host "== AIDE model servers (CPU inference, GTX 1060 -> n_gpu_layers 0) =="

foreach ($m in $Models) {
    $gguf = Join-Path $ModelDir $m.File
    if (-not (Test-Path -LiteralPath $gguf)) {
        Write-Host "SERVER $($m.Port) FAILED: model file missing: $gguf" -ForegroundColor Red
        exit 1
    }
}

$jobs = @()
foreach ($m in $Models) {
    $gguf = Join-Path $ModelDir $m.File
    $stdoutLog = Join-Path $LogDir "server-$($m.Port).out.log"
    $stderrLog = Join-Path $LogDir "server-$($m.Port).err.log"
    $args = @("-m", "llama_cpp.server", "--model", $gguf, "--host", "127.0.0.1", "--port", "$($m.Port)", "--n_ctx", "$($m.Ctx)", "--n_gpu_layers", "0", "--logits_all", "false")
    Write-Host "Starting $($m.Name) on port $($m.Port) (n_ctx $($m.Ctx))..."
    $p = Start-Process -FilePath $Interp -ArgumentList ($InterpArgs + $args) -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
    $jobs += [PSCustomObject]@{ Model = $m; Process = $p }

    Write-Host "Waiting for model load (CPU, may take 30-90s)..."
    Start-Sleep -Seconds 5
    $deadline = [DateTime]::UtcNow.AddMinutes(5)
    $ok = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($p.HasExited) { break }
        try {
            $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$($m.Port)/v1/models" -TimeoutSec 5
            if ($resp.data -and $resp.data.Count -gt 0) { $ok = $true; break }
        } catch {
            Start-Sleep -Seconds 5
        }
    }
    if ($ok) {
        Write-Host "SERVER $($m.Port) READY" -ForegroundColor Green
    } else {
        Write-Host "SERVER $($m.Port) FAILED" -ForegroundColor Red
        if (Test-Path (Join-Path $LogDir "server-$($m.Port).err.log")) {
            Write-Host "--- stderr tail ---"
            Get-Content (Join-Path $LogDir "server-$($m.Port).err.log") -Tail 15
            Write-Host "--- stderr tail end ---"
        }
    }
}

Write-Host ""
Write-Host "Press Enter to stop all model servers..."
Read-Host | Out-Null

foreach ($job in $jobs) {
    if (-not $job.Process.HasExited) {
        Stop-Process -Id $job.Process.Id -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped $($job.Model.Name) (PID $($job.Process.Id))"
    }
}
Write-Host "All model servers stopped."