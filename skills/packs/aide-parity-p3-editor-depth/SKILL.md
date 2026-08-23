# AIDE P3 - Editor Depth Pack (Monaco wiring)

Research basis (VERIFIED 2026-08-22, Monaco typedoc): IStandaloneEditorConstructionOptions includes bracketPairColorization{enabled}, folding:boolean, minimap{enabled}, multiCursorModifier:'ctrlKey'|'altKey'|'metaKey', stickyScroll{enabled}. Multi-cursor, folding UI, snippets and find widget are BUILT INTO Monaco - our job is configuration plumbing, not reimplementation.

## What
1. SettingsService gains defaults: aide.editor.minimap(true), aide.editor.stickyScroll(true), aide.editor.folding(true), aide.editor.bracketColorization(true), aide.editor.multiCursorModifier('ctrlKey'). Existing fontSize/tabSize/wordWrap stay.
2. common/contracts/editor.ts: EditorOptionsResponse {fontSize(8..48), tabSize(1..8), wordWrap, minimap_enabled, stickyScroll_enabled, folding_enabled, bracketPairColorization_enabled, multiCursorModifier enum} - all STRICT, server-clamped.
3. Route GET /api/editor/options: reads merged settings, CLAMPS numerics, coerces booleans (accept true/'true'), validates modifier against whitelist falling back to 'ctrlKey'. Single source of truth = settings service; no browser-side duplication of clamp logic (train-serve consistency applied to config).
4. Browser later maps response 1:1 onto monaco.editor.create/updateOptions - documented in skill for the frontend-wiring phase.

## Why this way
- A normalized endpoint (not raw settings dump) means the palette/settings UI can never put the editor into an invalid state (fontSize 5000, modifier 'win') - validation lives where the authority is.
- Server-side clamping is unit/arch-testable without a DOM, keeping the verification battery headless (repo constraint: CI has no browser).

## Threat matrix
| Threat | Radius | Mitigation |
|---|---|---|
| Malicious settings values breaking renderer layout | MEDIUM | strict clamp+whitelist at endpoint edge; unknown keys ignored |
| Drift between endpoint shape and Monaco option names | MED bugs | endpoint field names mirror Monaco 1:1 (suffix _enabled only for nested {enabled}); mapping table lives in ONE place |
| Settings write races (two windows) | LOW | atomic tmp+rename writes already; last-write-wins acceptable v1 |

## Dependencies
Upstream: P1 settings service/routes. Blocks: frontend editor wiring phase; P8 theming extends this endpoint.

## Known pitfalls
- Monaco expects camelCase nested objects ({minimap:{enabled:true}}) - endpoint flattens with _enabled suffix; mapping is trivial but must stay in sync with the pinned Monaco version (check package.json before changing shape).
- multiCursorModifier on Windows users expect ctrlAlt default like VS Code ('ctrlKey') - do not copy VS Code's mac default.

## Gates
1. Unit: clamp boundaries (7->8? no: below-min stays min... assert exact), boolean coercion from strings, invalid modifier fallback.
2. Arch: GET envelope shape; PUT fontSize=99 then GET shows clamped value.
3. Manual: toggle each setting via PUT and observe editor behavior after frontend wiring lands.
