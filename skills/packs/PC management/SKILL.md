---
name: PC management
description: Owner's manual for THIS machine (ASUS GL703GM — i7-8750H / GTX 1060 / 16GB RAM / 120Hz). Use whenever helping with hardware, CPU/GPU usage, storage, gaming setup, thermals, drivers, or performance tuning. Read like the device's manual so every hardware decision is grounded in the real spec.
---

# PC Management — Owner's Manual
## Machine: ASUS ROG Strix GL703GM (laptop)

This is the standing owner's manual for the user's physical PC. Every hardware
recommendation below is anchored to the real, verified spec of this machine.
Before giving hardware/performance advice, re-read the **Machine Profile** and
**Current Health** sections, and re-run the diagnostic commands in
**Appendix A** if the system may have changed.

---

## 1. Machine Profile (verified)

| Component | Spec | Notes |
|---|---|---|
| Chassis | ASUS GL703GM (ROG Strix, ~17.3") | Gaming laptop, single cooling loop for CPU+GPU |
| OS | Windows 11 Home **Insider Preview** (build 10.0.26220) | Insider ring = less stable than release. Expect occasional quirks; keep backups. |
| CPU | Intel Core i7-8750H (Coffee Lake) | 6 cores / 12 threads. Base 2.20 GHz, all-core turbo 3.9 GHz, single-core 4.1 GHz. 45 W TDP. |
| GPU | NVIDIA GeForce GTX 1060 | ASUS ships this model with **6 GB GDDR5**. Windows adapter RAM may report ~4 GB (known underreport) — confirm with GPU-Z. Driver 32.0.15.8228. |
| Display | 1920×1080 @ **120 Hz** | 120 Hz panel. Cap games a few fps below 120 (≈117) when using VRR. |
| RAM | **1× 16 GB DDR4-2667 (SK Hynix)** in ChannelA-DIMM0 | ⚠️ SINGLE STICK = single-channel mode. This is the #1 no-cost performance loss on this box. |
| Storage | C: 118 GB (OS) · E: 818 GB · L: (LOREIN) 113 GB | C: is the boot/OS drive. See health warning. |
| Network | Realtek 1 Gbps Ethernet + Tailscale tunnel | Wired Ethernet preferred for online gaming. |
| Power | "High performance" plan active | Good for gaming, but only meaningful while on AC. |

### Why this spec matters for advice
- **i7-8750H** runs hot by design (Intel thermal throttle ceiling 100°C; ASUS
  sets PROCHOT lower, often ~95°C). It is a 6-core mobile chip that is
  frequently **power- and thermally-limited**, not a desktop part. Do NOT
  recommend aggressive overclocks. Tuning = undervolt + power-limit management,
  not pushing clocks.
- **GTX 1060** is a 2016-era Pascal card. No DLSS/Frame Gen/Reflex. It is the
  FPS ceiling for every game. Tune for frame consistency and latency, not
  upscaling wizardry.
- **Single-channel RAM** silently caps the CPU/GPU. Fixing it (see §4) is the
  highest-ROI hardware change available.

---

## 2. Current Health & Alerts

Re-confirm with Appendix A before acting; this reflects the profiling session.

1. 🔴 **C: drive critically low — 8.3 GB free of 118 GB (~7%).**
   SSDs degrade badly above ~90% full (no garbage-collection headroom). This
   also starves the page file and shader cache. **Action required** (§5).
2. 🟡 **Single-channel RAM** — see §4. Estimated 10–17% FPS loss in many
   titles (up to ~40% on 1% lows in bandwidth-sensitive games).
3. 🟡 **Insider Preview OS** — treat as less stable; verify backups before
   big changes. Avoid suggesting registry hacks that assume a release build.
4. 🟢 **High-performance power plan active** — good baseline for AC gaming.
5. 🟢 **120 Hz panel present** — use a 117 fps cap with VRR for tear-free,
   low-latency play.

---

## 3. CPU Usage & Thermals (i7-8750H)

Goal: keep the 6 cores at full turbo (3.9 GHz all-core) without thermal
throttling, on AC power.

### 3.1 Power & scheduler (safe, do first)
- Keep the **High performance** power plan when gaming on AC:
  `powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c`
- Disable PCIe / NVMe link-state power management (removes I/O latency at
  loads): Device Manager → disk/NVMe → Properties → Power Management → uncheck
  "Allow the computer to turn off this device."
- **Never** set CPU max state to 99% as a "fix" unless the user wants lower
  temps at the cost of performance — on this chip that caps turbo and costs FPS.

### 3.2 Undervolting (advanced — optional, high reward)
The 8750H runs hot. Undervolting lowers temps and lets it hold turbo longer.
Use **ThrottleStop** (NOT Intel XTU, which is unreliable on locked ASUS BIOS).
- Start at **-125 mV** on both CPU Core and CPU Cache offsets.
- Test stability with TS Bench (1/2/4 thread) and Cinebench R20/R23. If it
  blue-screens, step back to -100 mV.
- Many chips are stable around -125 to -145 mV; some reach -175/-200 mV on
  core with cache lower. Validate, don't guess.
- Watch **Limit Reasons**: red PL1/PL2 = power-limit throttle; red THERMAL =
  too hot; red VR THERMAL = VRM overheating (cooling/paste issue).
- NOTE: recent ASUS BIOS/microcode updates may **lock voltage control**. If
  FIVR shows +0.0000 offsets that won't apply, undervolting is disabled by
  firmware — skip it, rely on cooling/paste instead.

### 3.3 Physical maintenance (often the real fix)
- These laptops accumulate dust and dry thermal paste after years. If CPU
  peaks >90°C in games, **clean fans + repaste (e.g., Noctua NT-H2)** is the
  most reliable fix. Intel considers <100°C safe; sustained 95°C is acceptable
  but louder/less stable.
- Use a flat, hard surface (or a cooling pad) so the bottom intake isn't
  blocked.

### 3.4 What NOT to do
- Don't disable Windows Security / VBS without weighing the tradeoff (see §6).
- Don't install "game booster" / RAM-cleaner apps — they add overhead.
- Don't push unstable undervolts just to chase numbers.

---

## 4. RAM — Fix Single-Channel (highest-ROI upgrade)

The machine has **one 16 GB SODIMM**. Adding a second DDR4-2667 SODIMM enables
**dual-channel**, roughly doubling memory bandwidth.

- **Buy:** 1× 16 GB DDR4-2667 SODIMM (match SK Hynix spec / CL19 if possible).
  Same size as installed stick → clean dual-channel. (Mismatched sizes still
  run dual-channel up to the matched portion, but identical is best.)
- **Expected gain:** +5–17% average FPS, up to +30–40% on 1% lows in
  bandwidth-sensitive titles (PUBG, Overwatch, Metro, Far Cry, Rise of the
  Tomb Raider). Gains are largest at lower in-game settings where the CPU
  bottleneck dominates.
- Total after upgrade: 32 GB — also eliminates swap thrashing with modern AAA
  + Discord + browser + OBS.

Confirm slot count before purchase: `Get-CimInstance Win32_PhysicalMemory |
Select DeviceLocator, Capacity` and check the mainboard has a free SODIMM slot.

---

## 5. Storage Management

Layout: **C: = OS (118 GB, CRITICALLY LOW)** · E: = 818 GB · L: = 113 GB.

### 5.1 Free up C: immediately (priority)
C: at ~7% free will cause stutter, failed updates, and SSD slowdown.
- Run **Storage Sense** / Disk Cleanup (incl. "Clean up system files" → old
  Windows/Insider residuals, delivery optimization files).
- Move game libraries off C: (Steam/Epic/Ubisoft/Battle.net install folders →
  E:). Games do NOT need to be on C:.
- Move user folders (Downloads, Documents, Videos) to E: via Properties →
  Location tab.
- Uninstall bloat from C:; keep only OS + essential apps on C:.
- Target: **keep C: at ≤80% full (≥20 GB free)** for SSD health.

### 5.2 Games on a secondary drive (E:)
Install/relocate games to **E:**. Benefits: faster OS-drive headroom, easy
reinstall if Windows breaks, no competition with OS I/O during asset streaming.
This machine's C: is small and busy — never install games on C:.

### 5.3 Page file
- Keep the page file **ENABLED** (disabling causes crashes/OOM with 16 GB +
  modern games).
- Set a **fixed size = 1.5× RAM = 24576 MB** (Initial = Maximum) to stop
  resize writes:
  System → About → Advanced system settings → Performance → Advanced → Virtual
  memory → uncheck "Automatically manage" → set Custom size 24576/24576 on C:
  (or move to E: if C: stays tight).
- After the §4 RAM upgrade to 32 GB, a fixed 1.0× (32768 MB) is fine.

### 5.4 SSD health & TRIM
- Verify TRIM: `fsutil behavior query DisableDeleteNotify` → `0` = enabled.
  If `1`, run `fsutil behavior set DisableDeleteNotify 0`.
- Keep Optimize Drives weekly schedule ON (it TRIMs, not defrags, SSDs).
- **Never defragment an SSD.**
- Check S.M.A.R.T. health with **CrystalDiskInfo** every few months
  (target "Good", reallocated sectors = 0, life % healthy).
- Enable write caching: Device Manager → disk → Policies → "Enable write
  caching on the device".

---

## 6. GPU & Gaming Setup (GTX 1060, Windows 11)

Use the **NVIDIA App** (Control Panel is legacy/deprecated as of 2026). Restore
defaults first, then per-game profiles.

### 6.1 Global driver baseline (set once)
- **Power management mode:** Prefer maximum performance (plugged in only;
  stops GPU down-clock stutter).
- **Low Latency Mode:** On (fallback). Use **NVIDIA Reflex On+Boost** in-game
  where available — Reflex beats driver low-latency.
- **Texture filtering – Quality:** High performance (tiny FPS, no visible loss).
- **Threaded optimization:** On.
- **Shader Cache Size:** Unlimited (kills shader-compile stutter; uses disk
  space on C: — keep C: roomy or move cache).
- **Vertical Sync:** Off globally (use G-SYNC/VRR + cap instead).
- **Max Frame Rate:** leave global Off; cap per-game ~117 (just below 120 Hz).

### 6.2 VRR / G-SYNC strategy (120 Hz panel)
1. Enable G-SYNC / Variable Refresh in NVIDIA App (full screen).
2. Set V-Sync **On in driver only**, **Off in-game**.
3. Cap FPS ≈ **117** (3 below refresh) via in-game limiter or Max Frame Rate.
Result: tear-free, low-latency, stable frame pacing.

### 6.3 Windows gaming settings
- **Game Mode:** ON (free, helps frame-time consistency; only disable if a
  specific title stutters or you stream/use a busy second monitor).
- **Hardware-Accelerated GPU Scheduling (HAGS):** ON (1–3 ms latency win,
  required for some features). Benchmark on/off if you see new stutter.
- **VBS / Memory Integrity:** disabling gives 5–10% FPS but **lowers
  security** — only disable for competitive gaming on a trusted machine, and
  re-enable for general use. Verify status: Settings → Privacy & Security →
  Windows Security → Device security → Core isolation.
- **Game DVR / Captures:** turn off if not clipping (Settings → Gaming →
  Captures) to save resources.
- **Fullscreen Exclusive** mode in games beats borderless for lowest latency
  when the title supports it.

### 6.4 Drivers
- Clean-install GPU drivers with **DDU in Safe Mode** when switching major
  versions or after a Windows feature update / mysterious stutter. Download
  driver first, boot Safe Mode (Shift+Restart), DDU → Clean and restart, then
  install with "Perform clean installation".
- Keep GPU driver and Windows fully updated (pending Insider/Windows updates
  often fix scheduler/DX behavior).

### 6.5 Online gaming (network)
- Use **Ethernet (1 Gbps)**, not Wi-Fi, for ranked/competitive.
- Close bandwidth hogs (cloud sync, downloads) during play.
- Optional low-latency tweaks: disable Nagle's algorithm, faster DNS — only if
  the user reports network latency specifically.

---

## 7. Maintenance Schedule

| Cadence | Task |
|---|---|
| Per session (gaming) | Plug in AC, confirm High-perf plan, close background apps. |
| Weekly | Storage Sense cleanup; confirm C: has ≥20 GB free. |
| Monthly | CrystalDiskInfo health check; verify TRIM on; review startup apps (Task Manager → Startup). |
| Per driver/Windows update | Re-run DDU clean install if GPU issues appear. |
| Every 6–12 mo | Physically clean fans / check temps (ThrottleStop Limit Reasons or HWMonitor). |
| On sluggishness | Re-profile with Appendix A; check C: free space and single- vs dual-channel RAM. |

---

## 8. Quick Command Reference (PowerShell, run as needed)

```powershell
# Hardware snapshot
Get-CimInstance Win32_Processor | Select Name, NumberOfCores, NumberOfLogicalProcessors
Get-CimInstance Win32_VideoController | Select Name, DriverVersion, AdapterRAM
Get-CimInstance Win32_PhysicalMemory | Select DeviceLocator, Capacity, Speed
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select DeviceID, @{N='FreeGB';E={[math]::Round($_.FreeSpace/1GB,1)}}, @{N='SizeGB';E={[math]::Round($_.Size/1GB,1)}}

# Power plan -> High performance (AC gaming)
powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c

# Verify TRIM
fsutil behavior query DisableDeleteNotify   # 0 = enabled
```

---

## Appendix A — Re-profile (run when system state is uncertain)

Before any hardware recommendation, execute the PowerShell hardware snapshot
above and compare against §1. Specifically confirm:
1. C: free space (is it still <20 GB?).
2. RAM: still single stick (ChannelA-DIMM0 only) or upgraded to dual-channel?
3. Active power plan (`powercfg /list`).
4. GPU driver version (did Windows update it?).
5. Display refresh (still 120 Hz?).

If any value deviates from §1, update the recommendation accordingly — do not
assume the machine is unchanged.

---

## Appendix B — Upgrade Priority (best ROI first)

1. **Add 16 GB DDR4-2667 SODIMM → dual-channel** (free-ish performance, ~5–17% FPS).
2. **Free C: to ≥20 GB** (stops stutter/instability; move games to E:).
3. **Clean-fan / repaste** if CPU >90°C in games (unlocks sustained turbo).
4. **Undervolt via ThrottleStop** if BIOS allows (lower temps, steadier clocks).
5. **SSD health monitoring** (cheap insurance against C: failure).

Treat the GTX 1060 as the hard FPS ceiling; software tuning buys frame
consistency and latency, not magic FPS. Hardware upgrades (RAM, storage
hygiene, cooling) move the needle more than driver tweaks on this box.
