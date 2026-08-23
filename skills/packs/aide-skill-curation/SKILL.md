# S1 — Skill Curation & Discoverability (100+ skills, growing)

Phase skill for AIDE S-series. Master router: aide-master-roadmap. Problem: the skill architecture has 100+ skills and grows weekly; volume without discoverability = dead weight. VS Code BYOK research shows the pattern: capability registries need a management UI, metadata (capabilities, context size), and picker integration — not just files on disk.

## Model

### Skill manifest (frontmatter contract)
Every skill file MUST carry parseable frontmatter:
```yaml
name: aide-build-b2-problem-matchers
tags: [tasks, diagnostics, build]
applies_to:            # drives auto-suggest
  - "packages/**/contracts/*.ts"
  - "**/*.test.ts"
file_types: [ts, mjs]
phase: BUILD-B2
depends_on: [aide-build-b1-task-service]   # declared dependencies
governs: []            # skills this one supersedes/routes to
verified: 2026-08-22   # last verified date
```

### Registry service (daemon-side)
- `node/src/services/skill-registry.mjs`: walks skill roots at boot + on change (watcher), parses frontmatter (no YAML dep — tiny custom parser or add `yaml` with supply-chain note), builds index { name -> manifest }.
- Validates: unknown fields rejected (strict contract), depends_on must exist in registry (else WARN surfaced in UI, not fatal), duplicate names FAIL LOUD.
- Exposes: search by tag/name/file-type; suggest(paths[]) -> ranked skills whose applies_to globs match opened files; context signals: active view (LEARN/MAP/EXP/RUN), open language, git branch name, recent task labels.

### Routes
`GET /api/skills?q&tag`, `GET /api/skills/{name}`, `POST /api/skills/suggest { paths:string[], view?:string }`, `POST /api/skills/validate` (used by CI + editor lint of SKILL.md files).

### UI (frontend)
- Skill palette (Ctrl-K S): fuzzy search over registry.
- Contextual strip: when active file matches applies_to of <=5 skills, show them as chips ("3 skills apply to this file").
- Dependency graph view (MAP tab): nodes=skills, edges=depends_on; cycles flagged red.
- Stale badge: verified older than 90 days -> amber chip prompting re-verification.

### Curation rules (anti-volume-rot)
1. New skill PR without frontmatter = CI fail (validate route in workflow).
2. Router skills (like aide-build-series-roadmap) must list every child; orphan detection in validate.
3. Quarterly cull: skills with zero hits in local usage counter AND stale >180d get archived to /archive (kept, not deleted — history matters).
4. Local usage counters only (which skills loaded this session) — never leave the machine.

## Tests FIRST

1. Parse all real skills in repo -> zero validation errors (catches drift immediately).
2. Missing depends_on -> warning entry listed.
3. suggest() ranking: fixture workspace, open contracts/tasks.ts -> b2/b1 skills rank top-3.
4. Duplicate name -> registry refuses to start (fail loud).
5. Arch tests for routes; openapi zero-diff after regen.

## Gate

Unit+arch green; CI runs validate across ALL skills (this repo's .agents tree too); journal. This phase makes the governance layer USABLE — pair with V1 before publicizing.
