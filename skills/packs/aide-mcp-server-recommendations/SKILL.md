# aide-mcp-server-recommendations

MCP (Model Context Protocol) servers that would improve AIDE's
harness / orchestrator workflow when added to the Cline or Claude
Code runtime. Research base: modelcontextprotocol.io, github
modelcontextprotocol/servers (89.9k stars), mcp.so marketplace, August
2026.

## When to load this skill

Load when:
- You want to add a real external capability to the Cline runtime
- You are considering server-side or shared-memory infrastructure
- An AIDE agent feature would benefit from a reusable, off-the-shelf
  MCP server instead of a custom one

## What is MCP, in one paragraph

MCP is "USB-C for AI applications" (modelcontextprotocol.io, 2026).
A standard JSON-RPC protocol. A *client* (Cline, Claude Code, your
runtime) talks to a *server* (a process you start with `npx` or
`uvx`). The server exposes tools, resources, and prompts. The
official reference implementations live at
github.com/modelcontextprotocol/servers.

## Configuration on Windows

For Cline / VS Code / Claude Desktop, MCP config lives in:
- User-level: `C:\Users\<you>\AppData\Roaming\Code\User\mcp.json`
  (open via Command Palette > "MCP: Open User Configuration")
- Workspace-level: `<repo>\.vscode\mcp.json`

The Windows quirk: wrap `npx` with `cmd /c`:

