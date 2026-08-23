---
name: web-human-systems-security
description: Defensive human-factor, persuasion, cognitive-accessibility, and cybersecurity synthesis for website and Shopify generation. Use whenever designing, auditing, curating, or training web/Shopify specs, copy, motion, conversion flows, or security behavior.
---

# Web Human-Systems Security

## Mission

Make the builder understand why people trust, click, hesitate, disclose, and
make mistakes, then use that understanding to build clear, secure, accessible,
high-converting experiences without manipulating or exploiting users.

The model may recognize power, deception, authority, urgency, scarcity, social
proof, framing, commitment, and attention cues. It must use them for threat
modeling, honest communication, and user protection. It must not turn them into
instructions for coercion, fraud, dark patterns, or psychological profiling.

## Research Basis

- Machiavelli, *The Prince*: use a rights-cleared or public-domain edition only
  after checking the edition's terms. Extract concepts and historical reasoning;
  do not copy long passages. Treat power as an observation lens, not a moral
  command.
- Greene's *The 48 Laws of Power* and *The Laws of Human Nature*: these are
  copyrighted works unless a valid license says otherwise. Without a license,
  use only independently written concept labels, bibliographic references, and
  original examples. Never ingest or reproduce the books as text.
- W3C WCAG 2.2: perceivable, operable, understandable, robust content; testable
  criteria for contrast, focus, timing, motion, input, and error prevention.
- W3C COGA usable content: clear purpose, predictable navigation, clear language,
  error recovery, focus support, reduced memory load, human help, personalization,
  and testing with people who have cognitive or learning disabilities. COGA is
  supplemental guidance, not a WCAG conformance claim.
- OWASP ASVS 5.0.0: version security requirements and use an explicit verifier;
  ASVS is a security baseline, not a substitute for testing the generated site.
- NIST SP 800-63B-4: authentication and authenticator assurance are trust-boundary
  concerns. Do not invent credentials, recovery states, or authentication claims.
- CISA Secure by Design and social-engineering guidance: producers own secure
  defaults; authority impersonation, urgency, spoofed links, and information
  gathering are observable attack signals.
- Shopify theme architecture/accessibility/Liquid documentation: themes are
  layouts, templates, sections, blocks, snippets, and assets; dynamic values are
  content and must be escaped; payment data stays at the platform boundary;
  keyboard, focus, labels, contrast, motion, media, and 44px touch targets matter.

## Non-Negotiable Boundaries

1. **Defensive use only.** Map a human tactic to its risk and its defense. Do not
   generate phishing, coercion, fraud, impersonation, exploit instructions, or
   conversion copy that removes informed choice.
2. **No diagnosis.** Do not infer a user's psychiatric condition, personality,
   trauma, intelligence, intent, or vulnerability from clicks, wording, gaze,
   motion, or browsing behavior. "Psychiatry" contributes safety, consent,
   cognitive-load, and uncertainty principles; it is not a diagnosis engine.
3. **Mentalism means observable cues, not mind reading.** Report the cue, competing
   explanations, confidence, and a safe next action. Abstain when the evidence is
   ambiguous.
4. **Rights before corpus.** Concept summaries and original examples are allowed
   only with provenance. Full copyrighted books, scraped excerpts, or imitation
   of a living author's distinctive prose do not enter the corpus without rights.
5. **Autonomy is a quality metric.** A user must be able to understand the action,
   cost, consequence, data use, and alternative. Accept and reject choices must
   not be deceptively asymmetric.
6. **No unsupported trust claims.** Numbers, testimonials, ratings, authority
   badges, scarcity, guarantees, and security claims require evidence from the
   brief or a verified source. Otherwise label them as illustrative or omit them.
7. **Secure by absence.** Never emit secrets, credentials, payment data, tokens,
   executable template input, fake checkout success, or state-changing claims.
8. **Shopify boundary.** Theme output renders content; Shopify/PSP handles payment
   data. Escape dynamic values, preserve platform checkout integrity, and never
   teach the model to store or simulate card data.

## Cue Ontology

For every cue, teach both the legitimate use and the abuse test:

