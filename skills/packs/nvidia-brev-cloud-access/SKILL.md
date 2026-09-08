# Skill: nvidia-brev-cloud-access (Phase C0)

# Brev Access Wiring — Credits, CLI, Instance Discovery

## Objective
Verify NVIDIA cloud credits are actually usable through Brev, install the CLI
on THIS Windows machine, see real instance offerings, and choose the exact
instance class. DONE = `brev ls` returns instances/availability + credits
confirmed visible. Until then, the cloud lane is research-only.

## Why this order (research-grounded)
- Brev is NVIDIA's GPU-access product: streamlined on-demand instances on cloud
  providers with automatic env setup (source: brevdev/brev-cli README, primary).
- Windows path is **WSL2-only** for the CLI — no native exe. Do not fight this;
  WSL already exists on most dev boxes; verify before assuming.

## Procedure

### Step 0 — What "NVIDIA Crowd Cloud credits" means (2-minute empirical check)
Do not theorize. Install CLI, log in; if credits exist they surface in console/
CLI or login fails with a quota message that names the truth.
- If `brev login` opens a browser SSO tied to your NVIDIA account → confirmed.
- If nothing appears: open brev.nvidia.com in browser, screenshot the credits
  panel, ASK the operator if it's a different program instead of guessing.

### Step 1 — WSL2 prerequisite check (Windows host)
```powershell
wsl --status          # installed? default distro Ubuntu >=22.04?
wsl -l -v             # state Running/Stopped fine
```
If missing: `wsl --install -d Ubuntu-22.04` then reboot (BIOS virtualization
must be enabled — see PC-management skill hardware notes).

### Step 2 — Install Brev CLI inside WSL
```bash
curl -fsSL https://raw.githubusercontent.com/brevdev/brev-cli/main/bin/install-latest.sh | bash
export PATH="$HOME/.local/bin:$PATH"   # add to ~/.bashrc too
brev --version
```

### Step 3 — Authenticate
```bash
brev login      # opens browser SSO to NVIDIA/Brev account
```

### Step 4 — Discover offerings + pick instance
```bash
brev ls         # what regions/GPU classes are actually available NOW
```
Selection law (project-specific):
1. GPU count = **1** (never rent multi-GPU node for a ≤150M model)
2. Preference order for our budget: **H100-80GB > A100-80GB > A100-40GB**
   (H100 buys full Chinchilla band ~2.8B tok inside one window; A100 still
   clears the proven 819M band comfortably)
3. Record $/hr equivalent (Lambda table as reference) in AGENT_NOTES so credit
   burn per phase is auditable.

### Step 5 — SSH keys hygiene (ARMOR)
```bash
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519   # dedicated key OK
```
Keys NEVER enter any repo dir, never appear in logs/screenshots. Before ANY git
commit during this lane: `git diff --staged` scan for key material (fail-closed).

## Code to run first time (single copy-paste audit block)
```bash
set -e
command -v wsl.exe >/dev/null 2>&1 && echo "[host] WSL present"
wsl -e bash -lc 'set -e; command -v brev || { curl -fsSL https://raw.githubusercontent.com/brevdev/brev-cli/main/bin/install-latest.sh | bash; }; export PATH="$HOME/.local/bin:$PATH"; brev --version'
```

## What NOT to do
- Do NOT create an instance in this phase (that's provisioning inside C2 flow,
  right before the probe, minimizing idle billing between phases).
- Do NOT store tokens in PowerShell history files or paste them into chat.
- Do NOT accept the first available GPU type blindly — an 8×H100 node burns 8×
  credits while 7 GPUs idle at our scale.

## Dependencies
- WSL2 + Ubuntu ≥22.04 · working browser for SSO · active credits.

## Failure classes → actions
| Symptom | Likely cause | Action |
|---|---|---|
| `brev: command not found` post-install | PATH not exported in non-login shell | add ~/.bashrc line; use `bash -lc` |
| Login spins forever | corporate proxy blocking callback | whitelist/notify operator; try hotspot test |
| `brev ls` empty everywhere | region stock-out or wrong account tier | re-check later windows; DO NOT switch providers without operator decision |
| Credits not visible | different NVIDIA program than Brev | STOP → ask operator which console to redeem |

## Gate to C1
`brev ls` output pasted into AGENT_NOTES entry + chosen target class named +
credits evidence (console screenshot filename or CLI line) recorded.
