---
name: aide-phase6-tutor-mode
description: Phase 6 SOP for the AIDE offline IDE — hands-on Academy/tutor mode: course catalog, lesson sessions, RUN LESSON CHECK (deterministic gates first), MARK LESSON COMPLETE (server-gated), local completion credentials (digest + limitation). Use whenever wiring the academy/course list, lesson cards, check/complete buttons, certificate generation, or any tutor-mode change in E:\aide-sovereign-workbench.
---

# Phase 6 — Tutor Mode SOP (Academy)

Goal: beginners learn in the offline IDE: pick a course, work through hands-on lessons, pass checks, mark lessons complete, earn a local completion credential — all local, zero cloud. A lesson is only ever marked complete after the server-verified check observed PASS (generate → verify → self-correct → confidence closed loop).

## 1. Research base

| Area | Finding (primary source) | Implication for this feature |
|---|---|---|
| Worked examples | Studying worked examples beats solving equivalent problems for novices: it cuts extraneous working-memory load so capacity goes to schema construction (Sweller 1988, *Cognitive Science*; van Gog/Paas/Sweller 2010, *Educ Psychol Rev*; Atkinson et al. 2000, *Rev Educ Res*). For programming specifically, worked examples + guided self-explanation questions improve retention AND transfer (Chen 2025, ACM TOCE 25(2)). | Lessons are structured objective → short concept → small executable proof → self-explanation prompt (the reflection textarea). New lessons must show a minimal worked example before asking the learner to produce their own. |
| Active recall / retrieval practice | Retrieval practice produces more learning than elaborative restudy (Karpicke & Blunt 2011, *Science* 331(6018)); spacing + retrieval is the strongest supported combination (Carpenter et al. 2022, *Nature Reviews Psychology*). Self-explanation benefits in intro programming: Vihavainen, Miller & Settle 2015 (SIGCSE). | Every lesson ends with the reflection prompt ("explain in your own words") — the self-explanation/retrieval step. RUN LESSON CHECK is the low-stakes test. |
| Verifiable credentials | W3C VC Data Model v2.0: credentials carry claims + issuer + proof; tamper-evidence = any modification changes the digest; verification = re-hash and compare. Open Badges 3.0 (1EdTech, 2024) is a VC with an achievement layer (criteria + evidence). Blockcerts anchors hashes for issuer-independent verification. | The certificate endpoint returns a VC-shaped credential + sha256 digest. The digest is the tamper-evidence: whoever holds the credential JSON can re-hash and compare. The limitation string is mandatory honesty — local credentials are NOT accredited. |
| LLM-as-judge reliability | Rubric-conditioned LLM grading: strong on binary tasks, degrades with rubric granularity; filtering low-confidence predictions improves accuracy; judges can hallucinate a pass — a semantically empty answer "solution" got a 9.6% false-positive pass because the judge reconstructed content from context (arXiv 2601.08843). RAND: the simple single-rubric autograder performs as well or better than complex grading methods (RRA4618-1). Known judge biases: position, verbosity, self-preference, sycophancy. | A small local model must NEVER be the pass/fail authority. Deterministic gates (command exit code, pattern match, AST parse) decide PASS. If a model second opinion is added, it can only confirm or downgrade, with an explicit confidence threshold below which the verdict is "uncertain" — never an automatic pass. |

## 2. Lesson content SOP (course JSON)

Courses live in `E:\aide-sovereign-workbench\academy\courses\*.json` (one file per course). Installed: `python-foundations` (11 lessons), `ml-ai-foundations` (10), `production-engineering` (10).

Course file shape (verified against installed courses):

```json
{
  "id": "python-foundations",
  "title": "Python Foundations: Build a Research Tool",
  "level": "beginner",
  "description": "...",
  "estimated_hours": 24,
  "prerequisites": "...",
  "assessment": "What the credential attests.",
  "lessons": [
    {"id":"variables","title":"Values and Variables","kind":"concept","objective":"Store and inspect a value safely.","check":"python -c \"value = 'claim'; assert value == 'claim'\""}
  ]
}
```

Per-lesson fields: `id` (unique per course), `title`, `kind` (concept | exercise | experiment | project | design | practice | scenario | capstone), `objective` (one sentence, what the learner proves), `check` (allowlisted command — see §3).

