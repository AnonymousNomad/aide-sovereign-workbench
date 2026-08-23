# setup_env.ps1 — Phase 1 idempotent toolchain bootstrap
# Run twice -> same env. Never plain python; never PYTHONPATH=E:\python_packages.
# Usage: pwsh -File setup_env.ps1
$ErrorActionPreference = "Stop"
$env:PYTHONPATH = ""
$VENV = "E:\felon_workspace\venv_trek"
$LOCK = "E:\pip_temp\opencode\requirements-lock.txt"

if (-not (Test-Path "$VENV\Scripts\python.exe")) {
    Write-Host "Creating venv at $VENV"
    py -3.10 -E -m venv $VENV
} else {
    Write-Host "venv exists — idempotent pass"
}

$PY = "$VENV\Scripts\python.exe"
& $PY -m pip install --upgrade pip --quiet

# torch from the CUDA index ONLY (PyPI default gives CPU wheel on Windows)
& $PY -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing torch (cu128 index)"
    & $PY -m pip install "torch==2.9.1+cu128" --index-url https://download.pytorch.org/whl/cu128
}

# pinned majors
& $PY -m pip install "numpy>=2,<3" "tokenizers>=0.20" "pyyaml" "pytest>=8" "huggingface_hub" --quiet

# lockfile
if (Test-Path $LOCK) {
    Write-Host "Lockfile present — compare with current env:"
    & $PY -m pip check
} else {
    & $PY -m pip freeze | Out-File -FilePath $LOCK -Encoding utf8
    Write-Host "Lockfile written: $LOCK"
}

Write-Host "== env setup done — verify with verify_hardware.ps1 ==" -ForegroundColor Green