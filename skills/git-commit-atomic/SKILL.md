---
name: git-commit-atomic
version: 1.0.0
category: release
applies_to:
  - commit
  - atomic commit
  - commit message
  - conventional commit
tools_required:
  - read_file
  - bash
  - git_diff
sop: |
  1. One commit = one logical change. If the diff touches >1 concern, split.
  2. Run `git status` and `git diff --staged` to see exactly what is in this commit. The diff is the contract.
  3. Write a subject line in the conventional commit format: type(scope): description. Types: feat, fix, refactor, docs, test, chore, build, ci. Scope is the affected area.
  4. Subject is 50 chars or fewer, present tense, no trailing period, no emoji.
  5. Body explains the WHY, not the WHAT. "This restructures X because Y, which was the cause of Z." The diff already shows the WHAT.
  6. Body includes: the problem, the fix's high level shape, the failure mode it prevents, the citation. If the body exceeds 5 sentences, the commit is doing too much.
  7. Add the "Assisted-by: AIDE" trailer. The operator's name appears in the Author. The trailer records that the model helped.
  8. Run `git commit` with the prepared message. Capture the SHA and trajectory.
description: |
  Atomic commits with conventional commit messages. One commit = one
  concern. Subject <= 50 chars in conventional format. Body explains the
  WHY, cites the source, lists the failure mode the fix prevents.
  Sources: Conventional Commits 1.0.0 spec (conventionalcommits.org,
  primary), Arie van Bennekum's original commit-discipline essay
  (cited in the spec), Linus Torvalds on atomic commit design (lkml,
  primary), The Pragmatic Programmer's "Source Code Control" chapter.
failure_modes:
  - condition: diff touches more than 1 logical concern
    recovery: split into multiple commits before pushing
  - condition: subject exceeds 50 chars or has trailing period
    recovery: rewrite shorter; the subject is the headline, the body is the article
  - condition: body re-states the diff instead of explaining why
    recovery: rewrite to explain the why, not the what; the diff already shows the what
  - condition: commit is missing the "Assisted-by: AIDE" trailer
    recovery: amend the commit (or fix the alias) before pushing
success_metrics:
  - atomic-commit-rate: 100% of commits touch one concern
  - subject-conformance: 100% of subject lines <= 50 chars, conventional format
  - body-density: 100% of non-trivial commits include a why-not-what body
  - trailer-presence: 100% of operator-approved commits include "Assisted-by: AIDE"
---

# Git Commit Atomic

One commit = one concern. Conventional commit message. Subject <= 50
chars. Body explains the why, not the what. Citation in the body. Trailer
records that the model helped.

## Why this exists

Four primary sources ground this skill:

1. **Conventional Commits 1.0.0 spec** (conventionalcommits.org, primary):
   the type(scope): subject format is a contract; it makes the git
   log machine-parseable. AIDE's orchestrator reads the type to route
   work.

2. **Arie van Bennekum's commit-discipline essay** (cited in the
   Conventional Commits spec, primary): atomic commits are a
   prerequisite for code review, bisecting, and reverting. A 200-line
   diff in a single commit is not atomic.

3. **Linus Torvalds on atomic commit design** (lkml archives,
   primary): the commit is the unit of change; the unit of review; the
   unit of revert. Make the unit small, atomic, and the rest follows.

4. **The Pragmatic Programmer's "Source Code Control"** (canonical):
   commit often, commit early, commit in small units. Every commit
   tells a single story.

## The 8 steps

1. **One concern.** Diff touches one logical change.
2. **Inspect the diff** with `git status` and `git diff --staged`.
3. **Subject** in conventional format: `type(scope): description`.
4. **50 chars or fewer**, present tense, no trailing period.
5. **Body** explains the WHY, not the WHAT.
6. **Body citations** include: the problem, the fix, the failure mode
   it prevents, the citation.
7. **Trailer** is `Assisted-by: AIDE`.
8. **Commit**, capture the SHA, record the trajectory.

## Integration

- The `minimal-diff` SOP (L0): this skill produces commits that are
  minimal-diff-friendly. One concern = small diff.
- The `cite-the-source` SOP (L0): this skill's body always cites.
- The `developer-credo` (L0.5): commit messages are part of the
  operator's contract with the codebase. Misleading commit messages
  violate the credo.
- The `track-and-persist` SOP (L0): every commit SHA is a trajectory
  entry.