Course authoring rules (evidence-based, LIMA/zero-dup lineage):
1. **Objective-first.** Every lesson objective is a verb + verifiable outcome ("Store and inspect a value safely", "Turn repeated work into a reusable function"). No filler prose.
2. **Sequence simple → complex.** Concept → exercise → project → capstone. Capstone is last and the credential attests the course's `assessment` string.
3. **One skill per lesson.** Each lesson proves exactly one objective with one small check. Split, don't stack.
4. **Worked example in the objective/title.** The lesson card shows objective + a static tutor prompt; the IDE workspace is where the learner builds. Keep each lesson short enough to finish in one session.
5. **The check is the lesson.** If the check command is trivial (`assert 1+1==2`), the lesson is trivial — every check must actually exercise the objective it claims. Audit existing courses: several checks in `ml-ai-foundations` and `production-engineering` are placeholders (e.g. `assert 2 * 3 + 1 == 7`, `console.log('measure-not-guess')`) — see [TODO] below.
6. **Reflection is required practice, not optional decoration.** The UI always shows the reflection textarea; `complete` stores it (sliced to 1000 chars) and the credential records `reflections_recorded`.

## 3. Lesson check SOP (deterministic gates first — NEVER auto-pass)

Current implementation (`academy/tutor-manager.mjs` `check()`): the check is a **fixed, allowlisted command** from the course JSON, executed by the daemon:

- Allowlist regex: `^(python3?|node|git)\s+(-c|-e|--version)(?:\s+([\s\S]*))?$` — anything else throws "lesson check is not a supported allowlisted command".
- Python resolution order: `AIDE_PYTHON` env (if set) → `py -3` (Windows) → `python3` → `python` as written → `python3` fallback on Windows. On this host plain `python` is the Windows Store stub — **always run tests with `AIDE_PYTHON` set** (see §7).
- Timeout 30 s, maxBuffer 64 KB. Exit code 0 → `passed: true` with stdout/stderr; non-zero → `passed: false`. Interpreter ENOENT/9009/"Python was not found" is skipped as "unavailable" and the next candidate tried; if all fail → `passed: false`.
- `#recordCheck` persists `last_check = {lessonId, passed, stdout, stderr, checked_at}` to `academy-progress.json` (atomic tmp-file + rename), then returns `{lesson, passed, stdout, stderr}`.
- **No submission is read**: the check runs the lesson's own command; workspace files are not parsed. So the deterministic gate is the command's exit code, not the learner's file contents.

Gate ladder (this is the doctrine; deterministic first, model last):
1. **Exact/pattern match or command exit code** (implemented) — the assertion inside the `-c`/`-e` payload decides PASS/FAIL. This is the strongest, cheapest, zero-false-positive gate.
2. **AST parse of submitted code** — [TODO] if a lesson must grade a learner-written file: parse the file (`python -c "import ast; ast.parse(open('x.py').read())"`-style, or a node `vm` check) and assert structural properties (function exists, no `eval`, imports allowlisted). Must run inside the allowlisted-command harness, never raw.
3. **Local-model second opinion (optional, never the pass authority)** — [TODO]. If a model scores a reflection or open-ended answer: deterministic gates must already have passed; the model can only **downgrade PASS → "review" or "fail"**, never grant one. Require an explicit confidence threshold (e.g. only trust the verdict when self-reported confidence ≥ 0.9; below that, return `passed: false` + "ask a human" feedback). Evidence: rubric-conditioned judges hallucinate passes on empty answers (9.6% FPR, arXiv 2601.08843); trust-curve filtering (drop low-confidence verdicts) measurably improves accuracy. Never let a small model auto-pass anything.

## 4. Progress + credential SOP

### 4.1 Progress file — `.aide/academy-progress.json` (verified live shape)

```json
{
  "python-foundations": {
    "completed": ["variables"],
    "current": "control-flow",
    "last_check": {"lessonId": "variables", "passed": true, "stdout": "...", "stderr": "", "checked_at": "2026-08-13T23:41:39.578Z"},
    "last_reflection": "I can name a value.",
    "updated_at": "2026-08-13T23:41:40.000Z"
  }
}
```

