// aide-secrets-handling-protocol
//
// The pre-commit hook's secret-scan regex list grew from 3 to 4 patterns
// on 2026-09-07 (hf_, sk-, PRIVATE KEY, plus Telegram bot tokens).
// This skill encodes the WHY and the full handling protocol so a future
// agent does not re-introduce the gap.
//
// Failure mode: chat transcript leak.
// Telegram bot tokens are numeric:alphanumeric. The original regex
// only matched `hf_` (HuggingFace), `sk-` (OpenAI-style), and the
// `PRIVATE KEY` PEM header. The token the operator shared in chat
// did not match any of those patterns, so the pre-commit hook would
// have happily committed a file containing the token if the operator
// had pasted it into the source. The transcript itself is a leak
// surface — anyone who reads the transcript (including the assistant)
// has full control of the bot until the operator revokes the token
// in BotFather and the original becomes useless.

## Law (per R8)

**Chat is not a credential store.** Tokens, keys, passwords, or any
secret material may not appear in chat, in screenshots, in logs, in
git diffs, in `git log` output, in commit messages, in PR descriptions,
in `AGENT_NOTES.md`, or in any other surface that is read by anyone
other than the operator. The only acceptable locations for a secret
are:

1. A `.env` file in the workspace root (gitignored, on the
   operator's machine only)
2. A `~/.config/<app>/credentials` file in the operator's home dir
   (encrypted at rest by the OS keyring on supported platforms)
3. A hardware-backed secret store (Windows DPAPI via
   `ProtectedData.Protect`, Linux `secret-tool`, macOS Keychain)

Tokens and secrets that are *required* for tests or for the build
must be loaded from one of the above three sources. They must never
be hard-coded, logged, or echoed back to the operator in any form
that leaves the operator's machine.

## What the regex list does and does not cover

The pre-commit hook scans staged content for these patterns:

| Pattern | Catches | Does NOT catch |
|---|---|---|
| `hf_[A-Za-z0-9]{20,}` | HuggingFace tokens | Tokens with shorter random tails, tokens with `-` or `_` in the tail |
| `sk-[A-Za-z0-9]{20,}` | OpenAI-style bearer | Anthropic keys (`sk-ant-...`), Mistral (`...`), Gemini (`AIza...`), GitHub PATs (`ghp_...`) |
| `-----BEGIN PRIVATE KEY-----` | PEM private key header | Encrypted private keys (no header), `.env` files committed as-is |
| `[0-9]{8,}:[A-Za-z0-9_-]{35,}` | Telegram bot tokens | Discord bot tokens (longer base64), Slack app tokens (`xox[abp]-...`), GitHub fine-grained PATs (`github_pat_...`) |

The list is NOT comprehensive. It catches the tokens we have actually
seen used in this project. **A token that does not match any of
these patterns WILL commit.** Per the Law above, the operator must
never put a token in code in the first place — the regex list is a
defense-in-depth, not a primary control.

## Required additions (queue)

For each provider the chassis talks to, add the canonical token
pattern to the pre-commit hook's secret-scan regex list. Per
`aide-security-hardening` Feature 1 "Secret Detection (pre-commit)".

Suggested additions when they become relevant:
- Discord bot token: `[MN][A-Za-z0-9]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}`
- Slack app token: `xox[abp]-[A-Za-z0-9-]+`
- GitHub PAT classic: `ghp_[A-Za-z0-9]{36}`
- GitHub fine-grained: `github_pat_[A-Za-z0-9_]{82}`
- Anthropic: `sk-ant-[A-Za-z0-9_-]{40,}`
- Google API key: `AIza[A-Za-z0-9_-]{35}`
- Mistral: `[A-Za-z0-9]{32}` (less distinctive — high false-positive risk)

## Operator workflow (the only safe path)

1. Operator creates the bot in BotFather (Telegram) or the equivalent
   dev console (Discord, Slack, etc.).
2. Operator copies the token to the operator's local `.env` file
   directly. Never via chat, never via screenshot, never via
   `echo $TOKEN` to a terminal that logs to a file.
3. Operator revokes the original token in the bot console
   immediately. The original is now burned; only the new token
   (in `.env`) is valid.
4. The chassis reads `AIDE_<SERVICE>_BOT_TOKEN` (or equivalent) from
   `.env` at startup. The token never enters a source file.
5. If a secret ever needs to be shared with the assistant, the
   operator must (a) revoke the original in the console, (b) create
   a new one, (c) paste the new one ONLY into `.env` on the operator's
   machine, never into chat. The assistant never asks for the value;
   it asks for the env var name and reads from `.env` itself.

## Why this exists

The transcript of any chat with the assistant is a leak surface
by default. Tokens shared in chat are compromised the moment they
appear. The pre-commit hook regex list is a *secondary* control —
the primary control is "do not put secrets in chat." This skill
exists so a future agent does not re-create the gap the operator
identified on 2026-09-07 (the pre-commit hook did not scan for
Telegram bot tokens at all).

## Verification

This skill was added on 2026-09-07 alongside the pre-commit hook
extension. The matching battery lives at
`tests/in-house-e2e/pre-commit-secrets-battery.mjs` and covers
the four patterns with positive and negative cases (Telegram
boundary, time-of-day HH:MM:SS false-positive guard, OpenAI
boundary, HuggingFace boundary, PEM boundary).

## Cross-references

- `.git/hooks/pre-commit` lines 34-42 (the regex)
- `tests/in-house-e2e/pre-commit-secrets-battery.mjs` (6 tests)
- `aide-security-hardening` Feature 1 (overall secret-detection
  doctrine; this skill is the AIDE-specific protocol layer)
- `aide-debugging-discipline` (R8: Fail Once → Stop → Skill)
- `aide-windows-dev-reality` (DPAPI for Windows-native secret store)
- AGENTS.md R7 (memory-pressure doctrine for token-heavy services)
