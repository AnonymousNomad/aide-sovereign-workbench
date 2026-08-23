# verify_hardware.ps1 — Phase 1 hardware gate (8 asserts + 5-min burn-in)
# Run BEFORE any training. All asserts must pass or abort.
# Usage: pwsh -File verify_hardware.ps1
$ErrorActionPreference = "Stop"
$env:PYTHONPATH = ""
$PY = "E:\felon_workspace\venv_trek\Scripts\python.exe"

Write-Host "== Phase 1 hardware verification ==" -ForegroundColor Cyan

# Assert 8: A/C power (BatteryStatus 2 = on AC; 1 = discharging)
$batt = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
if ($batt -and $batt.BatteryStatus -ne 2) {
    Write-Host "FAIL: running on battery — plug in A/C before training" -ForegroundColor Red
    exit 1
}
Write-Host "PASS: A/C power"

$code = @'
import torch, sys
fails = []
def chk(name, cond):
    print(("PASS" if cond else "FAIL") + ": " + name)
    if not cond: fails.append(name)

chk("cuda available", torch.cuda.is_available())
if torch.cuda.is_available():
    cap = torch.cuda.get_device_capability()
    props = torch.cuda.get_device_properties(0)
    chk("capability == (6,1)", cap == (6,1))
    chk("name contains GTX 1060", "1060" in torch.cuda.get_device_name(0))
    chk("properties major/minor == 6/1", (props.major, props.minor) == (6,1))
    chk("baseline mem < 200MB", torch.cuda.memory_reserved() < 200*1024*1024)
    chk("allow_tf32 False", torch.backends.cuda.matmul.allow_tf32 == False)
    chk("cudnn.benchmark False", torch.backends.cudnn.benchmark == False)
    # determinism smoke: same FP32 matmul twice -> identical
    a = torch.randn(100, 100, device="cuda")
    r1 = (a @ a).clone(); torch.cuda.synchronize()
    r2 = (a @ a).clone(); torch.cuda.synchronize()
    chk("determinism smoke identical", torch.equal(r1, r2))
    # burn-in: 5 min matmul loop, memory stable, no TDR
    import time
    torch.cuda.reset_peak_memory_stats()
    t0 = time.time(); steps = 0
    while time.time() - t0 < 300:
        for _ in range(10):
            _ = torch.matmul(torch.randn(512,512,device="cuda"),
                             torch.randn(512,512,device="cuda"))
        steps += 10
        if steps % 100 == 0:
            print(f"burn-in {steps} steps, mem={torch.cuda.memory_allocated()/1e6:.0f}MB")
    torch.cuda.synchronize()
    peak = torch.cuda.max_memory_allocated()/1e6
    print(f"burn-in done: peak {peak:.0f}MB")
    chk("burn-in memory stable (<2GB)", peak < 2000)
if fails:
    print("FAILURES:", fails); sys.exit(1)
print("ALL HARDWARE ASSERTS PASS")
'@
$code | & $PY -
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: hardware gate" -ForegroundColor Red; exit 1 }
Write-Host "== hardware verification PASSED ==" -ForegroundColor Green