- `completed`: lesson ids whose check passed AND were marked complete. `current`: lesson id the session resumes at.
- `last_check`: written by every `check` call (pass or fail). `complete()` REQUIRES `progress.last_check?.lessonId === lessonId && progress.last_check.passed === true` — **server-side gate, cannot be bypassed from the UI**.
- `last_reflection` + `updated_at` are written by `complete()` (reflection sliced to 1000 chars).
- Writes are atomic: write to `<path>.tmp` then rename. Never edit the file while the daemon runs.
- Location: `path.join(WORKSPACE, '.aide', 'academy-progress.json')` (STATE_DIR = workspace `.aide`). Progress is per-workspace, not per-course-file.

### 4.2 Certificate endpoint — `GET /api/academy/certificate?course=<id>` (verified response shape)

Server logic (`TutorManager.certificate`): throws unless EVERY lesson in the course is in `progress.completed`; then builds:

```json
{
  "credential": {
    "type": ["VerifiableCredential", "AIDECompletionCredential"],
    "issuer": "AIDE local issuer (unaccredited)",
    "issuanceDate": "2026-08-13T23:41:39.578Z",
    "credentialSubject": {"course_id": "...", "course_title": "...", "lessons_completed": 11, "assessment": "..."},
    "evidence": {"completed_lesson_ids": ["..."], "reflections_recorded": true},
    "status": "locally-verifiable-unaccredited"
  },
  "digest": "sha256(JSON.stringify(credential)) hex",
  "limitation": "This local credential is not an accredited professional certification and has no employer recognition unless an independent issuer accepts it."
}
```

- **Digest chain / tamper-evidence:** `digest` = `crypto.createHash('sha256').update(JSON.stringify(credential)).digest('hex')`. Verification = re-hash the credential JSON and compare. Any edit to the credential (title, lessons count, dates, evidence) changes the digest → tamper-evident, W3C VC style. The digest is NOT stored anywhere yet — it is recomputed per request, so a fresh request to the same course state yields the same digest; if progress changes, digest changes. [TODO] persist issued credentials (credential + digest + issuanceDate) under `.aide/credentials/<course>-<digest>.json` so a held credential can be verified later against the recorded digest.
- **Limitation text is mandatory.** It ships in every certificate response and the UI appends it to the ACADEMY log. Never omit or soften it — local completion credentials are honest evidence artifacts, not accredited certification.
- No `userName` is accepted — credentials are course-scoped, not person-scoped. [TODO] if per-person credentials are wanted, add a `userName` param and include it in `credentialSubject` (would change the digest — that is the point).

## 5. Exact daemon API contract (verified from `daemon/server.mjs`)

Base: `http://127.0.0.1:4777` (override `AIDE_DAEMON_PORT`). CORS allows `http://127.0.0.1:4173`. Errors return non-200 with `{error}`.

| Route | Method | Request | Response (verified) |
|---|---|---|---|
| `/api/academy` | GET | — | `{courses:[course + progress]}`; `progress` = `{completed:[], current, eligible_for_certificate}` (true only when ALL lessons completed) |
| `/api/academy/session` | GET | `?course=<id>` (optional; defaults to first installed course) | `{course:{id,title,level}, lesson:{...full lesson...}, progress, next:{lesson}|null}` — `lesson` = the incomplete lesson at `progress.current` (or first), `next` = first incomplete lesson |
| `/api/academy/check` | POST | `{courseId, lessonId}` | `{lesson, passed, stdout, stderr}` |
| `/api/academy/complete` | POST | `{courseId, lessonId, reflection?}` | updated `session()` object; throws unless `last_check` for that lesson is `passed: true` |
| `/api/academy/certificate` | GET | `?course=<id>` | `{credential, digest, limitation}` (see §4.2); throws unless all lessons complete |

