---
name: aide-responsive-a11y
description: D1 responsive + accessibility foundation for the AIDE cockpit — breakpoint ladder (1440/1200/1000/820/640), rail collapse behavior, complete aria-labels, Esc-focus-return law for overlays, aria-live status strip, contrast spot-checks. Use when touching cockpit layout/CSS, adding any control, or auditing keyboard/screen-reader behavior. Research base: JetBrains a11y 2026, W3C ARIA APG keyboard interface, WebAIM, Vercel web-interface-guidelines.
---

# Responsive + A11y Foundation — Everybody's Workflow Means Everybody

## Breakpoint ladder (cockpit grid)

- ≥1440: full three zones (orchestrator 340 / workbench flex / rail 280).
- 1200–1439: orchestrator 300, rail 240.
- 1000–1199: rail collapses to icon strip (badges become dots w/ title tooltips; click expands overlay).
- 820–999: orchestrator stacks ABOVE workbench (describe box always visible per flow law); tree hidden behind FILES toggle button in workbench bar.
- <820: single column, topbar buttons collapse into a MENU (HELP/SKILLS/PLUGINS/MODELS/SHIP as list); terminal drawer full-width.

Implementation: CSS grid template changes only — no JS layout measurement
(Vercel guideline: let the browser size things). Test at 50% zoom for
ultra-wide simulation and 320px width for minimum.

## Keyboard & focus laws (W3C APG)

1. Every overlay: opening moves focus to its first input; **Esc closes AND
   returns focus to the element that opened it** (store document.activeElement
   on open). Applies to: help, models, skills, plugins, search, palette,
   git sheet, ship panel, rename card.
2. Focus indicators: never outline:none; prefer :focus-visible defaults plus
   high-contrast ring on dark theme (.cmdk-item.active etc. count).
3. Tab order follows DOM order (source order = visual order in cockpit).
4. All interactive elements reachable by Tab alone OR documented shortcut;
   shortcuts must not be the ONLY path to a feature (palette duplicates them).

## Labels & live regions

- Every icon-only or abbreviated control gets aria-label (STOP ENGINE, badges,
  tree files get role=treeitem semantics when tree gains keyboard nav).
- Status strip (#strip-text) becomes `role=status` `aria-live=polite` so state
  changes are announced without focus movement.
- Badges announce via title + visible text (no color-only meaning; pair with
  text labels already present).

## Contrast

Dark theme muted #718994 on #0b151e passes for large text only — body-critical
text uses #b8c9cf+. Spot-check badges/muted pairs with APCA at D1; adjust
--muted usage where it carries information.

## Pitfalls

- aria-live on rapidly-updating elements announces every token — put it on the
  STRIP (state changes), never on chat stream.
- Esc-handlers currently attached ad hoc — centralize via openOverlay(el,
  openerEl) helper to guarantee focus return.
- Positive tabindex forbidden; use DOM order.
- Do not remove browser focus outlines to "clean up" visuals.

## Gates

1. axe-core scan (or manual WebAIM checklist) zero critical violations.
2. Keyboard-only walkthrough: start engine -> describe -> approve -> save ->
   ship, hands off mouse, recorded in docs/evidence/.
3. Breakpoint screenshots at 1920/1366/1024/768 widths in docs/evidence/.
4. Screen-reader smoke (NVDA): status strip changes announced; overlays named.
