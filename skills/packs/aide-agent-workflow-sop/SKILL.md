# Agent Workflow SOP — Census, Research, Install, Verify (2026-08)

How to run a "improve your own tooling" session without wasting cycles: census what is actually installed, research current best practice, install/upgrade deliberately, verify everything with runnable evidence, then commit. Every step has a verification gate — nothing is "done" until the gate passes.

## The Loop (5 gates)

1. **CENSUS** — never research what you already have. Run the census commands below first.
2. **RESEARCH** — fetch official docs (code.visualstudio.com, modelcontextprotocol.io, github.com/modelcontextprotocol/*). Confirm versions/commands still current; npm registry pages return HTTP 403 to scrapers — use GitHub READMEs instead.
3. **INSTALL** — deliberate, minimal, config-as-code. Prefer editing `mcp.json`/`settings.json` over interactive installers.
4. **VERIFY** — every install gets a smoke test that prints observable output. A tool that isn't smoke-tested is not installed.
5. **WIRE + COMMIT** — connect to the project, run tsc + tests, commit with evidence in the message.

## Environment Census (2026-08-29 snapshot, this machine)

- **MCP servers configured** in `C:\Users\Grey_\<user>\AppData\Roaming\Code\User\mcp.json` (6): `markitdown` (uvx), `github` (http, api.githubcopilot.com), `winapp` (VS Code extension exe — desktop control), `memory` (npx `@modelcontextprotocol/server-memory`, MEMORY_FILE_PATH=E:\aide-sovereign-workbench\.aide\mcp-memory.jsonl), `filesystem` (npx `@modelcontextprotocol/server-filesystem`, jailed to E:\aide-sovereign-workbench), `git` (uvx `mcp-server-git --repository E:\aide-sovereign-workbench`).
- **VS Code extensions** (24): gitlens, docker/containers, python stack, jupyter stack, powershell, yaml/toml, errorlens, blackbox, fitten-code, remote-ssh/containers. No MCP-related extensions needed — VS Code 2026 handles MCP natively.
- **Runtimes**: node v26.4.0, npm 11.17.0, git 2.54.0.windows.1, uvx at `C:\Users\<user>\.local\bin\uvx.exe` (also hermes copy).
- **AIDE skills registry**: `skills/registry.json`, 185 entries; categories include aide-ops, aide-core. MCP-related skills: aide-mcp-inbox-surface, aide-mcp-server-recommendations, aide-plugin-author-guide, aide-plugins-surface-v1, and this skill.

## Census commands (verified working on this shell)

```
type %APPDATA%\Code\User\mcp.json
code --list-extensions
node --version & npm --version & git --version
where uvx
findstr /n "name" skills\registry.json   (in repo)
```

## 2026 VS Code MCP facts (researched 2026-08-29)

- Config lives in **user** `%APPDATA%\Code\User\mcp.json` (this machine uses `servers` key + `inputs` for prompts) or **workspace** `.vscode/mcp.json` for shareable config.
- **Agent plugins** are first-class: a plugin can bundle MCP servers; discover via Extensions view "MCP SERVERS - INSTALLED" section or `MCP: List Servers`.
- Servers must be **trusted** on first start (trust dialog; `MCP: Reset Trust` to clear). Disable/enable per workspace without editing the file.
- `chat.mcp.autostart` (experimental) restarts servers on config change. Without it, restart servers after editing mcp.json.
- Startup errors surface in the Chat view error indicator → "Show Output" → MCP output log.
- Windows: npx-based stdio servers must be wrapped as `{"command": "cmd", "args": ["/c", "npx", "-y", "<pkg>"]}`.
- Official **MCP Registry** (github.com/modelcontextprotocol/registry, 7.2k stars) is the discovery app-store; API v0.1 freeze since 2025-10; server entries are namespaced (`io.github.<user>/<name>`) `server.json` with version + transport metadata.

## Memory vs MCP memory (do not conflate)

- `@modelcontextprotocol/server-memory` = knowledge-graph facts about the operator/project (entities, relations, observations). Complement.
- `node/src/services/memory-recall.mjs` = per-session BM25 timeline recall wired into chat (Gap #4, commit a611795). Both write JSONL under `.aide/`. Neither replaces the other.

## Pitfalls (all verified this session)

1. **PowerShell mangles complex quoted commands** through the Cline cmd wrapper — no `node -e "..."`, no here-strings with `>` inside. Write a `.mjs`/`.cmd` script file, then run it.
2. **Cline cache can delete or serve stale reads of files written between tool calls** — write file and consume it in the SAME run_commands block, or re-read after a ping wait; `type` may show pre-edit content.
3. **tsc takes ~40s** — the tool timeout is 30s. Background it: `start /b cmd /c "node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json > <literal-temp-path> 2>&1"`, then `type` the output file after a wait. `%TEMP%` does NOT expand inside these quoted cmd strings — use the literal path.
4. **Module-level `let x: T | null = null` loses null-narrowing after awaits** in TS — narrow into a `const local = x as T` right after assignment before calling methods.
5. **editor insert_line is a blind insert** — verify it didn't duplicate an adjacent signature (tsc TS1005 catches it).
6. **Pushes can silently no-op on rule-bypassed branches** — always verify with `git rev-parse origin/main` vs HEAD after push; the remote prints "Bypassed rule violations" warnings but succeeds.

## Skill-gap doctrine

When a session reveals a repeatable procedure, it becomes a skill (this file). When research surfaces ecosystem shifts (e.g. plugins bundling MCP servers, registry API freeze), fold them into the existing skill rather than spawning duplicates. Registry entry + SKILL.md + verified evidence = complete skill.
