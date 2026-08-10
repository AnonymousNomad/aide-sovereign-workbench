# Sovereign Community Protocol

This document defines the implementation boundary for AIDE's community layer. It is intentionally conservative: local operation must work without a relay, and no component may silently export project data.

## Node

Each installation has a local node record:

```json
{
  "node_id": "stable-device-profile-id",
  "identity_key": "stored-in-os-keystore-or-user-keyring",
  "network": "offline | direct | relay",
  "capabilities": ["git", "artifact-signing", "encrypted-sync"]
}
```

The browser prototype creates only a local profile ID. Production identity must use an audited Ed25519 implementation and OS-backed key storage. Never implement cryptography by hand or store private keys in the repository, localStorage, URLs, or chat logs.

## Encrypted Collaboration

1. The owner creates a group and generates a random group content-encryption key.
2. The owner invites a peer by an out-of-band invitation containing the peer public key, group ID, expiry, and a signed key envelope.
3. Each replicated object is encrypted before transport with an authenticated encryption scheme from an audited library such as libsodium.
4. The object envelope includes `group_id`, `object_id`, `author`, `parent`, `content_hash`, `ciphertext`, `signature`, and `created_at`.
5. Peers verify signature, group membership, parent history, and content hash before storing or applying an object.
6. Git remains the merge and history authority. A peer receives a patch or object; it never silently overwrites a working tree.

Private projects are never replicated. Group replication is opt-in per repository, branch, issue, artifact, or discussion.

## Relays

Relays are dumb encrypted mailbox services. They may store ciphertext and minimal routing metadata but must not receive plaintext source, prompts, credentials, payment secrets, or model traces. Users select, run, or replace relays. Direct peer transport is preferred; relay use is visible in the node panel.

## Marketplace

Marketplace objects are signed public manifests, not custodial accounts:

```json
{
  "artifact": "signed-release-or-package-id",
  "license": "SPDX identifier",
  "terms": "price, bounty, sponsorship, or free",
  "payment_destinations": [{"provider": "...", "uri": "..."}],
  "refund_policy": "...",
  "checksums": {"file": "sha256"},
  "author_signature": "..."
}
```

Users choose their own payment destination and provider. AIDE never holds funds, generates a custodial wallet, takes undisclosed fees, or claims that payment completed. External payment status is untrusted until the provider confirms it.

## Moderation

Moderation is local and federated by signed policy:

- users can block, mute, hide, and report locally;
- groups can publish signed rules and moderator decisions;
- relays can reject abusive traffic without seeing encrypted content;
- public artifact scanners can quarantine suspicious files;
- no global moderator is required for private work.

Reports must not expose private source or encrypted group content without the reporter explicitly exporting it.

## Capability Gates

Do not mark encrypted sync, relay, payments, or decentralized moderation as production-ready until there are interoperability tests, key-rotation tests, replay protection, conflict tests, offline recovery tests, abuse tests, and a security review of the crypto implementation.
