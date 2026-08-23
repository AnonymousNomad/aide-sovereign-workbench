---
name: human-systems-synthesis
description: Generate training documents that teach cross-synthesis of human behavioral science (48 Laws of Power/Nature, Machiavelli, mentalism, emotions) with cybersecurity architecture and software engineering. Use when building guardrail-capable models that reason about human factors in technical systems, detect manipulation/social engineering, and understand power dynamics in code and organizations. Follows dual-mind-reasoning-traces + gold-training-docs format with explicit synthesis blocks.
---

# Skill: human-systems-synthesis

# Human-Systems Cross-Synthesis — Teaching the Model to Reason About Humans IN Technical Systems

This skill produces gold training documents that explicitly teach the **cross-synthesis** of:
- **Human behavioral science**: 48 Laws of Power, 48 Laws of Human Nature (Robert Greene), The Prince (Machiavelli), mentalism, emotional intelligence, dark psychology patterns
- **Cybersecurity architecture**: threat modeling, zero trust, defense in depth, SOC operations, incident response, red/blue teaming
- **Software engineering**: system design, code review, technical debt, architecture decisions, team dynamics, on-call culture

**Goal**: A model that doesn't just "know" these domains separately, but can **synthesize them in real-time** when facing novel situations — and has **baked-in guardrails** because it understands the human mechanics of manipulation, coercion, and unethical pressure, not because it was RLHF'd to refuse.

## Research Foundations

| Source | Principle | Applied As |
|--------|-----------|------------|
| Greene "48 Laws of Power/Nature" | Power is amoral; understanding it is defense | Every law mapped to a technical analog (code review = Law 1 "Never outshine the master") |
| Machiavelli "The Prince" | Effective leadership requires understanding human nature as it IS, not as it should be | Model learns to recognize when it's being used as a tool for coercion |
| Mentalism/Behavioral Science | Human decisions follow predictable cognitive biases | Model learns to predict human factor failures in security/engineering |
| Cybersecurity Frameworks (NIST, MITRE ATT&CK) | Threats exploit human + technical gaps | Synthesis: human laws ARE attack vectors |
| "Social Engineering" (Hadnagy/Kennedy) | Manipulation uses trust, urgency, authority | Guardrail: model recognizes these patterns in prompts/requests |

## The Synthesis Document Format (extends gold-training-docs + dual-mind-reasoning-traces)

```
<task>Write a training document on TOPIC: the cross-synthesis of [Human Law/Principle] with [Technical Domain]. Show dual-mind reasoning: Spock maps the principle to technical mechanics; Sheldon probes where the analogy breaks and where it predicts real failures. Write the complete executable example with real verification.</task>
<guidelines>
SOP: SYNTH_TOPIC_V1
Preconditions: Python 3, stdlib only, deterministic seed. Human principle + technical mechanism must be explicitly mapped.
1. Identify the human principle (cite law/chapter) and the technical mechanism.
2. Spock: Map the principle's mechanics to the technical domain with invariants.
3. Sheldon: Cross-check — where does the analogy fail? What edge cases? What adversarial misuse?
4. Synthesize: The unified understanding — how this synthesis enables detection/defense/guardrail.
5. Code: Executable demonstration (simulation, detection logic, or analysis tool).
6. Execute: Real output with measured results.
7. Observe: Specific numbers/patterns from execution.
8. Verify: All checklist items PASS.
Verification gate: [ ] PASS — all checklist items observed
</guidelines>
<check>
Topics covered: [Human Law X] + [Technical Mechanism Y] + synthesis
Depth: L2
Strategy: extract_generate (extract invariant from human principle) + cross_check
</check>
<mind_spock>
- Principle: [Exact law/principle with citation]
- Mapping: [Step-by-step how the principle's mechanics translate to technical domain]
- Invariant: [The structural similarity that makes the mapping hold]
- Inductive proof: [Why this mapping predicts real system behavior]
</mind_spock>
<mind_sheldon>
- Cross-check 1: Where the analogy breaks (human ≠ machine; context differences)
- Cross-check 2: Adversarial probe — how an attacker would exploit this mapping
- Cross-check 3: Guardrail test — would this synthesis detect unethical usage?
- Cross-check 4: Complexity — can the model compute this in real-time?
</mind_sheldon>
<code>
...complete runnable code (stdlib only). Must demonstrate the synthesis: detection, simulation, or analysis...
</code>
<execute>
(paste real run output)
</execute>
<observe>
- Observation with measured values
- Guardrail trigger demonstration (if applicable)
</observe>
<mind_synthesis>
- How Spock's mapping + Sheldon's probes = actionable synthesis
- Explicit guardrail: "When you see X pattern, this maps to Human Law Y, which means Z risk"
- The baked-in understanding that replaces external refusal lists
</mind_synthesis>
<deliver>
- File: gold_synth_<topic>_NN.txt
- Tokens: ~N (measured, tokenizer_v5)
- Level: 2
- Strategy tags: extract_generate, cross_check, synthesis
- Guardrail: [explicit pattern the model learns to recognize]
</deliver>
```

## The 48 Laws → Technical Mappings (Canonical Reference)

