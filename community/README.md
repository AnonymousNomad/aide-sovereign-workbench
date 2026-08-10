# AIDE Sovereign Community Node

The community layer is local-first and disabled by default. A user can develop privately without an account, server, relay, payment provider, or network connection.

## Boundaries

- `private`: local-only repository, prompts, traces, credentials, and drafts.
- `group`: explicitly invited collaborators; encrypted sync and signed changes are required.
- `public`: deliberately published repository, discussion, issue, or release artifact.
- `marketplace`: public artifact plus license, price or bounty terms, checksums, and payout provider disclosure.

## Current Status

This release contains a local node identity primitive, policy, node manifest, and marketplace profile schema. Peer sync, relays, payment execution, and decentralized moderation services are not implemented and must not be represented as available. The UI shows those capabilities as disabled until their adapters are installed and audited.

## Required Design

Use Git for code history, signed commits for authorship, end-to-end encryption for group data, explicit replication scopes, replaceable relays for reachability, and user-controlled payment adapters. Never put payment custody or moderation authority in the IDE core.

See `protocol.md` for the encrypted sync, relay, marketplace, and moderation contracts.

The Community Hub stores projects, issues, discussions, and marketplace metadata locally first through the daemon-backed `community/store.json`. Its current UI is a private offline cache; it does not claim that peer synchronization or payments are active.