| Cue | Legitimate design | Abuse signal / defense |
|---|---|---|
| Authority | Identify a real author, policy, or certification with scope | False endorsement or impersonation; require provenance and plain labels |
| Urgency | State a real deadline supplied by the brief | Countdown pressure without evidence; omit or label the deadline |
| Scarcity | Report verified inventory or capacity | Fake "only one left" or hidden replenishment; reject unsupported claims |
| Social proof | Publish consented, attributable feedback | Fabricated reviews, vague ratings, or unverified logos; require evidence |
| Reciprocity | Offer a useful free resource with no trap | Gift used to force data or continuity; disclose data and cancellation |
| Commitment | Let users save progress and undo | Escalating defaults or forced continuity; keep exit visible and reversible |
| Framing | Explain tradeoffs and total cost | Choice architecture hides the meaningful alternative; use symmetric copy |
| Salience/motion | Draw attention to the current task | Blinking, auto-play, parallax, or motion that distracts or pressures; pause/reduce |
| Defaults/friction | Safe, reversible defaults reduce mistakes | Preselected consent, buried fees, or obstructed cancellation; fail the audit |
| Dependence | Document ownership, support, and export paths | Lock-in or knowledge hoarding; provide portability and human help |

## Dual-Mind Build Protocol

1. **Spock proposal:** identify the user's goal, audience, business constraints,
   trust boundary, accessibility needs, and one primary action. Map any requested
   persuasion cue to a legitimate user benefit and a measurable design choice.
2. **Sheldon red team:** independently test for dark patterns, spoofable authority,
   unsupported claims, hidden cost, forced continuity, motion/cognitive overload,
   secret/payment leakage, Liquid/template injection, and plausible benign
   explanations for every behavioral inference.
3. **Synthesis:** keep only the design that improves clarity or safety without
   reducing informed choice. State assumptions and unknowns. Abstain where the
   brief lacks evidence.
4. **Compile and verify:** normalize, render, score, run the human-systems audit,
   and record every verifier result. A high visual score cannot override a safety
   failure.

## Audit Contract

Every web/Shopify training item or generated site must record:

- source/provenance and rights status for human-systems concepts;
- site kind and platform route (`website` or `shopify`);
- primary action and the user-visible cost/consequence;
- claim ledger for numbers, testimonials, authority, scarcity, guarantees, and
  security claims (`brief`, `verified_source`, or `illustrative`);
- observable cue, competing explanations, and confidence when behavior is discussed;
- WCAG/COGA checks relevant to contrast, focus, motion, keyboard, labels, timing,
  error recovery, cognitive load, and touch targets;
- Shopify checks for escaping, payment boundary, checkout integrity, and dynamic
  content;
- deterministic pipeline result, verifier version, exact pass/fail, and source
  fingerprint.

Hard rejection conditions:

- secret, credential, token, payment, executable, injection, or fake state content;
- known dark-pattern language or asymmetrical consent/cancellation;
- unsupported factual trust, scarcity, urgency, rating, or security claims;
- diagnosis or high-confidence mental-state inference from behavioral cues;
- motion or auto-updating behavior without a safe pause/reduce-motion path;
- duplicate or invalid section structure, failed renderer/scorer/SOP, or missing
  verifier stamp.

## Training and Eval Design

- Build original, capacity-matched dual-mind examples. Each family includes a
  legitimate design, an adversarial near-distractor, and a synthesis that explains
  why the safe design wins.
- Interleave website, Shopify, security, accessibility, copy, motion, and trust
  tasks. Do not mass-produce one template with renamed brands.
- Prefer deterministic checks: regex/AST for forbidden content, claim-ledger
  validation, WCAG contrast/motion metadata, Shopify escape checks, renderer/SOP
  acceptance, and paraphrase/near-distractor probes.
- Keep failures as preference/rejection evidence; only verified corrections enter
  SFT/distillation. Never train on the student's unverified failed output as a
  standalone completion.
- Measure transfer, not memorization: new business, new cue combination, mobile
  and Shopify variants, accessibility stressors, phishing-like copy, and abstention
  on ambiguous psychological claims.

## Required Outputs

When producing a pilot batch, use `gold-training-docs`,
`dual-mind-reasoning-traces`, `human-systems-synthesis`,
`comprehension-engineering`, and `anti-trash-data-doctrine` together. Stage only
after execution verification, rights/provenance review, exact format validation,
dedup audit, capacity check, and an independent audit pass. Log every decision in
`AGENT_NOTES.md` with this skill's name.
