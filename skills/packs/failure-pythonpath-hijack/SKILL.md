---
name: failure-pythonpath-hijack
description: Fix for PYTHONPATH=E:\python_packages hijacking venv imports. Old broken torch in global packages overrides venv. Created 2026-08-26.
---

# Failure: PYTHONPATH Hijacks Venv Imports

## What Failed
PyTorch CUDA 11.8 installation fails because `PYTHONPATH=E:\python_packages` is a system env var. An old broken torch installation in that directory overrides the venv's torch, causing:
- `OSError: [WinError 126]` when loading torch_python.dll
- CUDA not detected (old torch missing CUDA libs)
- Unsloth can't find GPU

## Root Cause
System env var `PYTHONPATH=E:\python_packages` adds global packages to ALL Python subprocesses, bypassing venv isolation. The old torch in that directory is missing DLLs.

## Fix
**DEFINITIVE FIX (applied 2026-08-29):** Deleted `E:\python_packages` entirely and removed `PYTHONPATH=E:\python_packages` from the User environment. Root cause eliminated; no workaround required. Verified working venv = `E:\felon_workspace\venv\Scripts\python.exe` (Python 3.13.14, torch 2.13.0+cu130, numpy 2.5.2).

**Workaround (if PYTHONPATH ever returns):** Every Python command must clear PYTHONPATH first:

```powershell
$env:PYTHONPATH = $null
& "E:\felon_workspace\venv\Scripts\python.exe" <args>
```

## Prevention
- Always clear PYTHONPATH before running venv Python
- Create a wrapper script `run-python.ps1` that handles this
- Never install packages into `E:\python_packages`

## Verification
```powershell
$env:PYTHONPATH = $null
& "E:\models\house-model\venv-train\Scripts\python.exe" -c "import sys; print([p for p in sys.path if 'python_packages' in p])"
# Expected: [] (empty - no global packages)
```
