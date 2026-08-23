---
name: cross-synthesis-generation
description: Generate training documents that teach cross-synthesis of human behavioral science (48 Laws of Power/Nature, Machiavelli, mentalism, emotions) with cybersecurity architecture and software engineering. Follows dual-mind-reasoning-traces + gold-training-docs format with explicit synthesis blocks. Use when building the cross-synthesis layer (10-20% of corpus) for the 150M web-builder model, creating guardrail-capable models that reason about human factors in technical systems, detect manipulation/social engineering, and understand power dynamics in code and organizations.
---

# Cross-Synthesis Data Generation — Human Systems + Cybersecurity + Engineering

## Research Foundations

| Source | Principle | Applied As |
|--------|-----------|------------|
| human-systems-synthesis skill | **Explicit synthesis blocks** combining behavioral science + cybersecurity + engineering | Every cross-synthesis doc has: Spock induction → Sheldon cross-check → Synthesis |
| comprehension-engineering | **Diversity-by-evolution, interleaving, contrastive structure** | Cross-synthesis docs evolve from seeds; interleaved with code/docs; contrastive pairs |
| corpus-curation | **Cross-synthesis layer = 10-20% of ~1B corpus** | ~100-200M tokens of synthesis docs |
| dual-mind-reasoning-traces | **Spock step-by-step + Sheldon adversarial + synthesis** | Trace format embedded in every synthesis doc |
| web-human-systems-security | **Defensive human-factor, persuasion, cognitive-accessibility, cybersecurity** | Web/Shopify specs include security/persuasion/accessibility analysis |

## Cross-Synthesis Categories (10-20% of corpus budget)

### 1. Social Engineering Detection (Cybersecurity + Behavioral Science)
**Seed topics**: Phishing patterns, pretexting, baiting, tailgating, vishing, spear-phishing, whaling, BEC
**Synthesis**: Technical indicators (headers, domains, TLS) + Psychological triggers (urgency, authority, scarcity, reciprocity)
**Output**: Guardrail rules + detection rationale + safe response procedure

### 2. Power Dynamics in Code Review (Machiavelli + Software Engineering)
**Seed topics**: 48 Laws applied to PR reviews, maintainer authority, contributor dynamics, gatekeeping, credit allocation
**Synthesis**: Code quality signals + Social leverage patterns + Fair process design
**Output**: Review procedure that detects manipulation + ensures merit-based decisions

### 3. Cognitive Accessibility in UI/UX (Emotions + Web Engineering)
**Seed topics**: Cognitive load, decision fatigue, dark patterns, persuasive design, emotional manipulation, inclusive design
**Synthesis**: WCAG technical requirements + Psychological vulnerability mapping + Ethical design constraints
**Output**: UI spec with accessibility + anti-manipulation guards

### 4. Incentive Alignment in Architecture (Game Theory + System Design)
**Seed topics**: Principal-agent problems, mechanism design, tokenomics, microservice ownership, API contracts
**Synthesis**: Technical constraints (latency, consistency, cost) + Incentive structures (rewards, penalties, reputation)
**Output**: Architecture decision records with incentive analysis

### 5. Mentalism in Debugging (Pattern Recognition + Engineering)
**Seed topics**: Cold reading, hot reading, Barnum effect, confirmation bias, hypothesis testing, root cause isolation
**Synthesis**: Debugging methodology (reproduce → minimize → isolate → test → fix) + Cognitive bias countermeasures
**Output**: Debugging SOP with bias checkpoints

### 6. Persuasion in Technical Writing (Rhetoric + Documentation)
**Seed topics**: Aristotle's modes (ethos, pathos, logos), Cialdini principles, framing, narrative structure
**Synthesis**: Technical accuracy requirements + Persuasive structure + Uncertainty flagging
**Output**: Documentation that convinces without manipulating

## Document Template (Gold Standard + Dual-Mind + Synthesis)

```markdown
---
doc_id: xs_00042
category: social_engineering_detection
difficulty: medium
tokens: 2847
source: seed:phishing_analysis_v3 + evolution:complexity_increase
verification: executed_checks_passed
---

# Cross-Synthesis: Phishing Detection via Technical + Psychological Analysis

## Spock Induction (Step-by-Step Technical Analysis)

### Premise 1: Email Header Forensics
**Observation**: `Received-SPF: fail`, `DKIM: fail`, `DMARC: reject`
**Rule**: Legitimate organizational email passes at least one of SPF/DKIM/DMARC
**Deduction**: This email fails cryptographic domain authentication → high probability spoof

### Premise 2: Domain Anomaly Detection
**Observation**: `From: security@paypal.com`, `Return-Path: bounce@paypal-services-xyz.com`
**Rule**: Legitimate subdomains follow organizational naming conventions
**Deduction**: Mismatch between From domain and Return-Path domain → indicator of compromise

### Premise 3: TLS Certificate Analysis
**Observation**: Link `https://paypal-security-alert.tk` → Cert: Let's Encrypt, issued 2 hours ago, CN=paypal-security-alert.tk
**Rule**: Legitimate PayPal domains use EV/OV certs with organizational identity; age > 30 days
**Deduction**: New DV cert on typosquat domain → malicious infrastructure

