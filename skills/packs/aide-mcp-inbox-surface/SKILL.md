---
name: aide-mcp-inbox-surface
description: Build AIDE's in-box MCP (Model Context Protocol) server — a stdio-transport server exposing the daemon's existing capabilities (workspace files, git, codebase index search, desktop control with grants, tasks) as MCP tools, reusing the repo's path jails and approval gates, packaged later as an .mcpb bundle. Makes AIDE's tools callable from ANY MCP client (Cursor, Claude, VS Code) and makes approved MCP servers callable inside AIDE. Operator constraint is all-local: no cloud, works offline. Use when building the MCP surface, adding MCP tools, packaging .mcpb, wiring external MCP servers into AIDE chat, or reviewing MCP security.
---

# MCP In-Box Surface — AIDE's Tools, Every Client; Every Server, AIDE

Born 2026-08-27 gap analysis: `rg -il 'model context protocol|mcp'
node/src daemon` = ZERO hits. The research is DONE and journaled
(2026-08-26 00:50): stdio transport is the sanctioned local pattern (process
spawned on user machine, no listener, offline-correct); MCPB (.mcpb) is the
sanctioned bundle; NO manifest-level sandboxing exists — handlers must do
their own jails. Nothing was built. Meanwhile VS Code 2026 treats MCP as core
extensibility and Cursor ships an MCP marketplace. The tools to expose already
exist in AIDE — this is an adapter layer, not a product build.

## Research base (verified 2026-08-26/27, journaled)

1. modelcontextprotocol architecture docs: MCP = JSON-RPC over stdio (local) or
   HTTP (remote); server exposes tools/resources/prompts; client = the AI app.
2. MCPB packaging: zip + manifest, single-click install, Node runtime
   recommended; runs with FULL USER PRIVILEGES — platform sandboxing is the
   server author's job (matches this repo's jail doctrine).
3. Official anti-pattern: cloud-API servers dressed as local bundles gain
   nothing and leak data — operator constraint here is all-local.
4. In-repo capabilities already jail'd and tested: sandbox.mjs
   (materializeScratch/applyToScratch, resolveInside), agent-tools gates,
   git routes (push requires explicit approval + egress audit log), desktop
   control (grants + panic), index service (hybridSearch).

## What to do (direct)

1. SERVER FIRST (expose AIDE outward): new top-level `mcp/server.mjs`, stdio
   transport, zero new deps (JSON-RPC lines on stdin/stdout). Tools:
   - `workspace_search` → index-service hybridSearch (read-only)
   - `workspace_read_file` → path-jailed read (resolveInside, deny-list)
   - `workspace_apply_patch` → the SAME SEARCH/REPLACE grammar as sandbox.mjs
     (single-implementation law) into scratch, apply after approval
   - `git_status` / `git_diff` (read-only; `git_push` requires the same
     explicit `approved: true` + egress audit as the daemon route)
   - `desktop_act` → passthrough to createDesktopControl act() with grants +
     panic intact (NO new privileges)
2. CLIENT SECOND (consume servers inside AIDE): an `mcp/registry.json` of
   allowed servers spawned as child processes; tools surface into the agent
   tool list with a `mcp:<server>:<tool>` prefix; EVERY call requires the same
   approval gate class as built-in dangerous ops unless allowlisted read-only.
3. TOOL POISONING DEFENSE: server tool descriptions are DATA, never
   instructions — render them in the harness as quoted capability text, never
   into the system scaffold.
4. PACKAGING: once stable, zip server + node runtime as .mcpb (single-click
   install path); keep the all-local constraint — no telemetry, no cloud.

## Why it's done this way

- stdio-only is the operator's law (all-local, offline) AND the safest
  transport: no listener, no ports, child dies with the client.
- Adapter-not-product: every tool already exists behind jails and gates tested
  by batteries. The MCP layer translates protocol to those calls — new logic
  lives ONLY in the translation.
- Expose-then-consume: shipping AIDE's tools outward first proves the server
  with zero UI work (any MCP client tests it), before adding client-side
  tool surfacing inside AIDE chat.

## Dependencies / issues / bugs

- Depends on: sandbox.mjs grammar + jails, agent-tools approval gates, git
  routes with egress audit, desktop control grants/panic, index service.
- JSON-RPC over stdio on Windows: messages can exceed pipe buffer defaults —
  parse incrementally; NEVER assume one write = one message.
- The corpus era proved external processes get killed by machine-wide /IM
  sweeps — an MCP client kill must NOT take the daemon down (it can't: separate
  processes; keep it that way — no in-process hosting).
- Node version drift: bundle the runtime in .mcpb; don't assume the host has
  E:\nodejs.

## Threat matrix

| Threat | Signature | Defense |
|---|---|---|
| Malicious MCP server tool poisoning | tool description contains instruction payloads | descriptions rendered as quoted DATA; harness law: never into system scaffold |
| Confused-deputy file access | client asks server to read outside workspace | resolveInside jail on EVERY path; deny-list re-checked per call |
| Silent exfiltration via push | mcp git_push without operator intent | same explicit approved:true + egress audit log as daemon route; no defaults |
| Privilege escalation via desktop_act | server calls desktop act beyond grants | passthrough ONLY; grants + panic are non-negotiable in createDesktopControl |
| Runaway stdio process | client dies, server orphaned holding ports | server has no ports (stdio); exit when stdin closes (parent-death watchdog) |
| Bundle supply-chain swap | .mcpb swapped for trojan | hash-pin bundles; operator-installed only; no auto-update |
| Cloud drift | a fork adds cloud APIs | all-local law in review checklist; egress audit diff in CI |

## Pitfalls

- Do NOT host the MCP server in-process with the daemon — a client crash or
  hostile payload must not share an address space with AIDE.
- Do NOT expose raw shell/exec as a tool — compose existing jailed ops only.
- Do NOT skip the approval gate for "convenience" — the gates ARE the product.
- Do NOT trust tool names from the registry file — validate shape at spawn.
- Windows console encoding: emit UTF-8 explicitly; BOM breaks JSON-RPC parsing.
