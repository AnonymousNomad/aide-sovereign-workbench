---
name: failure-powershell-foreach-pipeline
description: Prevent PowerShell parser failures when checking a list with foreach and piping its output. Use whenever a verification command reports an empty pipe element around a foreach statement.
---

# PowerShell Foreach Pipeline

PowerShell `foreach (...) { ... }` is a statement and cannot be directly used as
the left side of a pipeline in the command form used here. Collect output first:

```powershell
$rows = foreach ($item in $items) {
  [pscustomobject]@{ Path = $item; Exists = Test-Path -LiteralPath $item }
}
$rows | Format-Table -AutoSize
```

Alternatively use `@(...)` around the loop when the command form permits it.
Before running a verification block, check that every `{` has one matching `}`
and prefer a simple command when the check does not need a loop. Do not
interpret a parser error as evidence about the files or processes being
checked. Fix the command syntax, rerun the same check, and record the result.