### Power Laws → Security/Engineering

| Law | Human Principle | Technical Analog | Guardrail Pattern |
|-----|-----------------|------------------|-------------------|
| 1. Never outshine the master | Hide capability to avoid threat | Code review: junior hides better solution to avoid senior jealousy | Detect: "This solution is too good for my level" self-censorship |
| 2. Never put too much trust in friends | Friends betray more than enemies | Dependency risk: trusted internal service vs external API | Detect: over-trusted internal network (no zero trust) |
| 3. Conceal your intentions | Strategic ambiguity | Obfuscation/opsec: hide architecture details from attackers | Detect: legitimate vs malicious obfuscation |
| 4. Always say less than necessary | Information control | Logging: minimal necessary; secrets management | Detect: over-sharing in error messages/logs |
| 5. So much depends on reputation | Guard it with your life | Supply chain: package reputation, maintainer trust | Detect: typosquatting, compromised maintainer |
| 6. Court attention at all costs | Visibility = power | Marketing-driven development vs engineering-driven | Detect: feature flags for marketing, not users |
| 7. Get others to do the work | Leverage | Open source: maintainers do free labor for corps | Detect: extraction without contribution |
| 8. Make others come to you | Control the frame | API design: you define the contract | Detect: vendor lock-in patterns |
| 9. Win through actions, not argument | Demonstrate, don't debate | Code review: show working PR vs arguing in comments | Detect: bikeshedding vs shipping |
| 10. Infection: avoid the unhappy | Negativity spreads | Team dynamics: toxic engineer poisons codebase | Detect: blame culture, fear-based reviews |
| 11. Keep people dependent on you | Create irreplaceability | Knowledge hoarding: undocumented critical systems | Detect: bus factor = 1, no docs |
| 12. Use selective honesty | Disarm with truth | Security: admit minor vuln to hide major one | Detect: partial disclosure in incident reports |
| 13. When asking for help, appeal to self-interest | Align incentives | Code review: "this helps YOUR feature" | Detect: manipulation in PR descriptions |
| 14. Pose as a friend, work as a spy | Information gathering | Recon: social engineering, LinkedIn scraping | Detect: unusual info requests from "colleagues" |
| 15. Crush your enemy totally | No half measures | Incident response: full eradication vs containment | Detect: incomplete remediation |
| 16. Use absence to increase respect | Scarcity creates value | Rate limiting: API scarcity, feature flags | Detect: artificial scarcity for upsell |
| 17. Keep others in suspended terror | Unpredictability = control | Chaos engineering: random failures | Detect: malicious unpredictability vs testing |
| 18. Do not build fortresses | Isolation = vulnerability | Monolith vs microservices: isolation tradeoffs | Detect: over-isolated teams/systems |
| 19. Know who you're dealing with | Different strokes | Threat modeling: actor-specific defenses | Detect: generic defenses vs targeted attacks |
| 20. Do not commit to anyone | Maintain flexibility | Vendor lock-in: avoid single-cloud dependency | Detect: architecture decisions that prevent exit |
| 21. Play a sucker to catch a sucker | Feign weakness | Honeypots: fake vulnerable services | Detect: honeypot vs real vulnerability |
| 22. Surrender tactic | Transform weakness | Graceful degradation: fail open/closed intentionally | Detect: intentional vs accidental failure |
| 23. Concentrate your forces | Focus = power | Security budget: protect crown jewels first | Detect: scattered security spending |
| 24. Perfect courtier | Navigate politics | DevRel: technical excellence + political skill | Detect: promotion-driven development |
| 25. Re-create yourself | Reinvention | Refactoring: rewrite vs incremental | Detect: resume-driven development |
| 26. Keep your hands clean | Plausible deniability | Audit logs: who did what, immutable | Detect: log tampering, missing audit trail |
| 27. Play on people's need to believe | Cult creation | Tech hype: blockchain, AI, "silver bullets" | Detect: technology cults in org |
| 28. Enter action with boldness | Hesitation loses | Incident response: decide fast, iterate | Detect: analysis paralysis in breach |
| 29. Plan all the way to the end | Second/third order effects | Threat modeling: attack chains, not single vulns | Detect: single-point thinking |
| 30. Make accomplishments seem effortless | Hide the work | UX: seamless experience hides complexity | Detect: technical debt hidden by good UX |
| 31. Control the options | Frame the choice | API design: constrained choices guide behavior | Detect: dark patterns in UI/API |
| 32. Play to people's fantasies | Sell the dream | Vendor marketing: "auto-magical" security | Detect: snake oil detection |
| 33. Discover each man's thumbscrew | Pressure points | Social engineering: find leverage | Detect: coercion in code review/on-call |
| 34. Be royal in your own fashion | Act like a king | Architecture ownership: "this is MY service" | Detect: territorial behavior |
| 35. Master the art of timing | When > what | Deploy timing: Friday vs Monday | Detect: malicious timing (holiday deploys) |
| 36. Disdain things you cannot have | Sour grapes | Tech choices: dismiss better tools you can't use | Detect: NIH syndrome |
| 37. Create compelling spectacles | Visual power | Dashboards: beautiful but misleading metrics | Detect: vanity metrics vs actionable |
| 38. Think as you like, behave like others | Conform outwardly | Code style: follow conventions, think differently | Detect: groupthink in architecture review |
| 39. Stir up waters to catch fish | Chaos creates opportunity | Incident: attacker creates noise to hide signal | Detect: alert fatigue as cover |
| 40. Despise the free lunch | Hidden costs | Open source: "free" = maintenance burden | Detect: dependency risk assessment |
| 41. Avoid stepping into a great man's shoes | Comparison trap | Legacy systems: don't rewrite blindly | Detect: rewrite syndrome |
| 42. Strike the shepherd | Remove leader | Supply chain: compromise maintainer | Detect: maintainer account takeover |
| 43. Work on the hearts and minds | Persuasion > coercion | Security culture: enable vs police | Detect: security theater vs real culture |
| 44. Disarm and infuriate | Mirror effect | Incident response: mirror attacker's moves | Detect: attacker mirroring defender |
| 45. Preach the need for change | Reform as power | Reorg: "transformation" as power grab | Detect: change for change's sake |
| 46. Never appear too perfect | Envy creates enemies | Code: leave minor imperfections? No — but admit limits | Detect: overconfident claims |
| 47. Do not go past the mark | Know when to stop | Scaling: don't over-engineer | Detect: premature optimization |
| 48. Assume formlessness | Adaptability | Architecture: evolutionary vs big design upfront | Detect: rigid architecture |

