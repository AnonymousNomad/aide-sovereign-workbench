# AIDE skill catalog audit — 2026-09-06

## Scope

Read-only audit of the project-local skill roots and the legacy registry used by
the chassis orchestrator. No skill body was rewritten and no runtime/model
process was started.

## Observed counts

| Surface | Count | Meaning |
|---|---:|---|
| Discoverable skill directories | 266 | `SKILL.md` directories found across project, packs, and configured user roots |
| Valid chassis v1 envelopes | 7 | Fully parseable by `harness/skill-schema.mjs` |
| Non-v1/legacy files | 259 | Retained as source material; not batch-migrated |
| Legacy registry entries | 188 | `skills/registry.json` entries |
| Orchestrator catalog after shim fix | 195 | 7 v1 skills + 188 lazy legacy shims |

The valid v1 set is the seven chassis seed skills. Legacy files primarily lack
the v1 frontmatter/envelope (`version`, `category`, `applies_to`,
`tools_required`, and `sop`) or use the older description-only format.

## Wiring result

`harness/orchestrator.mjs` now accepts either `legacy.name` or `legacy.id` when
building a shim. The registry uses `name`, so the old `id`-only lookup silently
dropped all 188 entries. A shim preserves the legacy description, marks the
entry as legacy, assigns version `0.0.0-legacy`, and keeps the existing
operator-visible routing path.

## Verification

`node --test tests/in-house-e2e/chassis-orchestrator-battery.mjs`

Result: **8 passed, 0 failed**, including the regression test proving
`aide-arch-extensions` is present and routable as a legacy shim.

## Promotion policy

Do not batch-convert the 259 non-v1 files. Promote a legacy skill only when it
is used, with operator-approved scope, primary-source citations, failure modes,
and numerical success criteria per the skill-writer gate. This keeps the
catalog available today while preventing unreviewed instruction drift.
