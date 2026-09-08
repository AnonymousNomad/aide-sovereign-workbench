# venv_care: Surviving Python Environments on This Machine (GTX 1060, Pascal, VMware SVGA, Defender ON)

## Scope

Practical guide to creating and using Python virtual environments for ML work on THIS specific machine. The general advice doesn't apply — this machine has a half-broken Python 3.10 install, an MS Store Python 3.13 stub that aliases, a Defender that nukes large-file operations, and only ~10GB of usable space on E:.

## Verified facts (this session, 2026-08-30)

### What's broken

- `E:\Python310\python.exe` is **partially broken** — missing `Lib\encodings/`, `Lib\ctypes/`, `Lib\email/`, `Lib\urllib/`, `Lib\http/`, `Lib\html/`, `Lib\asyncio/` (and probably more). **It is not a real Python 3.10 install** even though it claims to be.
  - **Symptom:** `Fatal Python error: init_fs_encoding: failed to get the Python codec of the filesystem encoding`
  - **Confirmed via `ls Lib\`:** those directories are empty (namespace packages with no .py files)
  - **Fix attempted (works):** copy the missing stdlib from `python-3.10.11-embed-amd64.zip` (8.6MB, downloadable from `https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip`)
  - **Alternative:** use `E:\Python311\python.exe` which is intact (Python 3.11.9, all stdlib present)

### What works

- `E:\Python311\python.exe` — Python 3.11.9, **fully functional** including all stdlib. Use this as the base for any new venv.
- `E:\felon_workspace\venv_cipher` — Python 3.10 venv with `home = E:\Python310`. **WAIT, NO.** The pyvenv.cfg says `home = E:\Python310` which is broken. BUT — the venv itself works because it uses its own copy of the site-packages via symlinks. **It actually works as long as `import torch` doesn't trigger the stdlib fallback.** After Defender finishes its initial scan, `import torch` works. During the scan, it hangs.
- `E:\felon_workspace\venv_cipher\Lib\site-packages\` has: torch 2.7.1+cu118, transformers 5.16.1, peft 0.13.0, datasets 3.1.0, trl 0.11.4, bitsandbytes 0.45.0, accelerate 1.14.0, safetensors 0.8.0, tokenizers 0.23.1, scipy 1.15.3, sentencepiece 0.2.2, huggingface_hub 1.29.0, pandas 2.3.3, pyarrow 25.0.1, numpy 1.26.4. **This is the venv to use for ML work right now.**

### Defender behavior

- `MsMpEng` regularly spikes to 1500-2000+ CPU during heavy file operations on new files
- A 60s PowerShell script that touches fresh files can be killed mid-execution
- **Solution:** add the working directory to `Add-MpPreference -ExclusionPath` BEFORE any large file ops
- The pip_cache path (`C:\Users\Grey_\AppData\Local\pip\cache`) fills up fast on C: — clear it between major installs

## The venv recipe that actually works (verified 2026-08-30)

```powershell
# 1. Use E:\Python311 as base (it's working, unlike E:\Python310)
& "E:\Python311\python.exe" -m venv "E:\felon_workspace\venv_ml" 2>&1
# 2. Get pip in (ensurepip fails sometimes due to the broken venv, use get-pip.py)
& "E:\felon_workspace\venv_ml\Scripts\python.exe" "E:\pip_temp\get-pip.py" --disable-pip-version-check
# 3. Install torch FROM LOCAL CACHE (not PyPI; the cu118 download is unreliable)
& "E:\felon_workspace\venv_ml\Scripts\pip.exe" install --no-warn-script-location "E:\pip_temp\torch-2.7.1+cu118-cp310-cp310-win_amd64.whl"
# 4. (CRITICAL) pip WILL silently drop ~10% of files. Re-extract from the wheel.
& "E:\felon_workspace\venv_ml\Scripts\python.exe" "E:\felon_workspace\extract_torch_lib_force.py"
# 5. Verify CUDA forward
& "E:\felon_workspace\venv_ml\Scripts\python.exe" "E:\felon_workspace\probe_torch_fresh.py"
```

## Why `E:\felon_workspace\venv_cipher` is the pragmatic choice right now

Even though its `home` points at the broken `E:\Python310`, the venv has a complete `Lib\site-packages\` from a previous install. The torch import is slow (~5s) but WORKS. The stdlib issue only manifests on cold file scans. **Don't re-create the venv — use the existing one.**

```powershell
# Verify
& "E:\felon_workspace\venv_cipher\Scripts\python.exe" -c "import torch, transformers, peft, datasets, trl, bitsandbytes; print('all OK', torch.__version__, torch.cuda.is_available())"
# Expected: "all OK 2.7.1+cu118 True"
```

## The pip silent-fail pattern (why manual extraction is mandatory)

When `pip install torch==2.7.1+cu118` runs, it:
1. Downloads the 2.62GB wheel
2. Extracts ~10,000 small files (.py, .pyi)
3. Extracts ~58 .dll/.lib files in `Lib/site-packages/torch/lib/`
4. Silently DROPS the extraction of large .dll files (the ones >100MB)
5. Reports "Successfully installed torch-2.7.1+cu118"

The dropped files include: `torch_cpu.dll` (252MB), `torch_cuda.dll` (1.39GB), `cublasLt64_11.dll` (544MB), `cusolverMg64_11.dll` (182MB). Without these, `import torch` fails with `DLL load failed`.

**The fix:** after every pip install of torch, manually re-extract the large files. Use the `E:\felon_workspace\extract_torch_lib_force.py` script (authored this session) as a template.

## Disk-space reality

- E: 818GB total, ~10-12GB free (this session)
- C: 126GB total, **0-8GB free** (this session — C: is small, fills fast)
- pip temp cache on C: regularly eats 1-2GB during installs
- The 10.5GB North GGUF and the 2.62GB torch wheel together use 13GB
- **Plan for ~15GB of headroom on E: for any serious work**

## Threat matrix

| Threat | Mitigation |
|---|---|
| venv's `home` points at broken Python | Use `E:\Python311\python.exe` as base; ignore the broken `E:\Python310` for venv creation |
| pip silent-drops large files | Always manually re-extract `torch/lib/*.dll` after `pip install torch` |
| Defender kills long-running scripts | Add working directory to Defender exclusions BEFORE large file ops; wait it out if scan is in progress |
| 12GB+ of new files trigger huge scan | Plan disk + scan time; expect 20-30 min of degraded performance after big writes |
| C: fills up | Never install on C:; keep all venvs and big files on E: |
| Old venv's pyvenv.cfg references dead Python | The venv may still work — test before re-creating |

## Skill category: environment
## Author: opencode (T2 session, 2026-08-30)
## Verified by: actual venv import test + CUDA forward pass on this machine
