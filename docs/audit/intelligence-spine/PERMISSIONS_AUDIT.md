# Permissions / Risk / Approval Audit

## Live P0: capability APIs are outside trusted actor authority (F01)

ArchServer.handle validates body/query shape but has no authenticated principal, session credential, Origin enforcement or trusted approval context. Facade corsHeadersFor only selects response headers; a disallowed Origin continues to the upstream. readBody parses JSON regardless of Content-Type.

Git stage/unstage/commit/checkout/push and task-run routes do not require an approval field. Filesystem writes, terminal-run and desktop action accept strict booleans supplied by the request; those booleans are not authenticated user decisions. Desktop grants route stamps approved_by:'operator-wizard' without proving the wizard called it. Agent decision UUID prevents accidental/repeated decisions but does not authenticate who decides; sessions expose pending IDs.

### Safe composed probe

Actual facade + ArchServer + Git stage route were exercised with:
- POST /api/git/stage
- Origin http://untrusted.invalid
- Content-Type text/plain
- body containing paths only, no approval or caller credential

Result: HTTP 200, no Access-Control-Allow-Origin, captured Git stage invocation. GitService.stage/run were replaced with in-memory stubs. No file or Git mutation occurred.

This proves server-side dispatch, not a full browser exploit on every browser. Browser private-network restrictions may differ; they are not the intended execution authority. Local programs can address loopback directly. A raw model has no network socket by itself, but an approved unrestricted program can use these same APIs to bypass subsequent granular decisions.

Sources: [facade](../../../scripts/facade.mjs#L166), [server](../../../node/src/server.ts#L88), [Git routes](../../../node/src/routes/git.ts), [Git contracts](../../../common/contracts/git.ts), [desktop grants](../../../node/src/routes/desktop.ts#L78).

## Operation matrix

| Operation | Classification / policy | Approval / enforcement | Gap |
|---|---|---|---|
| Agent file read/list | registry readOnly, lexical+realpath jail | no routine approval; hard path restrictions | sensitive non-.git files can be read; data trust separate |
| Agent write/edit | mutable + protected/invisible risks | pending session decision, exact UUID, one-shot | good local gate; checkpoint race, no operation capability passed into executor |
| Direct agent write/command/sandbox | requiresToolApproval | always denies without session authority | repaired; regression passed |
| Agent command | mutable; token-based network risk | human approval then unrestricted program | no OS sandbox, env inherited, arbitrary filesystem/network/loopback possible |
| REST file/patch/replace | route boolean + workspace checks | approved===true from payload | no principal-bound decision |
| REST terminal | allowlisted executables/denied flags | payload approved===true | interpreters/scripts are broader than argument filtering; separate policy |
| Git mutation/push | route and GitService restrictions | no trusted approval or network consent | F01; unlike legacy approvals |
| Tasks | validated workspace task definition | POST label directly dispatches TaskService | untrusted workspace configuration is executable authority without project trust gate |
| LSP/DAP | manager configuration and raw protocol routes | outside AgentLoop gate | debugger launch/raw requests are privileged adapters, no shared execution policy |
| Desktop | enabled grants + TTL + panic + approved boolean | REST payload or Telegram pending YES | grant-setting/decision routes unauthenticated; policy hook not enforcement |
| Telegram | optional persisted config, allowlisted chat IDs | per-chat proposal + YES within 5 minutes | separate authority, no canonical agent workflow; permissive YES prefix parsing |
| Plugins | trust flag + capability manifest + Node permission process | plugin execution refuses without trust | useful isolation pattern; trust-setting API still within F01 |
| Providers | stored credentials/connect allowlist | separate from BYOK consent | no single revocable per-invocation network policy |
| BYOK | consent at resolver/test time | closure used afterward | revocation/timeout gaps |
| Embeddings/local model endpoints | configured URL/manifest | no universal loopback/egress authority | “local” label is not host validation |
| Background selfimprove | boot and six-hour spawn | no per-run operator approval | no model training performed by script; repo/workspace ownership differs |

## Confidence invariant

No live AgentLoop permission is conferred by confidence. Expert confidence only filters advice. The dormant DesktopPolicyHook violates status semantics by labelling high/missing confidence executed; its paired skill text implies confidence-selected autonomy. Reject that design before activation, not by deleting the skill corpus.

## Panic scope (F03)

desktop-control.panic loops known children, then force-kills every allowlisted executable image via taskkill /IM /F. It increments counts even if no process was killed. This can destroy unrelated unsaved user sessions. Keep a panic control, but make ownership explicit and separately authorize any broad emergency sweep. No process termination was tested.

## Minimum acceptance

All actor classes—human UI, model workflow, local adapter, background job—must be distinguishable. Every mutation and approval consumption must validate actor, permitted scope and exact operation. Requests cannot mint authority through booleans, labels, confidence or model output. Preserve legitimate user editor/terminal actions without pointless prompts, using authenticated user intent and explicit policy. Test the real facade and direct-backend boundary, including disallowed Origins, simple request content types, forged decisions and revocation. No implementation performed.

