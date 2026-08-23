---
name: web-builder-spec-renderer
description: Implement the structured design spec schema, deterministic renderer, and design scorer for the FSI-FELON web-builder capability (8/7 decision: structured spec + renderer). Covers DESIGN.md token format, YAML-first spec hierarchy (tokens→primitives→blocks→templates→screens), deterministic HTML/CSS renderer, design scoring metrics (contrast, spacing, type hierarchy, palette harmony, balance, novelty, accessibility), and dual-mind closed loop (Spock proposes, Sheldon critiques, debate gate resolves). Use when building the web-builder training data, spec schema, renderer, scorer, or GRPO reward for website tasks.
---

# Web-Builder Spec Schema, Renderer & Design Scorer

## 8/7 Decision (Locked)
**Model emits STRUCTURED DESIGN SPEC (JSON/YAML)** → **Deterministic renderer → HTML/CSS** → **Automated layout metrics score it** → **Closed-loop: generate → render → score → self-correct → keep only parseable + scored specs**

**Dual-mind rule**: Spock proposes the spec, Sheldon critiques against design rules, debate gate resolves.

## Spec Schema (DESIGN.md + YAML-first hierarchy)

### Token Layer (normative values, machine-readable)
```yaml
# design/tokens/colors.yaml
colors:
  primary: "oklch(62% 0.18 250)"
  on-primary: "oklch(98% 0 0)"
  secondary: "oklch(55% 0.12 250)"
  surface: "oklch(98% 0.005 250)"
  on-surface: "oklch(15% 0.02 250)"
  # 12 OKLCH values total (per yamleer)

# design/tokens/typography.yaml
typography:
  display: {fontFamily: "Inter", fontSize: "3.5rem", fontWeight: "700", lineHeight: "1.1"}
  headline: {fontFamily: "Inter", fontSize: "2rem", fontWeight: "600", lineHeight: "1.2"}
  title: {fontFamily: "Inter", fontSize: "1.5rem", fontWeight: "600", lineHeight: "1.3"}
  body: {fontFamily: "Inter", fontSize: "1rem", fontWeight: "400", lineHeight: "1.6"}
  caption: {fontFamily: "Inter", fontSize: "0.875rem", fontWeight: "400", lineHeight: "1.5"}

# design/tokens/spacing.yaml (8px grid)
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"

# design/tokens/radius.yaml
radius:
  none: "0"
  sm: "4px"
  md: "8px"
  lg: "12px"
  full: "9999px"

# design/tokens/roles.yaml (tone mappings)
roles:
  neutral: {bg: "{colors.surface}", fg: "{colors.on-surface}"}
  emphasis: {bg: "{colors.primary}", fg: "{colors.on-primary}"}
  muted: {bg: "{colors.surface}", fg: "{colors.on-surface} @ 0.6"}
  danger: {bg: "oklch(55% 0.22 25)", fg: "oklch(98% 0 0)"}
  success: {bg: "oklch(55% 0.18 145)", fg: "oklch(98% 0 0)"}
```

### Primitive Layer (atomic UI elements)
```yaml
# design/primitives/button.yaml
button:
  primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{radius.md}"
    padding: "{spacing.sm} {spacing.md}"
    typography: "{typography.body}"
  primary-hover:
    backgroundColor: "{colors.primary} @ 0.9"
  ghost:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    border: "1px solid {colors.primary}"
```

### Block Layer (composed primitives)
```yaml
# design/blocks/hero.yaml
hero:
  template: "single-column"
  slots:
    eyebrow: {type: "text", typography: "{typography.caption}", color: "{roles.muted.fg}"}
    headline: {type: "text", typography: "{typography.display}", color: "{roles.emphasis.fg}"}
    subhead: {type: "text", typography: "{typography.title}", color: "{roles.neutral.fg}"}
    cta: {type: "button", variant: "primary"}
    secondary-cta: {type: "button", variant: "ghost", optional: true}
```

