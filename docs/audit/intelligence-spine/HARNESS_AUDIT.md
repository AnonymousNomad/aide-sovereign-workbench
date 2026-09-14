# Harness and Tool Execution Audit

## Production AgentLoop path

[Agent tools](../../../node/src/services/agent-tools.mjs) registers read_file, list_dir, search, write_file, replace_in_file, run_command, switch_mode, desktop_action and attempt_completion. [Parser](../../../node/src/services/agent-parser.mjs) supplies XML tool calls; AgentLoop normalizes aliases and checks required params. Execution authority is outside tool.execute: requiresToolApproval uses readOnly metadata plus computed risks.

Preserved controls: lexical path containment followed by realpath checks for file tools; top-level .git denied; invisible control characters rejected for writes; read/command output capped; write and command session approval; command timeout; search/replace matching and bounded failures.

Direct /api/agent/tool resolves aliases and sandbox IDs and denies every mutation, regardless of input approved fields. The 29-test regression confirms missing/false/malformed/true payload approval cannot create writes. Sandboxes do not manufacture permission.

## Important distinctions

- readOnly is trusted registry metadata, not OS isolation. The underlying write tool itself has no authority token; every caller must be governed.
- run_command executes a parsed program with process.env and cwd. It is not a sandbox: cwd does not prevent outside-workspace file access, child processes, network or localhost API access.
- Suspicious network tokens add a risk and egress log; they do not deny execution. Interpreters or scripts can use network without matching those tokens.
- search in direct sandbox mode receives the workspace-level rg service, not a sandbox-scoped search service. File jail and search scope therefore differ.
- createAgentLoop constructs tools without the desktop instance. The instance is handed only to the direct dispatcher, which denies mutations. Thus the agent's advertised desktop_action normally fails NOT_READY; Telegram uses the live desktop instance.
- Filesystem, terminal, Git, tasks, debugger and plugin APIs are separate capability paths. The AgentLoop approval gate is not a universal interceptor. [Permission audit](PERMISSIONS_AUDIT.md).

## Alternative executors

Legacy Workflow.apply validates approved:true and calls WorkspaceManager. Legacy Operator emits proposals only. The standalone createHarness returns an apply function that throws: it has no production mutation authority.

SandboxFlow is not production-registered. Its runVerification([]) returns passed:true (pure probe). approveApply accepts a patch without a permission record. More seriously, sandbox.applyToReal writes p.replace as the whole destination rather than applying p.search/p.replace to current contents. A successful scratch patch can therefore destroy unrelated lines on real application. Do not expose this helper before equivalence and authorization tests; no real apply was run.

DesktopPolicyHook.propose does not execute anything, but starts decision='executed' and only changes it when confidence is present and below threshold. Missing confidence also receives executed. No production import was found; this is a promotion hazard, not a demonstrated current AgentLoop bypass.

## Recovery

Agent checkpoint service uses shadow Git with core.worktree pointed at the real workspace. commit() temporarily renames nested repository .git directories, then restores them best-effort. AgentLoop launches that promise without awaiting it before mutation. A checkpoint can capture after-state, fail without disclosure, or race other operations. restore() contains hard reset/clean and is not invoked by the observed agent path. No rollback guarantee is justified.

## Result semantics

Agent result.ok must be exactly true; failures become observations and log entries. Terminal verification remains false. Desktop act returns ok:true after operation return even if autoAssert.pass is false; assertion is separate but callers such as Telegram show “Executed.” Execution return is not independently verified state.

Panic's image-name sweep is a live P0: taskkill /IM /F is broader than recorded child PIDs and can kill unrelated user sessions. No destructive test was run.

Required future tests: deny unauthorized tool execution across all entrypoints; program/sandbox boundaries; approval-to-exact-action binding; sibling completion ordering; checkpoint before-state synchronization; sandbox apply equivalence; desktop instance wiring; owned-process-only panic; evidence failure propagation.

