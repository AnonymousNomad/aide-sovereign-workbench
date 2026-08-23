---
name: web-builder
description: Website/UI generation capability for the FSI-FELON dual-mind models (trek family). The locked design: model emits a STRUCTURED DESIGN SPEC (not raw HTML/CSS), a deterministic renderer turns it into HTML/CSS, and automated layout metrics score it. Use whenever building the web-generation training data, the spec schema, the renderer, the design scorer, the closed-loop sandbox, or the GRPO reward for website tasks. Enforces the 8/7 decision: structured spec + renderer (user chose over direct HTML/CSS tokens and over hybrid). Dual-mind rule: Spock proposes the spec, Sheldon critiques it against design rules, the debate gate resolves.
---

# Web-Builder — Structured Design Spec + Renderer + Design Score

Locked 8/7 (user + collaborator input). A small (<=150M) dual-mind model CAN make
badass unique/novel/beautiful full websites IF beauty is moved out of the token
problem and into a structured-data + verification problem. The model does NOT need
to write beautiful CSS tokens — it needs to emit a valid design spec that a
deterministic renderer turns into clean HTML/CSS, and it learns WHICH specs score
well via automated layout metrics + closed-loop self-correction.

## The "Mind Files" layer (locked 8/8 — user direction)

The model does NOT memorize procedures or knowledge; an external, versioned,
deterministic "mind" is injected/routed at build start (research: CLAG ACL'26 —
SLMs are highly vulnerable to irrelevant context, compartmentalized memory reduces
cross-topic interference; MemFlow — structured routing substitutes for missing
capacity at sub-3B; ByteRover — Context Tree = Domain > Topic > Subtopic > Entry
as markdown files with explicit @-relation edges; Instruction Hierarchy — system
SOP = highest privilege, context synthesis trains the follow pattern). Four layers:

1. **SOP book (injected every build, highest privilege)** — the procedure: every
   build starts the same way and ends the same way; site-type-specific checklists
   (website vs Shopify differ). Model follows what it sees; it never recalls.
2. **Verifying questions (injected)** — the SOP asks the user what it must know
   before building (business, audience, goal, primary action, must-haves) so it
   never guesses what it can find out. Website's quality is decided before the
   first token, by what the model knows about the business.
3. **Mind files / knowledge compartments (ROUTED by kind, not injected all)** —
   deterministic router (keyword: shopify/store/ecommerce -> shop compartment;
   portfolio/gallery -> portfolio; etc.) pulls ONLY the right compartment into
   context. Layout: `web_builder/mind/<domain>/<topic>/<subtopic>/entry.md`.
   Domains: web, shopify, ecommerce, design, accessibility, security, human.
4. **Cross-domain links (explicit @-edges)** — entries carry relations
   (@security/social_engineering <-> @human/deception <-> @web/form_validation)
   so related compartments reinforce each other when retrieved. This IS the
   cross-synthesis doctrine applied inside the build harness.

## Security doctrine (locked 8/8 — user direction)

The model is trained on Machiavelli's The Prince, 48 Laws of Power, 48 Laws of
Human Nature, and cybersecurity — and the CROSS-DOMAINS between them — so the
websites and especially Shopify stores it builds are top-tier secure (money lives
there). Rationale: a defender cannot out-think attackers whose psychology it has
never studied. The builder trained on the attacker's mind doesn't just add a
captcha — it sees the psychology driving the attack and shuts down the intent,
not just the vector.

- `security/web_security/` — OWASP Top 10, injection/XSS/CSRF, auth, secrets,
  input validation, session handling, secure headers.
- `security/shopify_security/` — payment security, PCI-DSS posture, Liquid
  template injection, checkout integrity, card-data handling, fraud vectors.
- `security/adversarial_mind/` — the attacker's playbook distilled from The
  Prince (deceit, opportunism, calculated trust), 48 Laws of Power
  (manipulation, social-engineering vectors), 48 Laws of Human Nature
  (deception, emotion, cognitive hooks) mapped to concrete exploit patterns
  (phishing urgency, trust exploitation, baiting, pretexting).
- Sheldon (adversarial cross-check mind) is trained WITH this threat knowledge;
  the debate gate runs real security review, not token-level critique.
- Veritas gate applies: nothing broken, unverified, or insecure ships.
- Generator skill: `human-systems-synthesis` (cross-synthesis of human behavioral
  science + cybersecurity + software engineering) governs adversarial_mind docs.
