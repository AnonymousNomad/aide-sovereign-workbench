---
name: aide-security-hardening
description: Security hardening for AIDE — secret detection pre-commit, vulnerability scanning via Semgrep integration, SBOM generation, secure coding SOPs, and supply-chain audit. Use when implementing security features, auditing code for vulnerabilities, or building the security layer of the IDE.
---

# Security Hardening — Trust Through Verification

## What This Is

Not an afterthought. Not a plugin. A built-in security layer that scans every
commit for secrets, every dependency for known CVEs, and generates SBOMs for
compliance. The research shows 84% of orgs feel AI-productive but only 20%
can prove it. Security proof is part of that proof.

## Feature 1 — Secret Detection (pre-commit)

Scan staged files before commit for:
- API keys (AWS, GCP, Azure, OpenAI, Anthropic, HuggingFace)
- Bearer tokens, JWTs
- Private keys (PEM, SSH)
- Database connection strings
- Environment variables containing credentials
- High-entropy strings that look like secrets

Implementation: regex patterns + entropy analysis on staged diff.
Route: POST /api/security/scan {files: string[]} → {findings: [{file, line, type, pattern}]}
Integration: SHIP flow runs this automatically before commit; findings block commit until resolved or explicitly overridden by operator.

## Feature 2 — Vulnerability Scanning

Semgrep CLI (open-source, no cloud required):
- Scan source code for OWASP Top 10 patterns
- Custom rules for AIDE-specific patterns (prompt injection in templates, unsafe deserialization)
- Results surface as diagnostics in the editor rail
- CI integration: fail on HIGH severity findings

Installation: `pip install semgrep` (operator responsibility)
AIDE detects semgrep binary and integrates if available; shows "install Semgrep" guidance if not.

## Feature 3 — SBOM Generation

Generate Software Bill of Materials per project:
- Dependencies from package.json / requirements.txt / Cargo.toml
- License information per dependency
- Known vulnerability lookup via OSV database (offline cache)
- Format: CycloneDX JSON

Route: GET /api/security/sbom → {components: [{name, version, license, vulnerabilities[]}]}
Trigger: on demand from MODELS panel or automatically per release.

## Feature 4 — Secure Coding Skill Pack

5-10 preloaded skills covering OWASP Top 10:
1. Injection prevention (SQL, command, LDAP)
2. Broken authentication patterns
3. Sensitive data exposure (encryption at rest/transit)
4. XML External Entities (XXE)
5. Broken access control
6. Security misconfiguration
7. XSS prevention
8. Insecure deserialization
9. Using components with known vulnerabilities
10. Insufficient logging & monitoring

Each skill: detection rules + fix patterns + code examples.
Loaded into scaffold when relevant file types are open (.py, .js, .sql).

## Threats

| Threat | Control |
|---|---|
| False positives blocking commits | Severity threshold: HIGH blocks, MEDIUM warns, LOW informational |
| Scanner bypass (obfuscated secrets) | Entropy analysis catches high-entropy strings even without pattern match |
| Scanner itself compromised | Semgrep rules are local files, version-controlled, reviewed like code |
| Performance impact on large repos | Scan only staged/changed files; full scan opt-in |
| Secret in git history | Detect at scan time; recommend BFG repo-cleaner for history purge |

## Implementation Phases

S1: Pre-commit secret detection (regex + entropy, wired into SHIP flow)
S2: Semgrep integration (detect binary, run scan, parse results to diagnostics)
S3: SBOM generation (CycloneDX format from package manifests)
S4: Secure coding skill pack (OWASP Top 10 patterns loaded per language)