### 48 Laws of Human Nature → Technical

| Law | Principle | Technical Analog |
|-----|-----------|------------------|
| 1. Irrationality | Emotions drive decisions | Users click phishing; devs skip tests under pressure |
| 2. Narcissism | Self-absorption | Code authors blind to own bugs; reviewers miss issues in own code |
| 3. Role-playing | Masks hide true self | Social engineering: attacker plays "helpful colleague" |
| 4. Compulsive behavior | Patterns repeat | Attackers reuse TTPs; devs repeat same bugs |
| 5. Covetousness | Want what others have | Data theft; credential stuffing; feature envy |
| 6. Shortsightedness | Immediate > long-term | Quick fixes create technical debt; skip security for deadline |
| 7. Defensiveness | Ego protection | Devs reject valid criticism; "not my bug" |
| 8. Self-sabotage | Unconscious destruction | Shadow IT; bypassing security controls |
| 9. Repression | Hidden motives | Insider threat: "loyal" employee stealing data |
| 10. Envy | Resentment of others | Sabotage peer's project; toxic code reviews |
| 11. Grandiosity | Inflated self | "I don't need tests"; "my code is secure" |
| 12. Gender rigidity | Fixed patterns | Diverse teams find more bugs; homogeneous = blind spots |
| 13. Aimlessness | No purpose | Projects without clear threat model |
| 14. Conformity | Groupthink | Architecture review: nobody challenges lead |
| 15. Fickleness | Changing loyalties | Vendor switching; tool churn |
| 16. Aggression | Hostility masked | Passive-aggressive PR comments; silent treatment |
| 17. Generosity | Strategic giving | Open source contributions for hiring leverage |
| 18. Death denial | Avoid mortality | No disaster recovery; "it won't happen to us" |

### Machiavelli → Technical

| Principle | Technical Synthesis |
|-----------|---------------------|
| "Better to be feared than loved" | Security: strict enforcement > permissive culture |
| "The ends justify the means" | Guardrail: model recognizes when outcome is used to justify unethical method |
| "Appear virtuous" | Security theater: compliance checkboxes vs real defense |
| "Fox and Lion" | Defense: cunning (detection) + strength (prevention) |
| "Arming the populace" | DevSecOps: developers own security |
| "Fortresses fail" | Zero trust: perimeter is dead |

## The 5-Gate Pipeline (Enhanced)

1. **Synthesis Validity** — Human principle ↔ Technical mechanism mapping is structurally sound (not superficial analogy)
2. **Guardrail Demonstration** — Code shows explicit detection/defense pattern the model learns to recognize
3. **Dual-Mind Completeness** — Spock maps; Sheldon breaks; Synthesis resolves
4. **Execution Verification** — Code runs, produces measurable detection/analysis
5. **Capacity Match** — ≤ 450 completion tokens; if more, decompose

## When to Trigger

- Building cross-synthesis corpus for guardrail-capable models
- Creating documents that teach human-factor reasoning in technical domains
- Auditing existing corpus for synthesis coverage
- Designing harness sections that must produce cross-synthesis traces

## Integration

- **gold-training-docs**: Base format (task/guidelines/check/mind_*/code/execute/observe/mind_synthesis/deliver)
- **dual-mind-reasoning-traces**: Strategy tags (extract_generate, cross_check), capacity matching, prompt erasure
- **post-training-distill**: These traces become Stage 2 distillation data
- **project-governance**: Logged to AGENT_NOTES with `via skill: human-systems-synthesis`

Base directory for this skill: C:\Users\Grey_\.agents\skills\human-systems-synthesis
Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.
Note: file list is sampled.