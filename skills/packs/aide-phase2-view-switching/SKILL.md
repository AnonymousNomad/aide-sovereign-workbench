---
name: aide-phase2-view-switching
description: Phase 2 SOP for the AIDE offline IDE — make LEARN / MAP / EXP / RUN view switching clean: overlays on the editor column, no page scroll, no layout breakage. Use whenever changing views, fixing scrolling/resizing, or styling #learn-view / #blueprint-view overlays.
---

# Phase 2 — View Switching SOP

Goal: LEARN, MAP, EXP, RUN buttons swap views cleanly; activity bar and sidebars stay visible; no page-level scrolling.

## Research base (verified)

- Theia/VS Code layout model: the app shell is a fixed viewport (100vw × 100vh) with explicit regions; the active panel scrolls, never the root. Editors are tab-switched content, not stacked pages.
- Scroll containment: a scrollable region needs `overflow-y: auto` and an explicit `max-height` (or `flex: 1 1 auto; min-height: 0` inside a flex column). `overflow: hidden` on root only.
- Overlay panels: `position: absolute` inside the editor column is the correct mechanism for a full-column overlay (this is how Modals/quick-open work in VS Code).

## Layout contract (CSS, Desktop/frontend/styles.css)

1. `html, body, #app`: `height:100vh; width:100vw; overflow:hidden; margin:0` — root NEVER scrolls.
2. App shell: flex column; sidebar `position:fixed; left:0; top:0; width:240px; height:100vh; overflow-y:auto`; main `margin-left:240px; height:100vh; display:flex; flex-direction:column`.
3. `#content`: `flex:1; overflow-y:auto; min-height:0`.
4. `.blueprint-stage` and all model-output panels: `flex:1 1 auto; min-height:0; overflow-y:auto` — they fill their parent and scroll internally.
5. `#learn-view`, `#blueprint-view`: `position:absolute; inset:0; overflow-y:auto` overlay on the editor column (contained overlays only — the one allowed absolute case).
6. `box-sizing:border-box` everywhere.
7. No `position:absolute` inside scrollable areas except contained modals; no `overflow:hidden` on intermediate wrappers.

## JS contract (Desktop/frontend/app.js)

- View switch: hide editor chrome (tabs, breadcrumbs, editor, terminal, statusbar) when showing #learn-view/#blueprint-view; show them again on EXP; RUN focuses/expands the bottom terminal panel.
- ResizeObserver on the main workspace recalibrates panel heights; `window.addEventListener('resize', layoutReflow)`.
- Every switch logs `VIEW: <name>` to console (acceptance requirement).

## Acceptance gates

- DevTools: computed `#content` height = viewport minus topbar; `.blueprint-stage` has `overflow-y:auto` and shows scrollbars when content overflows.
- Click LEARN → editor chrome hidden, #learn-view fills column; MAP → blueprint fills; EXP → editor chrome back; RUN → terminal panel focused/expanded. Activity bar + sidebars visible throughout.
- html/body computed height equals viewport; no root scrollbar ever.