- Shopify-specific SOP gets a security verification checklist (payment flow
  integrity, no card-data persistence in the model's output, checkout state
  validation, input sanitization on any form, secure defaults).

## The pipeline (every website generation passes this)
```
NL prompt -> [Spock proposes design spec] -> [Sheldon critiques vs design rules]
          -> [debate gate resolves] -> spec (freely formatted)
          -> deterministic normalizer/packager -> canonical JSON spec
          -> deterministic renderer -> HTML/CSS
          -> render-score (deterministic layout metrics, PER-SECTION)
          -> closed-loop (see rules below; prefer resampling over self-repair)
          -> ship only specs that parse AND score
```

## NORMALIZER TRAIN==SERVE FAILURES (fixed 8/11 — audit-before-teacher rule)
The 8/11 remediation harvest caught TWO normalizer bugs that made the grader
FALSELY fail and FALSELY pass outputs the model emitted exactly as trained.
Rule: before the teacher corrects any student output, the deterministic grader
itself must be audited on the harvest batch — a "failure" may be a grader bug.

1. `_SECTION_RE` matched `logo[\s-]?cloud` but NOT `logo_cloud` (underscore).
   The model emits `logo_cloud` (its trained gold format); the header was
   swallowed into the PREVIOUS section as body/items. Fix: `logo[\s_-]?cloud`.
   Consequences: bogus logo_cloud sections, and `contact` sections falsely
   passing because a swallowed `logo_cloud` header became their `body`.
2. First bare line of a section went to `title` (≤80 chars heuristic). Gold
   format for `contact` is `title:"", body:"hello@..."` and the scorer
   requires `contact.body` — so every single-line contact was falsely failed
   as "missing expected content". Fix: for `contact`, first bare line maps to
   `body`.
Verification: 17/17 contact "failures" repaired, 0 regressions, mean harvest
score 0.8631 -> 0.8727, project verification harness exit 0. The real
remaining weakness after the fix: novelty ~0.21-0.30 on 24/24 samples
(structural near-duplication vs the seed DB) + occasional contrast issues.
Keep the section-header regex and EXPECTED_CONTENT field expectations in sync
with the corpus generator (gen_web_corpus/gen_web_sft) — that IS the
train==serve contract for the web pipeline.

## NOVELTY TARGET CALIBRATION (fixed 8/11)
`novelty_score` is the nearest `structural_distance` to the curated seed DB,
not an absolute creativity grade. Before using a novelty threshold for teacher
remediation, calculate whether the threshold is reachable for the requested
kind, the seed set, and the canonical section limit. Never change a semantic
`kind` or weaken the scorer merely to satisfy an unreachable number.

For the current `agency` remediation pool, the existing `agency.json` seed and
the 12-section canonicalization cap bound same-kind novelty below `0.6` under
the current distance weights (measured upper bound approximately `0.5282`).
Therefore the acceptance contract for this round is: parseable free-form spec,
SOP compliant, total score >= `0.88`, and measured structural diversity against
the parent batch. An accepted output with low novelty is a data-coverage or
scorer-calibration finding, not a student failure that justifies inventing a
teacher correction. Recalibrate the target only from a measured same-kind
baseline or revise the seed/metric design in a separately verified change.

## REASON FREE, CONSTRAIN LATE (8/7 research correction — non-negotiable)
Constraint-tax finding (arXiv 2605.26128): hard JSON schema decoding raises schema
validity (61.5%->100%) but LOWERS answer accuracy (19.7%->11.0%) and raises
wrong-valid-schema outputs (49.5%->88.9%) on sub-3B models. DOMINO (ETH 2024):
minimally-invasive constrained decoding preserves accuracy while naive
hard-constraining drops it (41.5%->30.8% on JSON-GSM8K; minimally-invasive -> 41.8%).
FOR THIS 150M MODEL:
- Do NOT hard-constrain decoding to the JSON schema. Let the model generate the spec
  freely (or with template-based scaffolding where structure is FIXED and only the
  value fields are sampled — the DOMINO pattern).
- The deterministic normalizer/packager validates + repairs + re-serializes the
  spec into the canonical schema AFTER generation. Validation is a gate, not a
  decode-time straitjacket.
- Template/scaffolding style changes the model's tokenization -> use a FIXED,
  stable scaffold in training data and never switch formats mid-project (DOMINO:
  template-induced tokenization misalignment raises perplexity 4.17 -> 24-49).