### Template Layer (layout structures)
```yaml
# design/templates/single-column.yaml
single-column:
  layout: "flex-col"
  gap: "{spacing.lg}"
  max-width: "720px"
  padding: "{spacing.xl}"
  align-items: "center"

# design/templates/dashboard-grid.yaml
dashboard-grid:
  layout: "grid"
  grid-template-columns: "repeat(auto-fit, minmax(280px, 1fr))"
  gap: "{spacing.md}"
  padding: "{spacing.lg}"
```

### Screen Layer (page compositions)
```yaml
# screens/landing.yaml
screen:
  template: "single-column"
  blocks:
    - type: "hero"
      data:
        eyebrow: "Introducing"
        headline: "FSI-FELON Web Builder"
        subhead: "Structured specs, deterministic rendering, dual-mind quality"
        cta: {label: "Start Building", href: "/build"}
    - type: "section"
      data:
        title: "Capabilities"
        body:
          - type: "feature-card"
            data: {icon: "code", title: "Code Gen", desc: "Verified, executable"}
          - type: "feature-card"
            data: {icon: "design", title: "Design System", desc: "Tokens, primitives, blocks"}
```

### Spec Validation (compile-time, before render)
- JSON Schema per template (auto-generated from dictionary)
- Cross-file walkers: role-composition, variant-instance, token-references
- Invalid spec → abort build with exact path; renderer NEVER defensively guards

## Deterministic Renderer (spec → HTML/CSS)

### Architecture
```
spec/tokens/*.yaml → tokens-to-css.js → CSS custom properties
spec/primitives/*.yaml → primitive renderer → HTML snippets
spec/blocks/*.yaml → block renderer → composed HTML
spec/templates/*.yaml → template renderer → layout wrapper
spec/screens/*.yaml → screen renderer → complete HTML page
```

### Renderer Requirements
1. **Single-pass**: No runtime decisions; validated data in → static HTML out
2. **Token resolution**: All `{token.ref}` resolved to CSS custom properties
3. **No per-screen CSS overrides**: Change one token/block → propagates everywhere
4. **Output**: Standalone HTML per screen + storyboard (all screens at 1366px) + CSS bundle
5. **No JS framework, no hydration, no bundler** — plain HTML + static CSS
6. **Build time**: ~200ms for 4 screens (yamleer benchmark)

### CSS Output (tokens-to-css.js)
```css
:root {
  --color-primary: oklch(62% 0.18 250);
  --color-on-primary: oklch(98% 0 0);
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  /* ... all tokens as CSS custom properties */
}

.btn-primary {
  background-color: var(--color-primary);
  color: var(--color-on-primary);
  border-radius: var(--radius-md);
  padding: var(--spacing-sm) var(--spacing-md);
  font: var(--typography-body);
}
```

## Design Scorer (deterministic layout metrics)

### Scoring Dimensions (0-100 each, weighted composite)
| Metric | Weight | Measurement | Pass Threshold |
|--------|--------|-------------|----------------|
| **Contrast** | 20% | WCAG AA (4.5:1) on all text/bg pairs | 100% pass |
| **Spacing Consistency** | 15% | 8px grid adherence (values % 8px == 0) | ≥95% on grid |
| **Type Hierarchy** | 15% | Heading progression (display > headline > title > body > caption) | Strict monotonic |
| **Palette Harmony** | 15% | OKLCH hue coherence; role mappings valid | No orphaned tokens |
| **Visual Balance** | 15% | Layout symmetry, whitespace distribution | Centered ±5% |
| **Novelty** | 10% | Distance from curated design DB (cosine on token vectors) | ≥0.3 from nearest |
| **Accessibility** | 10% | Semantic HTML, focus states, alt text, heading levels | 100% pass |

