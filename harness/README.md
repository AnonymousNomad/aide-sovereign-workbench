# AIDE Universal Harness

The harness is the layer that makes every connected model safer and more useful. It does not secretly retrain weights. It improves system behavior through curated context, role-specific prompts, deterministic tools, external verification, calibrated feedback, and reversible execution.

## Closed Loop

```text
intake -> guard -> retrieve -> plan -> propose -> verify -> revise -> test -> review -> learn
```

- **Intake:** normalize the task, workspace, permissions, and success criteria.
- **Guard:** reject prompt injection, unsafe paths, secret exposure, and unapproved network actions.
- **Retrieve:** select only relevant files, symbols, tests, docs, and prior decisions within a context budget.
- **Plan:** use the reasoning model to create constraints and a bounded checklist.
- **Propose:** use the coding model to emit a structured patch or artifact, never direct writes.
- **Verify:** use deterministic parsers, tests, linters, type checkers, Git diff checks, and a separate verifier model.
- **Revise:** allow a small fixed number of revisions, then stop and request human direction.
- **Test:** run only approved tasks in a sandbox and attach raw output to the trace.
- **Review:** show claims, evidence, diff, permissions, and verification result before applying.
- **Learn:** store anonymized outcome metadata and failures locally for prompt/eval improvement; never silently modify weights.

## Guarantees

- One model cannot approve its own work.
- The harness owns tools, permissions, context, cancellation, budgets, and audit records.
- Every patch is atomic, reversible, and user-approved.
- Low confidence or failed verification produces abstention, not fabricated success.
- Models can be swapped without changing the workflow.

## Model Roles

- `reason`: configured reasoning model for requirements, architecture, research, and test plans.
- `build`: Qwen Coder for code and unified diffs.
- `verify`: independent verifier for evidence and failure analysis.
- `fast`: optional small model for autocomplete and classification.

See `orchestrator.mjs` and `policy.json` for the executable contract.

Run `npm run veritas` from a workspace to execute the allowlisted compile, test, Git diff, manifest, secret, and path-boundary checks. The orchestrator also rejects malformed or fenced model patches before verification. A model verdict never overrides a failed execution check. The orchestrator accepts this runner as `verificationRunner` and blocks the final status until it passes.

For a developer-facing report, run:

```bash
npm run veritas -- --report
```

For stricter release, security, payment, publishing, or identity work, choose a
98% evidence class:

```bash
npm run veritas -- --report --task-class security-or-publish
```

To create a report artifact for CI or PR comments:

```bash
npm run veritas -- --report --output artifacts/veritas.md
```

The report maps failed checks back to the developer credo so the user sees the
reason for abstention, not just a red build. `harness/credo-map.json` contains
the machine-readable oath-to-control mapping.

The engineering standards and research basis are documented in `credo-research.md`.
The product uses technical language rather than fictional quotations, personas,
or branding.