```json
{

## Servers ranked by leverage for the AIDE workflow

### Tier 1 — ship these first (zero new code in AIDE, biggest UX win)

| Server | Package | What it gives AIDE | Why it matters |
| --- | --- | --- | --- |
| **Memory** | `npx -y @modelcontextprotocol/server-memory` | Knowledge-graph persistent memory (entities + relations + observations). JSONL storage at `MEMORY_FILE_PATH`. | Solves the "every session starts cold" problem. Different from `node/src/services/memory-recall.mjs`: KG is for *facts about the operator* (Nomad has a tablet, prefers BM25 over embeddings, etc.); recall.mjs is for *what we worked on*. Both together = the operator's brain. |
| **Filesystem** | `npx -y @modelcontextprotocol/server-filesystem <path>` | Read/write/search files inside an allowed root. | Gives the Cline runtime a sandboxed file surface. AIDE already has desktop-control for the operator; this is for *Cline itself* to read workspace files cleanly. |
| **Git** | `uvx mcp-server-git --repository <path>` | read_blob, search_code, list_commits, show_commit, log, status, diff, add, commit, create_branch, checkout, etc. | Replaces ad-hoc git commands in the agent loop. Hook into the workflow: after every successful chat turn, the agent decides whether to commit. |

### Tier 2 — high value, decide based on your stack

| Server | Package | What it gives AIDE |
| --- | --- | --- |
| **Fetch** | `npx -y @modelcontextprotocol/server-fetch` | Web content fetching + conversion to LLM-friendly markdown. |
| **Sequential Thinking** | `npx -y @modelcontextprotocol/server-sequential-thinking` | Dynamic problem-solving via thought sequences. Use to add explicit chain-of-thought to chat before the actual answer. |
| **Time** | `npx -y @modelcontextprotocol/server-time` | Timezone conversion. Small, but useful when logs span timezones. |
| **Everything** | `npx -y @modelcontextprotocol/server-everything` | Reference / test server. Useful for E2E tests of MCP plumbing. |

### Tier 3 — only if AIDE grows a real product surface


## Threat matrix

| Threat | Signature | Defense |
| --- | --- | --- |
| Server `command` injection | The `args` array in the config is parsed as a shell command on Windows | Quote every arg. Prefer `args` over `command` strings. Don't put tokens in `command`. |
| Filesystem server escapes allowed root | Cline calls fs.read with a path outside the root | Configure the `args` with the workspace path; the server enforces root jail by default. |
| Memory server stores secrets | Entities with passwords, tokens, etc. | Don't put secrets in observations. Use the `MEMORY_FILE_PATH` env to a path the operator can audit. |
| Git server makes commits without approval | The agent calls `git_commit` and pushes | The server doesn't have a built-in approval gate. Wrap the `git_commit` tool in an AIDE hook (Gap #6) that requires `approved: true`. |
| Bot traffic on `npx -y` first run | The first `npx -y @modelcontextprotocol/server-X` downloads ~50-200MB and is slow | Pin a version: `npx -y @modelcontextprotocol/server-memory@2026.7.1` |
| Server crashes silently | Cline shows "tool unavailable" but doesn't tell you why | The MCP spec requires servers to log to stderr; capture `args: ["2>", "logs/mcp-memory.err.log"]` style on Windows. |

## Pitfalls

1. **Don't try to "wrap" AIDE's existing services as MCP servers.** AIDE
   already has desktop-control, agent-tools, telegram-bridge — those are
   *in-process* services with shared state. Wrapping them as MCP would
   add JSON-RPC overhead for no benefit. The right move is: AIDE's
   services stay in-process; the agent loop in arch 4778 calls them
   directly via `dispatchTool` (already wired).
2. **Don't add MCP servers just because they exist.** Every MCP server is
   a long-running process. Each one adds startup cost, RAM, and an
   attack surface. Only add ones that solve a real workflow gap.
3. **The Memory MCP server is NOT a replacement for the custom
   `memory-recall.mjs`.** They serve different purposes:
   - MCP memory: graph of entities (people, projects, facts)
   - memory-recall.mjs: line-based retrieval of session summaries
   Use both. They are complementary.
4. **Windows `npx` via `cmd /c` adds 50-100ms of overhead per call.**
   Not a problem for chat (one tool call), but if you wire 10 MCP
   servers, every tool call adds ~1s. Consider a single bundled MCP
   server that proxies to many tools.
5. **Cline's MCP support is real but undocumented in detail.** As of
   2026, the official path is the `.mcp.json` / `mcp.json` file.
   Cline picks them up on restart.

## What to do (direct)

1. **Open `C:\Users\<you>\AppData\Roaming\Code\User\mcp.json`** (or create it).
2. **Add the Tier 1 servers**: memory, filesystem (rooted at
   `E:\aide-sovereign-workbench`), git (rooted at the same).
3. **Restart Cline**.
4. **Test**: ask Cline to "remember that Nomad has a tablet and prefers BM25 over embeddings" — should land in the memory server's JSONL.
5. **Wire memory-recall.mjs** (the AIDE-internal one) into the chat route so the model sees prior session summaries, not just KG entities.

## Why it's done this way

- **MCP gives AIDE a "second brain" without writing code.** The memory
  MCP server is 5 minutes of config and immediately gives Cline
  persistent memory across sessions. No Cline patches, no AIDE patches.
- **The KG shape (entities + relations) is the right shape for the
  operator model.** AIDE's memory-recall.mjs is the right shape for
  *session timeline* (what we did, when, what worked). Two different
  shapes, two different systems, both useful.
- **The filesystem + git MCP pair replaces ~30% of the AIDE agent's
  custom tools.** AIDE has `git_*` and `fs_*` actions via desktop-control
  for the *operator*; the MCP pair gives Cline the same power for itself.

## Dependencies / issues / bugs

- Requires: `npx` (Node 22+) on PATH; `uvx` (Python 3.11+) for Python servers.
- The official `@modelcontextprotocol/server-memory` is the only MCP
  server that overlaps with an AIDE-internal feature. Don't replace
  `memory-recall.mjs` with it; add it as a complement.
- MCP servers log to stderr by default. On Windows, redirect with
  `args: ["2>", "logs/mcp-X.err.log"]` in the config — but note this
  is a shell-only feature, so it requires wrapping with `cmd /c`.

## Related skills

- `aide-context-retrieval-wiring` — the doctrine for grounding chat
  in workspace code (the index-service.mjs path). The MCP filesystem
  server is the Cline-side complement.
- `aide-engine-lifecycle-doctrine` — the doctrine for spawn/respawn
  of model engines. The MCP git server is a downstream of "after a
  successful turn, commit." That policy belongs in Gap #6 (hooks).
- `aide-auto-memory-wiring` (to be created) — the wiring of
  `memory-recall.mjs` into the chat route. Complement to this skill.

| Server | When |
| --- | --- |
| **GitHub / GitLab** | Only when you want AIDE to manage PRs, issues, and CI from chat. Heavy surface area, not relevant for local-only desktop IDE. |
| **Postgres / SQLite** | When AIDE has a real database to talk to. Today the index is on disk. |
| **Brave Search** | When the operator wants the model to web-search during chat. Privacy tradeoff — Brave is a 3rd party. |
| **Google Drive** | When AIDE is used inside a workspace that has shared docs. |

  "mcpServers": {
    "memory": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

`uvx`-based servers (Python) don't need the wrapper.
