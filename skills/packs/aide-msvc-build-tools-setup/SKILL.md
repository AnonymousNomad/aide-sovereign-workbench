# Skill: aide-msvc-build-tools-setup

# MSVC Build Tools Setup — The Packaging Blocker

The Tauri 2 desktop build requires MSVC Build Tools (Visual C++ compiler + linker).
This is the #1 blocker for Phase 8 packaging. This skill documents exactly how to
install it and verify it works.

## Why MSVC

- Tauri 2 sidecar compilation requires `link.exe` from MSVC
- Rust MSVC toolchain (`stable-x86_64-pc-windows-msvc`) needs MSVC Build Tools
- GNU toolchain needs MinGW binutils (dlltool.exe) — also not installed
- MSVC is the standard path for Windows Rust development

## Installation (requires admin)

### Method 1: winget (preferred)
```powershell
# Run in elevated PowerShell (Run as Administrator)
winget install Microsoft.VisualStudio.2022.BuildTools --accept-source-agreements --accept-package-agreements
```

### Method 2: Direct download
1. Download from https://aka.ms/vs/17/release/vs_BuildTools.exe
2. Run the installer
3. Select "Desktop development with C++"
4. Install (~2-4GB)

### Method 3: VS2022 Community (if you want full IDE)
```powershell
winget install Microsoft.VisualStudio.2022.Community --accept-source-agreements --accept-package-agreements
```

## Verification

After installation, verify:

```powershell
# Check for link.exe in MSVC paths
Get-ChildItem "C:\Program Files*" -Recurse -Filter "link.exe" -ErrorAction SilentlyContinue -Depth 7 |
  Where-Object { $_.FullName -match "MSVC|VC|Tools" } |
  Select-Object -First 3 | % { $_.FullName }

# Check for cl.exe (C++ compiler)
Get-ChildItem "C:\Program Files*" -Recurse -Filter "cl.exe" -ErrorAction SilentlyContinue -Depth 7 |
  Select-Object -First 3 | % { $_.FullName }

# Check vswhere
& "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
```

## After Installation

1. Set Rust default to MSVC:
```powershell
$env:PATH += ";$env:USERPROFILE\.cargo\bin"
rustup default stable-x86_64-pc-windows-msvc
```

2. Test cargo build:
```powershell
cd E:\aide-sovereign-workbench\desktop
cargo check
```

3. Run packaging battery:
```powershell
node scripts/packaging-battery.mjs
```

## Known Issues

- winget install may timeout (large download ~2-4GB) — retry with longer timeout
- winget may need admin privileges — exit code 2147942512 means "needs elevation"
- After install, restart terminal to pick up PATH changes
- Some antivirus may block the installer — temporarily disable if needed

## If You Can't Install

If admin access is unavailable, the packaging phase is blocked. Continue with:
- All other phases (they don't need MSVC)
- Research and skill creation
- Code hardening and testing
- UX improvements
