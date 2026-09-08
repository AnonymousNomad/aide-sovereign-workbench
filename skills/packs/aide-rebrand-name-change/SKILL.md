---
name: aide-rebrand-name-change
description: Rename a product across the repository while preserving every verified gate. Use whenever the operator changes the public name of the product, the package display name, the Tauri productName/title, the Cargo package name, the doc headers, or any combination. Apply the staged SOP in order; never rename the directory or the GitHub repo without a separate plan; never weaken or hide tests to make the new name pass.
---

# Product Name Change

## When to use

Trigger whenever the operator changes the product name on a stable branch and wants the repo to tell one consistent story. The name appears in (at least) the following surfaces, and missing any one is a contract drift:

- `package.json` (`name`, `description`, `version`)
- `desktop/Cargo.toml` (`[package] name`, `description`)
- `desktop/tauri.conf.json` (`productName`, `identifier` reverse-DNS, `app.windows[].title`)
- `desktop/README.md` (heading, sentence)
- `.github/workflows/*.yml` workflow names and any `name:` lines that mention the product
- Comments in the active branch that mention the old name (search and treat as a deliberate update, not a mass rename)
- Issue / PR templates (rename file if named after the old product)
- `docs/` and `docs/evidence/` filenames that begin with the product name only if the doc is named after the product and not after the content

Never rename:

- The on-disk directory name (e.g. `E:\aide-sovereign-workbench`) without a separate `git mv` + push + remote tracking update plan.
- The GitHub repository `org/repo` slug without a separate `gh repo rename` plan; do that on a different step and never assume `git remote set-url` is enough.

## Procedure

1. **Read the SOPs** — load `aide-release-engineering`, `aide-packaging-offline`, `github-repo-professional-setup`, `process-hygiene-sop`, and `hard-rules` before any rename. If a relevant surface is governed by a different skill (e.g. `aide-arch-foundations` for `browser/`, `aide-arch-model-runtime` for the model manifest), load it too.
2. **Audit before edit** — produce a one-table plan listing file, current name string, intended new name string, test/gate that exercises it, and the order of edits. Save the plan in AGENT_NOTES as a TODO entry; reference it from the commit body.
3. **Gate the change** — do not start typing renames until the existing local Veritas gate is green on the current branch (the verified `808cadf` line and the parked `model-integrity` line are both green in this worktree; do not regress them).
4. **Micro-changes in order** — make the smallest possible edits one file at a time, in the order: `package.json` → `desktop/Cargo.toml` → `desktop/tauri.conf.json` → `desktop/README.md` → workflow files. Update the description string and the identifier reverse-DNS as well, not only the display name.
5. **Verify per file** — after each file edit, run the cheapest gate that touches it:
   - `desktop/Cargo.toml` / `desktop/tauri.conf.json` → `npm run desktop:verify` (cannot run the Tauri build locally; the gate proves resources are complete and the staged stack still routes).
   - `package.json` → `node --check scripts/ci-run-all.mjs` (or just `npm run check`).
   - README/strings → `node scripts/ui-audit.mjs` (does not parse the README; manual grep for the old name is acceptable here, but do not skip the next Veritas run).
6. **Tests** — search for the old name in the repo and update tests that pin it. Re-run the focused test, then the full Veritas gate.
7. **Do not invent** — never add a new claim (badge, sponsor line, version, install count) during a rename. The rename is a contract update only.
8. **Commit** — one file family per commit so a rollback is small. The commit message must include the previous name and the new name, e.g. `chore(rebrand): rename AIDE Sovereign Workbench to Covert`. The pre-commit secret scan still runs.
9. **Push** — push only after the local Veritas gate is green. Watch the new GitHub run to the same green conclusion before claiming CI is healthy.
10. **Journal** — append an AGENT_NOTES entry per file family with: timestamp, actor, type, summary, files, and what was verified. Update the governing skills (`aide-packaging-offline`, `aide-production-cutover`, etc.) with the new name in the same change that flips the name in the code, so a future reload never re-teaches the old name.

## Anti-patterns

- Renaming the directory or the GitHub repo slug in the same change as the user-facing rename — that belongs to a separate plan and a separate commit.
- Skipping the local Veritas gate to push faster.
- Using a `find … -exec sed -i` sweep that touches the AGENT_NOTES, `T1-T2_notes.md`, evidence files, and dependency manifests in the same blast — these have audit/trace value and must be updated deliberately, not by mass replace.
- Removing a test that mentions the old name instead of updating it.
- Treating the rename as a license change, ownership change, or release cut.

## Pitfalls

- `package.json` `name` is the npm package name; it accepts lowercase letters, digits, hyphens, and dots only. The reverse-DNS in `desktop/tauri.conf.json#identifier` is a different string and must still be a valid package identifier.
- Tauri `productName` accepts spaces, hyphens, and letters; avoid only-emoji strings; never reuse a known public product name verbatim if it is reserved by another project.
- The Cargo `[package] name` accepts lowercase letters, digits, hyphens, and underscores; it cannot contain spaces.
- The Tauri `identifier` must stay reverse-DNS; changing it is a separate "bundle identity" decision and breaks OS-level install/update tracking — only change it on operator request.
- LLMS.txt, badges, and the funding sentence are not in this skill's scope; they belong to `github-repo-professional-setup` and follow the rename, not lead it.

## Verified machine facts (2026-09-04)

- Branch: `t1/strict-pass-batch` at commit `808cadf`; clean working tree except for the parked `model-integrity` experiment and the documented `cargo.toml` / docs that are not yet renamed.
- Last local full Veritas: `passed:true`, score `1`, `355/355` arch tests, all gates true.
- Live processes at the time of writing: zero model servers, zero AIDE daemons, zero Python model workers, zero GitHub CLI invocations.

## What the operator asked

The operator named the project "Covert" and authorized me to update every file and push, keeping the GitHub repo green. I am interpreting that as: "rename all user-facing surfaces in this worktree to Covert, do not rename the directory or the GitHub slug, do not touch T1/T2 in-flight work, do not regress the existing local Veritas, and push only after a green run."

## Sources

- Tauri v2 product configuration: https://v2.tauri.app/reference/config/
- Tauri v2 bundle resources: https://v2.tauri.app/develop/resources/
- npm `package.json` `name` field: https://docs.npmjs.com/cli/v10/configuring-npm/package-json#name
- Cargo package manifest: https://doc.rust-lang.org/cargo/reference/manifest.html
- GitHub repo metadata: https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository
- AIDE `aide-packaging-offline` skill, `aide-production-cutover` skill, `github-repo-professional-setup` skill (all at `C:\Users\Grey_\.agents\skills\`).
