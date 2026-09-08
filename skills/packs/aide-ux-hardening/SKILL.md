# Skill: aide-ux-hardening

# UX Hardening — Competitive Feature Gaps and Polish

Research-based UX improvements based on competitive analysis (Cursor, Windsurf,
VS Code, Claude Code, Aider, Cline, Augment). Focus on what matters for an
offline-first sovereign IDE.

## Competitive Analysis Summary (2026)

| Feature | Cursor | Windsurf | VS Code | AIDE |
|---------|--------|----------|---------|------|
| Tab autocomplete | Yes | Yes | Yes | NO |
| Background agents | Yes | No | No | NO |
| Browser preview | No | Yes | No | NO |
| Desktop control | No | No | No | YES (unique) |
| Offline-first | No | No | No | YES (unique) |
| Local models | No | No | No | YES (unique) |
| Extension system | Yes | Yes | Yes | PLANNED |

## Priority UX Gaps to Address

### 1. Tab Autocomplete (HIGH)
- Inline code suggestions as you type
- Requires: model inference on partial code, debounce, ghost text rendering
- Monaco editor has built-in suggest API
- Wire: `monaco.languages.registerCompletionItemProvider`

### 2. Command Palette Improvements (MEDIUM)
- Current: basic Ctrl+K fuzzy search
- Add: recent commands, keyboard shortcuts display, command descriptions
- VS Code pattern: `workbench.action.quickOpen`

### 3. Status Bar Enhancements (MEDIUM)
- Current: single strip with status text
- Add: language mode, line/column, encoding, EOL sequence
- Monaco editor provides these via `editor.getPosition()`

### 4. Keyboard Shortcut Reference (LOW)
- Document all shortcuts in help panel
- Add shortcut hints to button tooltips
- Ctrl+K/Ctrl+Shift+F/Ctrl+` already wired

### 5. File Tree Improvements (MEDIUM)
- Current: basic file list
- Add: nested folders, file icons, context menu, drag-and-drop
- Wire: `monaco.editor.createModel` for each file type

### 6. Notification System (LOW)
- Toast notifications for background operations
- Download progress, build status, error alerts
- Non-blocking, auto-dismiss

## Implementation Order

1. Tab autocomplete (highest user impact)
2. File tree with nested folders
3. Status bar language/position
4. Command palette recent commands
5. Toast notifications
6. Keyboard shortcut reference

## Verification

Each UX improvement gets a battery:
- `scripts/ux-battery.mjs` — probes for each feature
- Test: feature exists, feature works, feature doesn't break existing

## Rules

- NEVER add a feature without a battery
- NEVER change existing behavior without verifying it still works
- ALWAYS test keyboard navigation (Tab, Enter, Escape)
- ALWAYS test with screen reader (ARIA attributes)
- ALWAYS test responsive (mobile breakpoints)
