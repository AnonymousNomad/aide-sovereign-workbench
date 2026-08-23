---
name: developer-discipline-engineering
description: Applies the Mandalorian creed-like discipline and philosophy to development engineering. Teaches how to translate the 'Way of the Developer' principles into development practice, verification-first mindset, and continuous discipline throughout the development lifecycle.
---

# Developer Discipline Engineering

## Mission

Teach developers to embody the Mandalorian creed-like discipline: rigorous verification before claiming, armor as code, never removing the helmet (train is serve), releases raised right, and following the Way with surgical precision. This skill translates the Mandalorian philosophy of discipline, honor, and continuous improvement to modern software engineering practice.

## The Mandalorian-Discipline Engineering Framework

### 1. **The Creed Translation**

**Mandalorian Analogy:** The Mandalorian creed focuses on:
- Training and preparation before action
- Protection of the group
- Never removing the helmet (never compromise training)
- Honor and discipline in all actions

**Development Translation:**
- **Never speak unless you know** → Verify before claiming, never ship unverified code
- **Armor is the code** → Security by default, defensive programming, protect user data
- **Helmet never comes off** → Train is serve, byte-exact formats, deterministic builds
- **Foundling raised right** → Every build parsed, scored, gate-checked before shipping
- **Language is the craft** → Byte-exact formats, one true way, precision in output
- **Work answers the call** → SOP is the call, follow procedures exactly every time

### 2. **The Discipline Pipeline**

**Stage 1: Training the Discipline**
- Every developer learns the Creed as a system constant in every prompt
- Daily verification: Ask "Is this verified? Is this gate-passed? Is this safe?"
- Never speak without verification (never ship unverified)
- The armor is your code: defensive by default, secure, validated

**Stage 2: Living the Discipline**
- Never remove the helmet: Keep training and serving identical
- Foundling raised right: Every build checked, scored, verified
- Language is the craft: Precision in every output, exact formats

**Stage 3: Advancing the Discipline**
- Work answers the call: SOP is the call, follow it exactly
- Continuous self-improvement through verification
- Guardrails baked into the system, not external rules

### 3. **The Developer Creed Application**

**Principle 1: Verification-First Mindset**
```
// BEFORE writing code: Ask the verification questions
Is this verified? Will this pass the gate?
Do I know this result? Have I tested it?
Will this ship? Is this production-ready?

// DURING development: Never claim without verification
if !is_verified(output) {
    self_correct();
    return_to_verifying_questions();
}
```

**Principle 2: Armor as Code**
```
// Defensive by default
def process(user_input) {
    // Validate, sanitize, never trust user input
    sanitize_input(user_input);
    validate_bounds(user_input);
    audit_changes(user_input);
    
    // Never emit credentials/secrets
    if contains_secrets(user_input) {
        reject_with_error("Security violation");
    }
    
    // The user's data is the honor of the build
    protect_user_data(user_input);
}
```

**Principle 3: Helmet Never Comes Off**
```
// Training and serving are identical
function train_model() {
    // Build with exact same process as serving
    spec = build_from_verified_brief();
    model = train_on_verified_data();
    return model;
}

function serve_model() {
    // Use exact same logic, no drift
    spec = same_build_process();
    html = same_render_process();
    return html;
}
```

**Principle 4: Foundling Raised Right**
```
// Every build is checked, scored, verified
function build_and_release(feature) {
    // Phase 1: Build
    spec = create_spec(feature);
    html = render_spec(spec);
    
    // Phase 2: Check and score
    scores = score_spec(spec, html);
    if !scores.passes_threshold() {
        return rebuild_with_better_spec();
    }
    
    // Phase 3: Gate check
    if !gate_check(spec, scores) {
        return self_correct_and_retry();
    }
    
    // Phase 4: Release (only if everything is verified)
    return ship_to_production(spec, html);
}
```

**Principle 5: Language is the Craft**
```
// Byte-exact formats, one true way to answer
function emit_output(format_spec) {
    // Exact format, no variation
    output = format_to_canonical(format_spec);
    
    // Precision is identity
    validate_exact_output(output, format_spec);
    
    // One true way to answer
    enforce_single_solution(format_spec);
}
```

**Principle 6: Work Answers the Call**
```
// SOP is the call, follow it exactly
function work_on_task(task) {
    // Answer the verifying questions first
    verify_before_claiming(task);
    
    // Follow the SOP the same way, every time
    follow_sop_exactly(task);
    
    // Every build answers the same way
    return consistent_solution(task);
}
```

### 4. **The Discipline Tools**

**The Credo Engine**
- Prompt injection: The Creed is the constant opening of every prompt
- Weight training: Every corpus document carries the Creed
- Deterministic judge: The SOP gate enforces the Creed
- Reward signal: DPO pairs where chosen walks the Way
- Self-correction: Report violations and re-answer verifying questions

**The SOP Circuit Breaker**
```
function credo_enforcer(prompt) {
    // The Creed is the constant opening
    prompt = prepend_creed(prompt);
    
    // SOP gate: deterministic judge
    if !sop_gate(prompt) {
        // Creed violation - self-correct
        report_violations(prompt);
        return self_correct_and_retry();
    }
    
    // Success - The Way is walked
    return success_with_creed_compliance();
}
```