### Novelty Reference DB
- Curated design corpus (yamleer screens + WebGen-V + manual)
- Token vectors = flattened design tokens (colors, spacing, type, radius)
- Distance = 1 - cosine_similarity(spec_tokens, nearest_db_spec)
- **Curated DB = distance references for novelty, NOT output templates**

### Scorer Output
```json
{
  "spec_id": "landing_v3",
  "scores": {"contrast": 100, "spacing": 97, "type": 100, "palette": 95, "balance": 92, "novelty": 0.41, "a11y": 100},
  "composite": 94.3,
  "pass": true,
  "violations": [],
  "novelty_nearest": "dashboard_v2",
  "novelty_distance": 0.41
}
```

## Dual-Mind Closed Loop

### Spock (Proposer) — Structured, Logical
- Generates spec from requirements
- Follows token/primitive/block/template hierarchy
- Optimizes for design rules (grid, hierarchy, contrast)
- Output: Validated spec YAML

### Sheldon (Critic) — Adversarial, Precise
- Runs design scorer on Spock's spec
- Flags violations with exact metric + location
- Checks novelty against DB (rejects if <0.3)
- Checks accessibility (WCAG, semantic HTML)
- Output: Violation list + suggested fixes

### Debate Gate (Resolver)
- If violations = 0 AND novelty ≥ 0.3 → **ACCEPT**
- If violations > 0 → Spock revises (max 3 iterations)
- If novelty < 0.3 → Spock explores new token combinations
- If iterations exhausted → **REJECT** (log for human review)

### Loop Implementation
```python
for iteration in range(3):
    spec = spock_propose(requirements, previous_feedback)
    violations = sheldon_critique(spec)
    if not violations and novelty(spec) >= 0.3:
        return ACCEPT, spec
    feedback = format_feedback(violations, novelty)
return REJECT, spec
```

## GRPO Reward (for website tasks)
```
reward = 0.4 * composite_score + 0.3 * novelty + 0.2 * format_parse_rate + 0.1 * render_success
```
- Only verified specs (parseable + rendered + scored) enter reward buffer
- Self-correction iterations produce training pairs (rejected → accepted)

## Curriculum (web-builder skill)
1. Single-section specs (hero, card, feature-list)
2. Multi-section pages (landing, dashboard, settings)
3. Full page kinds (e-commerce, blog, docs, app)
4. Novelty pressure (distance from DB increases per epoch)

## Expected Bugs / Issues
- **Token reference cycles**: A references B references A — walker catches at validate
- **CSS custom property fallback**: Unresolved token → renderer must fail, not fallback
- **Novelty false positives**: Spec looks novel but is trivial variation — DB must have sufficient diversity
- **Renderer/spec version drift** — Schema version in spec; renderer asserts match
- **Sheldon over-constraining** — Debate gate max iterations prevents infinite loop

## Dependencies
- web-builder skill (locked design decision)
- dual-mind-reasoning-traces (Spock/Sheldon trace format)
- DESIGN.md format (Google spec) for token interoperability
- Requires: `pyyaml`, `jsonschema`, `oklch` color parser, `css-variables` resolver

## Threat Matrix
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Spec validator too strict (blocks valid designs) | MEDIUM | HIGH | Reality-check log (vocabulary-gaps.md); gap = formal "spec didn't cover this" |
| Novelty DB contamination (eval leak) | LOW | CRITICAL | DB = curated designs ONLY; no generated specs in DB |
| Renderer produces invalid HTML | LOW | HIGH | Validator runs FIRST; renderer trusts validated data |
| Dual-mind loop non-termination | LOW | MEDIUM | Max 3 iterations hard-coded; REJECT on exhaustion |
| Token format mismatch (OKLCH vs hex) | MEDIUM | MEDIUM | Normalize to OKLCH at token layer; renderer uses CSS custom properties |

## When Done
Mark spec/renderer/scorer complete in AGENT_NOTES with: schema version, token count, primitive/block/template/screen counts, scorer composite on validation set, dual-mind accept/reject rates, and GRPO reward calibration.