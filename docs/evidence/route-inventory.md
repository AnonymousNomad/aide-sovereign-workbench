# Route Inventory — Phase C0 (2026-08-23)

## Recheck — 2026-09-03

The current source was remeasured after the facade-map ownership fix:

- TS OpenAPI: `155` unique paths and `162` HTTP operations.
- Legacy daemon: `68` exact route branches and `9` query/path prefix branches,
  `77` total extracted branches.
- Facade map: `64` TS-owned prefixes, `3` exact TS flips, and `1` TS WebSocket
  upgrade rule.
- Facade target simulation: `134/162` TS operations route to TS and `28/162`
  shared operations remain on legacy. The remaining legacy paths are the
  intentionally unflipped shared model, search, session, task, training,
  workspace, Git, DAP, LSP, provider, and model-import/start/stop surfaces.
- TS-only subfamilies such as onboarding, system-map, workbench/worktree,
  chat history/stream, DAP inspection, LSP feature calls, model fit/ingest,
  training data/export, and task cache now have deterministic TS prefixes.

This is route ownership evidence, not a full production-cutover claim. Every
shared path still requires response-shape parity and a real facade walkthrough
before its target can change.

Counts: TS=122 legacy=69 both=27 ts-only=95 legacy-only=42
Reconciliation: both+ts-only==TS (122==122): true; both+legacy-only==legacy (69==69): true.

Legacy prefix-matched routes (startsWith semantics): `GET /api/model/ready`, `GET /api/academy/session`, `GET /api/academy/certificate`, `GET /api/file`, `GET /api/search`, `GET /api/git/diff`, `GET /api/dap/state`

## Served by BOTH (cutover candidates needing shape parity check)
- `POST /api/chat`
- `POST /api/dap/start`
- `GET /api/dap/status`
- `POST /api/dap/stop`
- `GET /api/file`
- `POST /api/file/write`
- `POST /api/git/commit`
- `POST /api/git/stage`
- `GET /api/git/status`
- `POST /api/lsp/start`
- `GET /api/lsp/status`
- `POST /api/models/start`
- `GET /api/models/status`
- `POST /api/models/stop`
- `GET /api/providers`
- `GET /api/search`
- `POST /api/search/replace`
- `GET /api/session`
- `PUT /api/session`
- `GET /api/tasks`
- `POST /api/tasks/run`
- `GET /api/tasks/status`
- `POST /api/tasks/stop`
- `POST /api/training/start`
- `GET /api/training/status`
- `POST /api/training/stop`
- `GET /api/workspace`

## TS-only (invisible to npm start users today)
- `POST /api/academy/exercises/attempt`
- `GET /api/academy/exercises/next`
- `GET /api/academy/hint`
- `POST /api/agent/decision`
- `GET /api/agent/sessions`
- `POST /api/agent/start`
- `GET /api/agent/status`
- `PUT /api/byok/consent`
- `PUT /api/byok/key`
- `DELETE /api/byok/key/delete`
- `DELETE /api/byok/providers/delete`
- `PUT /api/byok/providers/set`
- `PUT /api/byok/routing`
- `GET /api/byok/status`
- `POST /api/byok/test`
- `GET /api/chat/history`
- `POST /api/chat/history`
- `POST /api/chat/stream`
- `GET /api/commands`
- `POST /api/commands/invoke`
- `POST /api/dap/breakpoints`
- `POST /api/dap/configure`
- `POST /api/dap/continue`
- `POST /api/dap/disconnect`
- `POST /api/dap/launch`
- `POST /api/dap/scopes`
- `POST /api/dap/stack`
- `POST /api/dap/step`
- `POST /api/dap/variables`
- `GET /api/editor/options`
- `POST /api/git/blame`
- `GET /api/git/branches`
- `POST /api/git/diff`
- `POST /api/git/file-log`
- `POST /api/git/hunks/list`
- `POST /api/git/hunks/stage`
- `POST /api/git/hunks/unstage`
- `POST /api/git/log`
- `POST /api/git/unstage`
- `GET /api/handoff/bundles`
- `GET /api/handoff/bundles/get`
- `POST /api/handoff/export`
- `POST /api/handoff/import`
- `GET /api/health`
- `GET /api/hooks`
- `PUT /api/hooks`
- `POST /api/index/reindex`
- `GET /api/index/search`
- `GET /api/index/status`
- `GET /api/keybindings`
- `POST /api/keybindings/resolve`
- `POST /api/learner/attempt`
- `GET /api/learner/reviews`
- `GET /api/learner/state`
- `POST /api/lsp/change`
- `POST /api/lsp/close`
- `POST /api/lsp/completion`
- `POST /api/lsp/definition`
- `POST /api/lsp/hover`
- `POST /api/lsp/open`
- `POST /api/modelhub/download`
- `GET /api/modelhub/downloads`
- `POST /api/modelhub/downloads/cancel`
- `GET /api/modelhub/search`
- `POST /api/models/fit`
- `POST /api/models/import`
- `POST /api/models/ingest`
- `POST /api/models/route`
- `GET /api/models/routes`
- `GET /api/notifications`
- `POST /api/notifications/read`
- `POST /api/notifications/read-all`
- `GET /api/notifications/unread`
- `POST /api/problems/parse`
- `POST /api/providers/connect`
- `POST /api/providers/disconnect`
- `POST /api/providers/import`
- `GET /api/rg/files`
- `GET /api/rg/quick-open`
- `POST /api/rg/search`
- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/tasks/cache/clear`
- `GET /api/tasks/cache/stats`
- `GET /api/tasks/matchers`
- `GET /api/training/checkpoints`
- `GET /api/training/datasets`
- `POST /api/training/datasets`
- `POST /api/training/datasets/append`
- `POST /api/training/datasets/delete`
- `GET /api/training/datasets/read`
- `POST /api/training/export`
- `POST /api/training/export-eval`
- `GET /api/training/exports`
- `GET /api/training/presets`

## Legacy-only (hard tail — port or consciously drop before CF)
- `GET /api/academy`
- `GET /api/academy/certificate`
- `POST /api/academy/check`
- `POST /api/academy/complete`
- `GET /api/academy/session`
- `POST /api/arena/run`
- `GET /api/artifacts`
- `GET /api/blueprint`
- `GET /api/community`
- `POST /api/community/items`
- `PUT /api/community/items`
- `DELETE /api/community/items`
- `POST /api/dap/request`
- `GET /api/dap/state`
- `GET /api/diagnostics`
- `GET /api/git/diff`
- `GET /api/git/log`
- `POST /api/handoff/continue`
- `POST /api/handoff/propose`
- `POST /api/lsp/notify`
- `POST /api/lsp/request`
- `POST /api/lsp/stop`
- `GET /api/model/ready`
- `POST /api/model/start`
- `GET /api/model/status`
- `POST /api/model/stop`
- `GET /api/models`
- `POST /api/operator`
- `POST /api/patch/apply`
- `GET /api/plugins`
- `POST /api/plugins/execute`
- `GET /api/plugins/presets`
- `POST /api/plugins/scaffold`
- `POST /api/plugins/trust`
- `POST /api/providers/chat`
- `GET /api/replays`
- `POST /api/replays`
- `POST /api/terminal/run`
- `POST /api/workflow/apply`
- `POST /api/workflow/plan`
- `GET /api/workspace/tree`
- `GET /health`
