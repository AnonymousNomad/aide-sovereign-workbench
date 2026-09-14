# Checkpoint C fixture findings

## Approval detail compatibility regression

The real-child composed regression added an exact bare-response assertion for APPROVAL_REQUIRED and adapter ownership. Before repair: 0 passed / 1 failed / 0 cancelled / 0 skipped (1037.9559 ms); HTTP 409 survived but the facade discarded error.detail, producing undefined. Fixture children 17916 and 18556 both exited with SIGTERM. No operation was approved or executed by this failing run.

Source diagnosis: scripts/facade.mjs rewriteErrorEnvelope retained only message/code; the direct legacy dispatcher did not identify missing approval distinctly. Repair preserves optional detail and identifies the authoritative adapter explicitly. This changes serialization/observability only, not authority. The regression retains exact status, detail and zero-side-effect assertions. No global fetch override, assertion weakening, retry, or reusable skill mutation.

The first composed positive-pairing regression run reported 11 passed / 1 failed (808.4509 ms). The failing expectation was 409 but the real GitPathsRequest strict schema returned 400 BAD_REQUEST for the added approved field. No captured mutation occurred. This is a fixture expectation defect, not permission granted.

Following aide-debugging-discipline's strict-Zod rule, preserve the strict schema and assert exact 400 BAD_REQUEST for extra authority-like body keys. Separately submit the schema-valid Git body with no authorization and assert exact 409 with APPROVAL_REQUIRED, and zero executor calls. The prepare fixture also follows AuthorityOperationResponse directly rather than incorrectly expecting a nested operation wrapper (the decision response alone has that wrapper).

No production schema weakened. No skip/retry or vague success assertion introduced. Failure research is recorded here within the authorized evidence boundary; no reusable skill files changed.

The subsequent focused runtime regression passed 13/13 (875.6754 ms). A later static gate found fixture-only typing errors: this repository's Headers type does not expose iterable entries, and TypeScript needed explicit WebSocket/event promise types in the negative-case loop. Use the supported Headers.forEach API and explicit types, without changing assertions or compiler configuration. That gate reported Node typecheck exit 2, browser typecheck exit 0, targeted lint exit 0. Final rerun results are recorded separately in CHECKPOINT_C_RESULTS.json.