**[TODO] gaps vs the original design doc:**
- `GET /api/academy/lesson?id=` — NOT implemented (session route covers the current lesson). Do not add unless lesson-by-id navigation (prev/next, jump) is wanted.
- `POST /api/academy/credential {courseId, userName}` — NOT implemented; certificate is a GET, no userName, and **no credential file is written** (JSON response only — the old skill's "writes certificate file, returns path + checksum" is wrong for the current code).
- `check` accepts no `submission` — workspace files are not graded. Submission-based checks (AST-parse) are the [TODO] path for real project lessons.
- No model second opinion, no confidence threshold, no hint endpoint (`lesson-hint` is static frontend text), no spaced-repetition/review scheduling.
- Several installed course checks are placeholder assertions (see §2 rule 5) — audit and replace with checks that genuinely exercise each objective.

## 6. UI wiring SOP (verified from `app.js` + `index.html`)

State: `academyState = {catalog: [], session: null}` (app.js:921).

- **View switching:** `#learn-button` toggles `setWorkbenchView('learn')` (shows `#learn-view` overlay, adds `body.workbench-view-learn` + `simple-mode`) vs back to chat. `setWorkbenchView` hides `#learn-view` unless view === 'learn' (app.js:1043-1049). Course list + lesson card live INSIDE `#learn-view` — no page scroll, no layout change (phase-2 contract).
- **On LEARN click → `loadAcademy()`**: `GET /api/academy` → `academyState.catalog` → `renderAcademy()` → `loadAcademySession(catalog[0].id)`. On failure: `appendLog('TUTOR', ...)` warning; card keeps "Start the local daemon to load your course."
- **`renderAcademy()`**: renders `#course-list` as `<h4>COURSES / LOCAL CATALOG</h4>` + one `<button class="course-item" data-course-id>` per course showing title, level, and `done/total` from `course.progress.completed.length`. Active course gets `.active`. Click → `loadAcademySession(id)`. Then fills the lesson card: `#lesson-kicker` (COURSE / KIND), `#lesson-title`, `#lesson-objective`, static `#tutor-prompt-text`, `#lesson-progress` ("N lesson(s) complete. Next gate: ..."), and `#certificate-button.hidden = !session.progress.eligible_for_certificate`.
- **RUN LESSON CHECK → `checkLesson()`**: disables button, "Running check...", `POST /api/academy/check {courseId, lessonId}` → `#lesson-check-result` = `PASS\n<stdout>` or `FAIL\n<stderr>`; `#lesson-complete.disabled = !result.passed`. Errors → `ERROR\n<message>`. Re-enables button in `finally`.
- **MARK LESSON COMPLETE → `completeLesson()`**: `POST /api/academy/complete {courseId, lessonId, reflection: $('#lesson-reflection').value}` → replaces `academyState.session` with returned session, clears the reflection textarea, `appendLog('TUTOR', 'Lesson complete. Next: ...')`, re-renders. Server rejects if last check didn't pass — the UI gate (`disabled`) is a convenience, not the security boundary.
- **ISSUE LOCAL CREDENTIAL → `#certificate-button`**: `GET /api/academy/certificate?course=...` → `appendLog('ACADEMY', 'Local completion credential issued: <digest>. <limitation>', 'approved')`; error → warning log. Button is `hidden` until `eligible_for_certificate`.
- **GIVE ME A HINT → `#lesson-hint`**: static progressive hint text; no daemon call.

## 7. Verification gates (run these before claiming tutor mode works)

1. **Unit:** `node academy/test-tutor-manager.mjs` — full flow: load 3 courses, session resume, check+complete all 11 python-foundations lessons (order shuffled), certificate `lessons_completed === 11`. **Must run with `AIDE_PYTHON` set on this host** (e.g. `AIDE_PYTHON=E:\Python310\python.exe`) or the Windows Store stub breaks every python check (RESEARCH_LOG 2026-08-12 finding).
2. **Live HTTP (real daemon):** `node scripts/acceptance-real.mjs` — boots the daemon on port 4893 with a temp workspace and asserts `/api/academy` (3 courses), `/api/academy/check` (variables → passed true), `/api/academy/complete` (server accepts, progress contains 'variables').
3. **Full suite:** `npm test` (includes the tutor test, acceptance-real, e2e, ui-audit, view-switch contract).
4. **UI audit:** `node scripts/ui-audit.mjs` — all referenced ids incl. academy ids resolve.
5. **Manual curl smoke** (daemon on 4777):
   - `curl http://127.0.0.1:4777/api/academy` → courses with progress + eligible_for_certificate
   - `curl http://127.0.0.1:4777/api/academy/session?course=python-foundations` → lesson + next
   - `curl -X POST -H "Content-Type: application/json" -d '{"courseId":"python-foundations","lessonId":"variables"}' http://127.0.0.1:4777/api/academy/check` → passed true
   - `curl "http://127.0.0.1:4777/api/academy/certificate?course=python-foundations"` → 500 until all lessons complete; then `{credential, digest, limitation}`
   - Negative gate: `POST /api/academy/complete` for an un-checked lesson → non-200 with error message.
6. **Visual:** open the IDE (daemon running), LEARN → course list renders, lesson card shows objective; complete a lesson → progress text updates; after all lessons → ISSUE LOCAL CREDENTIAL appears and the ACADEMY log shows the digest + limitation.

## 8. Audit checklist

- [ ] Every installed lesson's `check` genuinely exercises its objective (no `assert 1+1==2` placeholders) — placeholder audit is [TODO].
- [ ] `complete` is impossible without a fresh `last_check.passed === true` for that exact lesson (server-side; verify with a negative curl).
- [ ] Progress JSON survives daemon restarts; atomic tmp+rename writes; `.aide/academy-progress.json` matches §4.1 shape.
- [ ] Certificate requires ALL lessons completed; response always carries `digest` + full `limitation` text.
- [ ] Digest changes if credential contents change (tamper-evidence) — sanity-check by re-hashing the JSON.
- [ ] No model ever auto-passes: if a model scorer is added, it only downgrades, with an explicit confidence threshold (§3 gate ladder).
- [ ] UI: check button disables during run; complete button disabled until PASS; certificate button hidden until eligible; logs carry digest + limitation.
- [ ] All tests in §7 pass; `AIDE_PYTHON` documented for this host.

## 9. Sources

- Sweller, J. (1988). Cognitive Load During Problem Solving: Effects on Learning. *Cognitive Science* 12(2), 257–285. https://doi.org/10.1207/s15516709cog1202_4
- van Gog, T., Paas, F. & Sweller, J. (2010). Cognitive Load Theory: Advances in Research on Worked Examples, Animations, and Cognitive Load Measurement. *Educational Psychology Review* 22, 375–378. https://doi.org/10.1007/s10648-010-9145-4
- Atkinson, R.K., Derry, S.J., Renkl, A. & Wortham, D. (2000). Learning from Examples: Instructional Principles from the Worked Examples Research. *Review of Educational Research* 70(2), 181–214. https://doi.org/10.3102/00346543070002181
- Chen, C.-Y. (2025). Effects of Worked Examples with Explanation Types and Learner Motivation on Cognitive Load and Programming Problem-Solving Performance. *ACM TOCE* 25(2). https://dl.acm.org/doi/10.1145/3732791
- Karpicke, J.D. & Blunt, J.R. (2011). Retrieval Practice Produces More Learning than Elaborative Studying with Concept Mapping. *Science* 331(6018), 772–775. https://pubmed.ncbi.nlm.nih.gov/21252317/
- Carpenter, S.K., Pan, S.C. & Butler, A.C. (2022). The science of effective learning with spacing and retrieval practice. *Nature Reviews Psychology* 1, 496–511. https://www.nature.com/articles/s44159-022-00089-1
- Vihavainen, A., Miller, C.S. & Settle, A. (2015). Benefits of Self-Explanation in Introductory Programming. SIGCSE '15. https://doi.org/10.1145/2676723.2677260
- W3C Verifiable Credentials Data Model v2.0. https://www.w3.org/TR/vc-data-model/ ; Overview: https://www.w3.org/TR/vc-overview/
- 1EdTech Open Badges 3.0 (2024). https://www.pok.tech/en/digital-credentials/open-badge-3-0
- Blockcerts (MIT Media Lab), hash-anchored credentials. https://www.blockcerts.org/
- Deng, H. et al. (2025/2026). Rubric-Conditioned LLM Grading: Alignment, Uncertainty, and Robustness. arXiv:2601.08843. https://arxiv.org/abs/2601.08843
- RAND (2026). Simpler Is Better for Autograders: Toward Cost-Effective LLM Evaluations for Open-Ended Tasks. RRA4618-1. https://www.rand.org/pubs/research_reports/RRA4618-1.html
- RAND (2026). Judge Reliability Harness. TLA4547-1. https://www.rand.org/pubs/tools/TLA4547-1.html
- Repo implementation: `E:\aide-sovereign-workbench\academy\tutor-manager.mjs`, `daemon/server.mjs:202-230`, `app.js:921-1033`, `index.html` (learn-view), `.aide\academy-progress.json`, `academy\courses\*.json`, `academy\test-tutor-manager.mjs`, `scripts\acceptance-real.mjs`, `docs\RESEARCH_LOG.md` (2026-08-12 interpreter finding).