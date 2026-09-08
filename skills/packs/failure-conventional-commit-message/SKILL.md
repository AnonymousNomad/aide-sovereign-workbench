---
name: failure-conventional-commit-message
description: Prevent commit-msg hook failures caused by missing Conventional Commit scopes. Use whenever a repository commit hook requires type(scope): description.
---

# Scoped Conventional Commit

Use the repository's required form:

```text
type(scope): description
```

The AIDE hook requires a scope and a description of at least 10 characters.
Examples: `fix(ci): remove the blocking type errors` or
`feat(packaging): stage the verified runtime stack`.

If a commit is rejected, do not amend a nonexistent commit and do not alter the
staged file set. Record the hook output, choose a compliant message, inspect the
staged diff again, and create a new commit attempt.
