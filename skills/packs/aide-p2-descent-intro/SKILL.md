---
name: aide-p2-descent-intro
description: SOP for the FSI AIDE "Descent" cinematic onboarding — avatar falls from space, shatters, reassembles into the IDE. Covers the tiered WebGL architecture (Three.js scene / reduced tier / pre-rendered fallback), asset pipeline (Blender→Draco/KTX2), performance budgets proven by the ZERO case study, accessibility/skip laws, the credo copy, and the frame-time verification battery. Use when building or auditing the first-launch experience.
---

# P2b — The Descent (first-run cinematic)

The emotional payload IS the product moment — WebGL earns its cost here (Praxvon
framework: interactive brand piece where interaction = emotional payload).
Non-negotiables: skippable always, `prefers-reduced-motion` bypasses straight to
walkthrough, never-show-again persisted (`aide.onboarding.descent=done`), zero
network during playback.

## Sequence storyboard (operator canon)
1. SPACE: avatar floats among stars over a binary-matrix field (0/1 glyph points,
   green/pink/purple/blue palette). Title: **FSI AIDE**.
2. CREDO card (typewriter reveal over matrix rain) — see Credo below. Banner:
   *developed by neuro_nomad*.
3. GATE: "Are you ready for the descent?" [Begin] [Skip] — Begin only after fonts/
   assets preloaded (honest progress counter, DeepSee pattern).
4. FALL: camera follows avatar through atmosphere (heat-glow shader rim, speed
   lines as particle streaks). ~6-8s.
5. IMPACT + SHATTER: pre-fractured mesh explodes on contact; 200ms color snap-back
   (ZERO timing law); camera dives WITH the shards between cracks underground.
6. REASSEMBLY: shards converge/morph into the cockpit layout silhouette; pull-back
   reveals the real landing page underneath (scene fades as DOM fades in — one
   continuous motion, no pop).
7. Handoff → P2 spotlight walkthrough starts automatically.

## Tech stack (per tier, auto-selected)
| Tier | Trigger | Treatment |
|---|---|---|
| A discrete GPU | `navigator.gpu \|\| high-end dGPU heuristic` | Full Three.js: starfield points, atmosphere shader rim, fracture shards, bloom-lite post |
| B integrated | default | Same scene, no post-processing, half particles, baked shadows |
| C fallback | `prefers-reduced-motion` OR WebGL unavailable OR user skips | Pre-rendered MP4/WebM (rendered ONCE from the same Blender scene) → still ends at walkthrough |

Hard budgets (ZERO-case proven): final assets ≤10 MB total (KTX2/ETC1S textures,
Draco geometry); ≤50k triangles avatar+shards combined; DPR clamped at 2;
lazy-init AFTER app shell paints (never the LCP element); adaptive quality monitor
steps pixel-ratio/effects down when rolling frame-time buffer degrades.

## Asset pipeline
Blender avatar (stylized low-poly robot w/ neon emissive edges matching palette) →
fracture modifier for shard set → export GLTF+Draco → gltf-transform KTX2 encode →
bundle under `assets/descent/`. Matrix field + stars are procedural (no assets).
Video fallback rendered from the same Blender file (Cycles bake → MP4 ~4 MB).

## The Credo (draft v1 — operator approves final wording)
> **We build for the local developer.**
> Your machine. Your models. Your data. Your revenue.
> Sovereign. Private. Nothing leaves without your hand.
> We verify before we claim. We ship what works, offline, out of the box.
> We give tools back to the people who build — and help them own their work.
> *FSI — Ferrell Synthetic Intelligence. First deployment in production.*
> **developed by neuro_nomad**

## Pitfalls (from researched failures)
- Shader precision: force `highp float` (mobile mediump broke ZERO's animations).
- GPU texture uploads block frames: chunk atlas tiles, upload one per frame.
- Escape/listener leaks on overlay teardown (VS Code review findings).
- Never gate the product on the scene: Skip visible from frame one; failure to init
  WebGL must fall through silently, not error.
- Bundle discipline: Three.js loaded dynamic-import after shell paint (~140 KB gz).

## Verification battery (compile ≠ shipped)
`scripts/descent-battery.mjs` (headless):
1. First boot shows descent (state flag absent) → second boot skips it (flag set).
2. Skip button visible within 500ms of scene start; clicking lands on walkthrough.
3. Reduced-motion env → no canvas ever created, straight to walkthrough.
4. Frame-time probe: avg ≥45fps on Tier-A profile (forced via debug override),
   ≥30fps Tier-B, over the full sequence.
5. Asset weight: `assets/descent/` total ≤10MB (CI gate).
6. No network calls during playback (egress audit extension).
7. End-state: walkthrough scenario #1 active after completion OR skip.