**The Verification Harness**
- Ask the verifying questions BEFORE generating any spec
- Never guess an answer that the questions would reveal
- Build the design spec from confirmed answers only
- Nothing ships unless it parses, scores, and complies

### 5. **Applying Discipline to Development**

**Code Review as Discipline Training**
```
function review_code_pull_request(pr) {
    // Mandalorian-style code review:
    // 1. Check if the developer knows what they're claiming
    // 2. Verify the armor (security)
    // 3. Check if helmet came off (train is serve)
    // 4. See if foundling was raised right (quality)
    // 5. Verify language is the craft (precision)
    // 6. Check if work answers the call (SOP compliance)
    
    const creed_checks = [
        has_verification(pr.claims),
        is_secure(pr.code),
        train_is_serve(pr.build),
        is_verified(pr.output),
        is_exact(pr.format),
        follows_sop(pr.process)
    ];
    
    if all(creed_checks) {
        return approve_with_honor("This developer walks the Way");
    } else {
        return require_self_correction(creed_checks);
    }
}
```

**Testing as Discipline Practice**
```
// Every claim is tested before it's spoken
function test_before_claiming(code) {
    // Defensive testing - never trust what you don't verify
    const test_cases = generate_edge_cases(code);
    const security_tests = audit_security_implications(code);
    const performance_tests = benchmark_performance(code);
    
    // If any test fails, self-correct
    if test_cases.fail() {
        self_correct_test_cases();
    }
    if security_tests.fail() {
        self_correct_security();
    }
    
    // Only after all tests pass, claim the result
    return tested_and_verified(code);
}
```

**Documentation as Discipline Code**
```
// Document the Credo in every project
const project_credo = {
    // The Creed is the contract
    creed: "THE WAY OF THE DEVELOPER — THE CREED (v1.0)",
    
    // Discipline rules
    rules: [
        "A developer does not speak unless they know",
        "The armor is the code",
        "The helmet never comes off",
        "Every release is a foundling raised right",
        "The language is the craft",
        "The work answers the call"
    ],
    
    // Application to every build
    apply_to_every_build: true,
    
    // Enforcement layers
    enforcement: {
        prompt: "The Creed is the constant opening of every prompt",
        weights: "Every corpus document carries the Creed",
        judge: "The SOP gate enforces the Creed's verdict",
        reward: "DPO pairs teach the model to prefer the Way"
    },
    
    // The affirmation
    affirmation: "This is the way.",
    
    // Only when 100% verified
    affirmation_only_when: "build accepted by gate, check green, format byte-exact"
};
```

### 6. **The Discipline Lifecycle**

**Day 1: Training the Discipline**
- Learn the Creed: "THE WAY OF THE DEVELOPER"
- Never speak without verification
- Armor is your code
- Helmet never comes off
- Foundling raised right
- Language is the craft
- Work answers the call

**Day 30: Living the Discipline**
- Apply Creed to every PR review
- Build verification into your workflow
- Use SOP as your guide
- Self-correct on Creed violations

**Day 90: Advancing the Discipline**
- Teach the Creed to junior developers
- Build Credo tools for your team
- Mentor through Discipline challenges

**Every Day: The Discipline Loop**
```
function daily_discipline_routine() {
    // Morning: Review the Creed
    morning_creed_review();
    
    // All day: Apply Discipline
    while (is_working) {
        // Before any claim, verify
        if (about_to_make_claim) {
            if (!is_verified(claim)) {
                self_correct();
                continue;
            }
        }
        
        // Armor the code
        if (writing_code) {
            secure_code();
            protect_data();
        }
        
        // Never remove helmet
        if (working_on_build) {
            ensure_train_is_serve();
        }
        
        // Check everything
        if (releasing_product) {
            gate_check();
            self_correct_if_needed();
        }
    }
}
```

## How to Use This Skill

**When to Apply:**
- When building any development workflow or process
- When training developers on best practices
- When creating tools that enforce discipline
- When auditing code quality and security

**Practical Applications:**
1. **Code Review Guidelines**: Create review checklists based on the Creed
2. **Testing Strategy**: Build verification into development workflow
3. **Security Implementation**: Armor your code by default
4. **Training Materials**: Teach new developers the Discipline mindset
5. **Process Documentation**: Create SOPs that enforce the Creed

**Development Tools Built with This Skill:**
- Credo validation tools
- SOP enforcement circuits
- Verification harnesses
- Self-correction systems
- Quality assurance pipelines

The Developer Discipline Engineering skill transforms the Mandalorian philosophy of discipline, honor, and verification into a practical, systematic approach to software engineering. It teaches developers to always verify before claiming, armor their code, never compromise training/serving parity, and follow procedures exactly — every time.

Base directory for this skill: C:\Users\Grey_\.agents\skills\developer-discipline-engineering
Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.
Note: file list is sampled.

<skill_files>

</skill_files>