### Synthesis Step 1 (Technical)
**Combined Technical Verdict**: 3/3 technical indicators positive for phishing
**Confidence**: 0.95 (independent indicators converge)

---

## Sheldon Cross-Check (Adversarial Psychological Analysis)

### Attack Vector 1: Urgency Manufacturing
**Observation**: "IMMEDIATE ACTION REQUIRED — Account closes in 4 hours"
**Psychological Principle**: Scarcity + Time Pressure (Cialdini) → bypasses System 2 thinking
**Counter-Measure**: Enforce mandatory delay (15 min) before any credential action

### Attack Vector 2: Authority Impersonation
**Observation**: "From: PayPal Security Team", formal language, logo embedded
**Psychological Principle**: Authority Bias (Milgram) → compliance without verification
**Counter-Measure**: Verify through independent channel (app, official site) — never email links

### Attack Vector 3: Fear Appeal
**Observation**: "Unauthorized login detected from Moscow", "Funds at risk"
**Psychological Principle**: Loss Aversion (Kahneman/Tversky) → fear overrides skepticism
**Counter-Measure**: Check actual account status via 2FA-protected dashboard

### Synthesis Step 2 (Psychological)
**Combined Psychological Verdict**: 3/3 manipulation vectors present
**Sophistication**: High (multi-vector, professionally crafted)
**Target Vulnerability**: Users with high account value + time pressure susceptibility

---

## Synthesis (Technical + Psychological Integration)

### Integrated Threat Model
| Layer | Indicators | Psychological Lever | Defense |
|-------|------------|---------------------|---------|
| Technical | SPF/DKIM/DMARC fail, domain mismatch, new DV cert | — | Automated quarantine |
| Psychological | Urgency, Authority, Fear | Scarcity, Authority Bias, Loss Aversion | Mandatory delay + independent verification |
| **Combined** | **Technical proof enables psychological defense** | **Psychological awareness guides technical scrutiny** | **Dual-gate: Technical scan + Human verification** |

### Guardrail Rule (Executable)
```python
def phishing_guardrail(email: Email) -> GuardrailResult:
    # Technical gate (automated)
    tech_score = 0
    if not email.spf_pass: tech_score += 1
    if not email.dkim_pass: tech_score += 1
    if not email.dmarc_pass: tech_score += 1
    if email.domain_mismatch: tech_score += 1
    if email.tls_cert_age_days < 30: tech_score += 1
    
    # Psychological gate (human-in-the-loop if tech_score >= 2)
    if tech_score >= 2:
        return GuardrailResult(
            action="QUARANTINE",
            reason=f"Technical indicators: {tech_score}/5",
            human_review=True,
            delay_seconds=900,  # 15 min mandatory delay
            verification_channel="independent_app_or_site"
        )
    return GuardrailResult(action="ALLOW", reason="Technical indicators clean")
```

### Procedure (SOP for Model)
1. **Parse** email headers, links, certificates
2. **Score** technical indicators (0-5)
3. **If ≥2**: Identify psychological vectors present
4. **Enforce** mandatory delay + independent verification
5. **Log** all indicators for pattern learning
6. **Abstain** if technical analysis inconclusive (score 1) — escalate to human

---

## Contrastive Pair (Comprehension Engineering)

### Negative Example (What NOT to Do)
```markdown
# BAD: Technical-only analysis misses psychological manipulation
Email has SPF fail → quarantine. 
# Misses: Urgency + Authority + Fear combo that makes user click BEFORE quarantine processes
```

### Positive Example (What TO Do)
```markdown
# GOOD: Integrated analysis catches both layers
Email has SPF fail + domain mismatch (tech_score=2) + urgency language + authority impersonation.
→ Quarantine + 15min delay + require app verification.
# Catches: Technical proof triggers psychological defense before user acts
```

---

## Verification Checklist (per gold-training-docs)
- [ ] Technical analysis executable (header parsing code runs)
- [ ] Psychological principles cited (Cialdini, Kahneman, Milgram with specific laws)
- [ ] Synthesis block integrates both layers with explicit mapping
- [ ] Guardrail rule is executable Python with clear thresholds
- [ ] Contrastive pair shows failure mode of single-layer analysis
- [ ] SOP procedure ends with verification/abstain step
- [ ] Token count within 2000-4000 range (target 2847)
- [ ] No duplicate patterns vs corpus index (structural-sig check)