## Section-wise evaluation is REQUIRED (8/7 research validation)
WebGen-V (Sony, KDD'26): LLM-generated webpage defects are LOCALIZED imperfections
(spacing inconsistency, suboptimal contrast, misalignment) that whole-page review
misses. Section-wise structured evaluation lifted degradation-detection F1 from
0.46 to 0.78 vs full-page, and structured refinement gave consistent wins on
spacing consistency (SPC), alignment (ALN), media positional accuracy (MP), and
text readability (TR). IMPLICATION: score and refine PER-SECTION, never page-level
only. The spec's ordered sections ARE the evaluation units. Borrow their metric
names: SPC (spacing consistency), ALN (alignment), MP (media position), TA/TP/TR
(text accuracy/placement/readability) — add to our metric set below.

## The design spec (structured output target)
The model emits a FREELY-FORMATTED spec (structure-first text; per constrain-late
above, never decode-time JSON). The deterministic normalizer/packager parses,
validates, repairs, and re-serializes it into this canonical schema. Define and lock
ONE canonical schema:

```
{
  "kind": "landing" | "portfolio" | "app" | "blog" | "shop" | ...,
  "palette": {"primary": "#hex", "secondary": "#hex", "accent": "#hex", "bg": "#hex", "ink": "#hex"},
  "typography": {"display": "pt", "body": "pt", "mono": "pt"},  // sizes in pt on a defined scale
  "spacing": {"unit": 4, "scale": [4,8,16,24,32,48,64]},         // spacing system, unit-multiples only
  "layout": {"max_width": 1140, "columns": 12, "grid": "container|full|split"},
  "sections": [                                                   // ordered, 1..N
    {"type": "hero|features|gallery|testimonial|pricing|cta|footer|nav",
     "title": "...", "body": "...", "items": [...], "style": "tight|airy|bold|minimal"}
  ],
  "motion": {"hover": "none|lift|underline", "transition": "ms"}
}
```
Rules:
- Palette must be closed under readability (contrast rule below). Model proposes any
  hue; renderer/scorer enforces contrast.
- Spacing values come ONLY from the scale. No arbitrary pixels.
- Typography sizes come ONLY from a type scale (e.g. 12/14/16/20/24/32/48/64).
- Sections ordered top-to-bottom; the scorer rewards coherent order (nav/hero/.../footer).
- Normalizer contract: JSON.parse must ALWAYS succeed on a shipped spec; unknown
  fields are dropped with a warning; missing required fields get deterministic
  defaults (never guessed by the model). Schema versioned; renderer version stamped
  on every scored sample.

## Deterministic renderer (no model involved)
- Maps the spec to semantic HTML5 + CSS custom properties (CSS vars from the
  palette + spacing tokens). Never inline arbitrary values that violate the schema.
- One renderer, one output contract. Renderer changes = data+reward invalidations;
  version the renderer and stamp it on every scored sample.
- Output must be re-parseable (html.parser/tree-sitter) and each section must be
  present as a real DOM node.

## Design scorer (deterministic layout metrics — our "closed-loop verify" for beauty)
Beauty is not compiler-verifiable, so we score with DETERMINISTIC rules computed on
the rendered DOM + palette. These become: (a) the closed-loop accept/reject signal,
(b) preference-pair labels for GRPO (chosen=high score, rejected=low score), and
(c) later, optionally, the training data for a small learned reward model.
**Dimension taxonomy adopted from AesEval-Bench (arXiv 2603.01083):** four
dimensions — layout, typography (font), color, graphics — each with concrete
indicators. Our deterministic scorer maps onto these; where AesEval/PRISM need
vision models, we use DOM-level math because we control the render.
Metrics (each 0..1, then weighted sum; score PER-SECTION then aggregate):
- **LAYOUT**: BALANCE (element counts + column usage match section type; no
  lopsided grids), WHITESPACE (padding/gaps in spacing scale, no 1px outliers),
  ALIGNMENT/ALN (elements snap to the column grid), LAYERING (no unintended
  overlap of text/image).
- **TYPOGRAPHY**: HIERARCHY (display > section title > body strictly by scale;
  <=2 distinct sizes per section), LEGIBILITY (WCAG contrast, font size floor).
- **COLOR**: CONTRAST (WCAG ratio >= 4.5:1 body / 3:1 large text on every
  ink-on-bg + primary-on-bg pair), HARMONY (palette one hue family; <=1 high-sat
  primary), APPEAL/PSYCHOLOGY (kind-appropriate hue, e.g. calm for therapy).
- **GRAPHICS**: RELEVANCE (image/icon matches section content), QUALITY (alt text,
  sensible aspect ratios, no broken asset refs).
- **MEDIA (WebGen-V)**: MP (media positional accuracy), TIA (text-media
  association).
- **SPACING CONSISTENCY (SPC, WebGen-V)**: adjacent-section rhythm uniform per the
  spacing scale.
- **NOVELTY** (the "badass/unique" requirement): penalize exact matches to templates
  in the design DB; reward structural difference from the k nearest curated designs.
- **ACCESSIBILITY**: img alt present, nav semantics, focus order sane.

## Dual-mind mapping (generator-critic inside one forward pass)
- Spock path generates the PROPOSAL spec (structure-first, balanced, logical order).
- Sheldon path generates the CRITIQUE stream against the design rules (contrast
  check, spacing audit, hierarchy check, novelty check).
- Debate gate resolves; the final emitted spec carries both minds' influence.
- Training data must include proposal+critique+resolved triples, not just final specs.

## Curriculum (progressive complexity — "curriculum learning" from collaborator email)
1. Single-section layouts (hero only) -> 2. 3-section (nav/hero/footer)
3. Full pages with 5-8 sections -> 4. Distinct kinds (portfolio, pricing, app)
5. Novelty pressure: ask for "something nobody's seen" -> score novelty bonus.
Each stage has its own verified corpus; a model that fails stage N does not train N+1.

## Curated design DB (maps onto DNA memory / gene bank / scratch pads)
- Maintain a small curated set of high-scoring reference specs (the "gold designs").
- The model's DNA/gene-bank recall provides retrieval; RAG is the fallback for
  longer-reference tasks. Reference designs are inputs to novelty scoring.
- Never let curated designs become output templates — they are distance references,
  not targets (novelty requirement).

## Closed-loop (self-play iterative refinement in the sandbox)
```
generate spec -> render -> score -> below threshold? -> corrective retry -> re-render
-> re-score -> keep ONLY specs that parse AND score >= threshold -> append to verified
web corpus
```
- **VERITAS LAYER (user-designated, 2026-08-08):** the last stage of the closed loop
  is the COMPILE + STAGE step — the model never hands over a raw un-compiled guess,
  only a built, tested, compiled artifact. Order: Spock proposes -> Sheldon critiques
  -> debate gate -> MENTAL sandbox -> REAL sandbox (render in browser/headless) ->
  verify -> debug -> verify ONE MORE TIME -> **Veritas: STAGE + COMPILE** -> emit. The
  last dump clears Sheldon. Concretely for web: STAGE = assemble the final bundle from
  verified pieces; COMPILE = spec -> deterministic renderer -> real HTML/CSS bundle
  (the renderer IS the compiler); VERIFY THE COMPILED ARTIFACT = the bundle parses,
  renders, no dead links, all sections present, assets resolve, contrast passes, runs
  end to end; RE-VERIFY = compile, debug, compile again, confirm the final build still
  passes; RELEASE ONLY THE COMPILED ARTIFACT. It gates BROKENNESS (unparseable spec,
  contrast fail, dead links), never creativity — novel specs pass exactly like safe
  ones if functionally valid. Trained behavior, not a prompt trick; preference data
  must include unverified-candidate-rejected pairs.
- **SELF-REPAIR IS NOT FREE BELOW 7B (8/7 research correction).** "Try Again, Don't
  Look Back" (arXiv 2607.26117, MBPP+, 1.5B/3B/7B, placebo-controlled): blind
  resampling (re-generate from the ORIGINAL prompt, no reference to the failed
  attempt) BEAT self-repair at 1.5B/3B; showing the model its own failed attempt
  anchored it (33-68% near-identical retries vs 2-14% under resampling) and cost
  ~6 points. Execution feedback added nothing measurable over a content-free
  failure notice at this scale. Same finding direction in "Feedback Over Form"
  (arXiv 2604.21950, 1-3B): refinement fixed NameError/SyntaxError but rarely
  AssertionError, and REQUIRED early stopping or every extra pass was net-negative.
- **REQUIRED RULES for this 150M model:**
  1. Default loop = **blind resampling** (fresh generation from original prompt +
     high-level guidance). Do NOT auto-feed the failed spec back by default.
  2. Cap iterations LOW: k<=2 for the free-form retry. Research shows first pass
     gives the biggest gain; beyond ~2 every pass is often net-negative below 7B.
  3. If self-repair is used, give the model only the **localized, explicit**
     failures (e.g. "contrast 2.9:1 on hero primary/ink", "spacing 3px outside
     scale on section 4") — the per-metric, per-section signal. This is the
     NameError-style feedback that IS usable; never vague page-level criticism.
  4. Always compare any self-repair loop against blind resampling on the same
     budget; keep whichever wins on scored-spec rate. Evidence first.
- The scorer tells the model WHICH metric failed, so correction is directed, not
  blind ("contrast failed on primary/bg pair" -> recolor, don't rewrite all).
- Stamp every kept sample: renderer version, per-metric scores, source, prompt-erasure
  state, retry strategy used. No stamp, no entry (same STaR-poisoning guard as
  post-training-closed-loop).
- Never feed unrendered/unscored spec output into any corpus.
- CoCoS (EMNLP'25 findings): prompting alone does NOT give SLMs self-correction;
  training-based RL with accumulated+progressive rewards does (+35.8% MBPP, +27.7%
  HumanEval at 1B). So closed-loop retry is an INFERENCE strategy for us; making the
  model GOOD at it is a training-phase job (RLVR later), not a prompt trick.

## RLVR / reward path (later, after closed-loop produces enough labels)
- Once we have thousands of verified (prompt, spec, score) samples: train a small
  learned reward model on the deterministic scores, then GRPO on it. Do NOT start
  RLVR before the deterministic scorer has produced enough signal.
- Grounding: UIClip (arXiv 2404.12500) trained a CLIP-based UI-quality scorer on 2.3M
  synthetic pairs (original vs "jittered"/degraded UI) + 1.2K human ratings and beat
  all baselines on design-quality ranking — same degrade-and-score recipe we use.
  Design-o-Meter (WACV'25) unified scoring + refinement (genetic refiner on the
  scorer's signal) — evidence the scorer->refine loop works when signal is local.

## SOTA research roundup (2026-08-08) — the #1-website-builder recipe
- **WebGen-R1 (arXiv 2604.20398, RL for website generation):** scaffold-driven
  structured generation (constrains the action space) + CASCADED multimodal reward
  (structural guarantees -> execution-grounded functional feedback -> VISION-based
  aesthetic). A 7B model beat 72B models and rivaled DeepSeek-R1 (671B) on functional
  success while EXCEEDING it on aesthetic alignment. Recipe: SFT warm-up 600 samples,
  2 epochs, LR 1e-5, then ~400 RL steps. KEY: aesthetics require VISION; they needed a
  VLM reward model. WE DO NOT — our deterministic scorer on the DOM gives the reward
  signal for free. Our locked spec+renderer+scorer design IS their "scaffold-driven"
  architecture with a cheaper reward oracle. This is our structural edge.
- **WebGen-Agent (Step-GRPO):** step-level rewards (VLM screenshot score per step +
  GUI-agent functional test) with cumulative advantage beat outcome-only GRPO. Agent
  gains were large at 7B (38.9->45.4% accuracy, appearance 3.4->3.7). We can emulate
  per-section step rewards using per-section scorer metrics (already required).
- **Shopify Flow fine-tune (shopify.engineering 2026-04):** moving the OUTPUT DSL into
  an IN-DISTRIBUTION representation (JSON DSL -> Python DSL) gained +22 pts syntactic,
  +13 pts semantic correctness. Lesson: don't force the model to emit a hard JSON/
  token language; emit a free-form spec close to natural language (which our normalizer
  then re-serializes). CONFIRMS our constrain-late free-form-spec design. Also: train on
  output artifacts users actually produce; production mirroring (training data must
  match inference exactly); weekly retraining flywheel on real usage (our Stage 4).
- **Apple RLDF (Reinforcement Learning from Designer Feedback):** small CLIP-based
  reward model (UIClip init) scores UI screenshot + description; ORPO on preference
  pairs (chosen=top-scored, rejected=random) lets SMALL models beat larger proprietary
  ones. We already generate preference pairs for free from the deterministic scorer —
  this validates Stage 3 without needing a VLM or human designers.
- **ReLook (vision-grounded RL, LLM-as-critic):** ZERO reward for invalid renders
  (anti-reward-hacking) + Forced Optimization (accept only improving revisions). Both
  map directly to our scorer: unparseable spec = score 0; only specs scoring above the
  previous best are kept.
- **DesignSense-10k + AAPA/DesignQA:** inference-time scaling (generate k candidates,
  pick highest-scored) +3.6%; MLLM preference alignment for layout +17%; quality-
  filtering training data matters (+4.97% IoU). Validates our blind resampling k<=2
  AND suggests future: raise k with the learned reward model once Stage 3 exists.
- **LLM-Landing-page-distillation (1.5B):** TEMPLATE-based training data collapses to
  ONE memorized layout; diversity of business types x styles x layouts is what creates
  genuine variety (they used 100 business types x 10 styles x 10 layouts; model hit a
  capacity ceiling ~500 examples). Rule for our web corpus: diversity per doc KIND is
  the anti-template lever (this is what makes outputs "unique"). Data diversity >=
  quantity at small scale.
- **ui-distill (3B):** distilling a strong teacher (baked long system prompt into
  weights) worked at tiny sample counts (648), 2h on one 3060. Response-only masking.
  Note: repetition penalty hurt HTML output — be careful with it in decode.
- **Vibe Code Bench:** self-testing DURING generation is strongly predictive of success
  (Pearson r=0.72). Maps to dual-mind: Spock proposes, Sheldon critiques against the
  rubric, then the sandbox verifies. Teach the model to check its own spec against the
  design rules before release.
- **LongWebBench:** functional fidelity degrades with page length; multi-page EXECUTABLE
  interaction is the frontier. Our interaction-kind web docs (multi-page links, nav)
  should be prioritized for corpus diversity.
- Consolidation for THIS model: (1) keep deterministic scorer as the primary reward;
  (2) free-form spec stays in-distribution (no JSON-forcing); (3) Stage 3 preference
  pairs from scorer ranking (ORPO/DPO); (4) GRPO with step/per-section rewards, zero
  reward on invalid renders; (5) forced optimization (only improving revisions kept);
  (6) diversity-by-evolution in the corpus (business types x styles x layouts) is the
  anti-template, "unique website" lever; (7) teach self-testing during generation.

## Grounding / evidence (cited in AGENT_NOTES 8/7)
- WebGen-Bench: best published system (DeepSeek-R1 + Bolt.diy) only 27.8% — the field
  has not solved it; opportunity, not proof of impossibility.
- WebGen-V Bench (Sony, KDD'26): section-wise structured representation + section-wise
  evaluation/refinement is validated; defect-detection F1 0.46->0.78 vs full-page;
  structured refinement consistently improves SPC/ALN/MP/TR. Our per-section spec +
  scorer mirrors this.
- Google DESIGN.md (google-labs-code/design.md): open design-token spec (YAML tokens +
  rationale prose) with an 11-rule linter incl. WCAG contrast — reference schema
  format for our spec. xiaopu-ai/web-design + Evilander/claude-design-mcp: spec-first,
  then-code pipelines with quality checklists (100-score) — precedent for spec-first.
- FrontCoder-7B: matched 671B-class by alignment; quality-of-training beats size.
- Phi-1 lesson: 1.3B textbook quality beat 12B on 100B tokens — data discipline wins.
- SLM code study (arXiv 2507.03160): no sub-1B standard model does real code — that
  gap is exactly what our structured-spec + verification regime attacks.
- Constraint tax (arXiv 2605.26128): hard schema decoding hurts small-model accuracy;
  reason free, constrain late. DOMINO (ETH'24): minimally-invasive constrained
  decoding preserves accuracy. JSONSchemaBench: constrained decoding can ALSO speed
  up generation ~50% — only use it where it does not touch semantics.
- "Try Again, Don't Look Back" (arXiv 2607.26117): below 7B, blind resampling beats
  self-repair; anchoring costs ~6 points. "Feedback Over Form" (arXiv 2604.21950):
  execution-feedback refinement helps only with explicit local failures + early
  stopping. CoCoS (EMNLP'25): SLM self-correction is a TRAINING problem, not a
  prompt trick.
- AesEval-Bench (arXiv 2603.01083): 4-dimension/12-indicator design-aesthetics
  taxonomy (layout, font, color, graphics) — our scorer's dimension mapping. PRISM
  (CVPR'26): perturbation-driven principle scoring (coherence/readability/contrast/
  alignment/overlap). UIClip (arXiv 2404.12500): CLIP scorer trained on degraded-UI
  pairs beats baselines. Design-o-Meter (WACV'25): scorer + genetic refiner loop.
- Rejected: diffusion+language hybrid (pixel-space CNN arch; both minds are text
  paths; infeasible on GTX 1060 alongside this model).
