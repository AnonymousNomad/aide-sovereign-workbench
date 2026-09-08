---
name: aid-dap-real-debugpy-fixture
description: Wire in a REAL debugpy fixture for the AIDE DAP test batteries. The tests/arch/dap-contract.test.ts and daemon/test-dap-fixture.mjs read fixtures/debuggee/fizz_engine.py — this skill encodes the VERIFIED recipe (9/9 arch pass plus daemon orphan-check pass) so the next agent can reproduce the green path. Use whenever a DAP fixture test fails, when adding a real-DAP test, when wiring debugpy into the AIDE arch build, or when the DAP release-engineering gate needs to be verified.
---

# DAP Real Debugpy Fixture — VERIFIED Wire-In Recipe

## Status: VERIFIED GREEN (2026-09-03)

`tests/arch/dap-contract.test.ts` — **9/9 tests pass in 8.5s** with the fixture described below. The real debugpy round-trip (`real debugpy adapter round trip on the fizz_engine fixture`) passes in 3.0s against debugpy 1.8.21 on Windows.

## What this skill is

The AIDE arch build has a real-DAP test at `tests/arch/dap-contract.test.ts:326` and a daemon-level fixture test at `daemon/test-dap-fixture.mjs` that read a Python debuggee from `fixtures/debuggee/fizz_engine.py` and run it through debugpy. The fixture was missing. This skill encodes the **exact verified content** of that fixture, the failure modes that cost cycles, the PID marker required for the daemon orphan check, and the wire-in path so both tests stay green.

Primary sources (verified 2026-09-03):
- DAP spec: `https://microsoft.github.io/debug-adapter-protocol/specification`
- DAP overview: `https://microsoft.github.io/debug-adapter-protocol/overview`
- debugpy README: `https://github.com/microsoft/debugpy`
- debugpy quirks: verified via direct probe of debugpy 1.8.21 on this machine (see `aide-arch-protocols` field notes)

## The exact file the test needs (VERIFIED)

**Path**: `E:\aide-sovereign-workbench\fixtures\debuggee\fizz_engine.py`

**The test at line 348 reads:**
```ts
const source = await fs.readFile(path.join(repoRoot, 'fixtures', 'debuggee', 'fizz_engine.py'), 'utf8');
```

**The test resolves the breakpoint lines from markers (line 351-355):**
```ts
const lines = source.split('\n');
const lineOf = (marker: string): number => lines.findIndex(line => line.includes(marker)) + 1;
const first = lineOf('total = sum');
const second = lineOf('print(report)');
assert.ok(first > 0 && second > 0, 'fixture markers must resolve');
```

**`lineOf` uses `.includes()` (SUBSTRING match) and `findIndex` returns the FIRST match.** This is the root cause of 3 of the 5 failure modes below — the docstring, the list-of-dicts, and the comprehension all matched BEFORE the intended code line.

## The VERIFIED fixture content (copy verbatim, 9/9 pass)

```python
#!/usr/bin/env python3

import os
from pathlib import Path


def main():
    Path(__file__).with_name('debuggee.pid').write_text(str(os.getpid()), encoding='ascii')
    engine = build_engine()
    values = [int(x) for x in engine['items'] if x.isdigit()]
    total = sum(values)
    report = {'total': total, 'count': len(engine['items'])}
    print(report)


def build_engine():
    items = [
        '1', '2', 'Fizz', '4', 'Buzz',
        'Fizz', '7', '8', 'Fizz', 'Buzz',
        '11', '10'
    ]
    return {'items': items}


if __name__ == '__main__':
    main()
```

## Why this exact content passes 9/9 (line-by-line against the test)

- **Line 7** `def main():` — entry point. `frame[0]?.name === 'main'` (test line 370) ✓
- **Line 11** `total = sum(values)` — contains the marker `total = sum` (test line 353), is a **simple assignment with no comprehension on the same line** (critical for `next` to report `reason: 'step'` not `'breakpoint'` per debugpy quirk #5 below), is **inside `main()`** (so the frame is `main` not a helper). ✓
- **Line 13** `print(report)` — contains the marker `print(report)` (test line 354), is inside `main()`. ✓
- **The PID marker is written before the first breakpoint** — `daemon/test-dap-fixture.mjs` reads `fixtures/debuggee/debuggee.pid` after disconnect and verifies that PID is no longer alive. ✓
- **No docstring** with the markers (critical — the docstring caused failure mode #1 below).
- **`items` is a flat list of strings** (critical — list-of-dicts caused failure mode #2 below).
- **`items[2]` is `'Fizz'`** (0-based, 3rd item) — test asserts `vars3.some(v => v.name === '02' && v.value === "'Fizz'")` (line 385). ✓
- **Digit-only sum = 1+2+4+7+8+11+10 = 43** — test asserts `total?.value === '43'` (line 404). ✓
- **Standalone run**: `py -3.10 -E <path>` → stdout: `{'total': 43, 'count': 12}` and writes a sibling `debuggee.pid`. Exit 0. ✓

## The 5 failure modes I hit (and how to fix each)

| # | Error message | Root cause | Fix |
|---|---|---|---|
| 1 | `'<module>' !== 'main'` (test line 370) | Docstring at lines 5-6 contained the literal text `total = sum` and `print(report)`. `lineOf` matched the docstring FIRST (line 5/6) not the code (line 22/24). debugpy stopped at the docstring (module level) not inside `main()`. | Remove the docstring OR rewrite it to not contain the markers. The verified fixture has NO docstring. |
| 2 | `'items[2] = Fizz' at depth 3` (test line 385) | `items` was a list of dicts: `[{"name":"1","score":4}, ...]`. `items[2]` was `{"name":"Fizz","score":5}` — a DICT, not the string `'Fizz'`. The test expects a flat list of strings. | Change `items` to a flat list of strings where index 2 is `'Fizz'`. |
| 3 | `'breakpoint' !== 'step'` (test line 390) | `total = sum(int(x) for x in engine['items'] if x.isdigit())` had a generator expression on the same line as the breakpoint. Per debugpy quirk: when a `next` lands in a comprehension frame on the same physical line as a breakpoint, the `stopped` reason is `breakpoint` not `step`. | Split the comprehension into a separate line: `values = [int(x) for x in engine['items'] if x.isdigit()]` then `total = sum(values)`. The breakpoint on `total = sum(values)` is now a simple assignment. |
| 4 | `'compute_total' !== 'main'` (test line 370) | I moved `total = sum(values)` into a helper function `compute_total()`. debugpy stopped inside the helper, so the frame was `compute_total` not `main`. | Keep `total = sum(values)` inside `main()`, not a helper. The test expects `frame[0]?.name === 'main'`. |
| 5 | `'Channel was closed before the response'` (debugpy stderr) | My direct probe killed the child process's stdin before debugpy could respond. NOT a fixture bug — a probe-script bug. | When probing debugpy manually, give it 5-10 seconds to respond before killing. |
| 6 | `pid file check failed: ENOENT` (daemon test line 206) | The daemon-level battery launches the repository fixture directly and requires a PID marker to verify the debuggee was reaped; the original arch-only recipe did not write one. | Keep the `Path(__file__).with_name('debuggee.pid').write_text(...)` line before the first breakpoint. Do not weaken or remove the orphan assertion. |

## The DAP lifecycle the DapManager must enforce (port from aide-arch-protocols)

```
client:start(id)
  → spawn python -m debugpy.adapter   (stdio: pipe, cwd=workspace, shell:false)
  → decoder listens on stdout

client:initialize(id)
  → request: { command: 'initialize', arguments: { adapterID: 'aide', ... } }
  → response.body stored as capabilities
  → wait for 'initialized' EVENT (this comes during launch, not before)

client:launch(id, program, args, cwd)
  → fire-and-forget request: { command: 'launch', arguments: { program, args, cwd, type: 'python' } }
  → DO NOT await the response — debugpy defers it until configurationDone
  → store the launch promise for later await

client:setBreakpoints(id, source, lines)
  → request: { command: 'setBreakpoints', arguments: { source: { path }, breakpoints: [{line}] } }
  → MUST be before launch response resolves

client:configure(id)
  → request: { command: 'configurationDone' }
  → debugpy now sends the launch response

client: await launch → stopped(reason: 'breakpoint', threadId)
  → threads → stackTrace → scopes → variables (nested by variablesReference)
  → continue/next/stepIn/stepOut with threadId from stopped event

client:disconnect(id)
  → request: { command: 'disconnect', arguments: { terminateDebuggee: true } }
  → terminated event arrives
  → adapter status: 'stopped'
```

## Bugs to expect (verified, ported from aide-arch-protocols)

1. **launch→setBreakpoints→configurationDone order is law.** debugpy defers launch response until configurationDone, so awaiting launch first deadlocks (60s timeout). And setBreakpoints BEFORE launch rejects with "Server is not available".
2. **launch `type` must be `'python'`** (adapter's language), not a client id. debugpy rejects unknown types immediately.
3. **dict keys arrive quoted**: `'items'`, `'02'`. Strip `^'|'$` when matching. Plain locals (`engine`, `total`) are unquoted.
4. **Event waiting needs index watermarks**: `stopped` repeats (breakpoint → step → breakpoint). Use `events.slice(watermark).find(...)`, never `events.find(...)`.
5. **Adapter children hold the temp workspace as cwd** → `rmdir` fails EBUSY. Always `manager.stopAll()` before cleanup; retry rmdir on EBUSY with backoff.
6. **Optional contract fields must be OMITTED**, not `undefined` (`message: undefined` breaks `deepStrictEqual`).
7. **Surface adapter error `message`**, not just `error` — debugpy's "Server is not available" lives in `message`.
8. **Test fixture adapters (fake-dap-*.mjs)**: parse raw byte buffers, never `readline`. Use Buffer accumulator + Content-Length slicing.
9. **Test fixture adapters**: write whole frames in one `write()`. Overlapping setTimeout writes splice one message's bytes into another.
10. **`next` on a comprehension line reports `breakpoint` not `step`** (verified in this session — failure mode #3 above).
11. **The daemon-level fixture battery requires a PID marker** so it can verify the debuggee is dead after disconnect. Write it before the first breakpoint and remove it during test cleanup.

## Dependencies

- **debugpy importable** in the configured Python. On win32: `py -3.10 -E -c "import debugpy"` (test uses `resolvePython` which probes this first). If absent: `t.skip('debugpy is not importable...')` — the test is designed to skip, not fail, when debugpy is missing.
- **The configured Python**: `AIDE_PYTHON` env var (if set), else `py -3.10 -E`. The skill `aid-venv-care` and the failure `failure-pythonpath-hijack` document venv traps — do NOT use a venv with a broken `home=` pointing at the extracted embed zip.
- **Adapter command line**: `{python} -m debugpy.adapter`. The `debugpy.adapter` module is the DAP-server entry; `debugpy.listen()` is the client-side (different mode).
- **AIDE arch `DapManager`** (at `node/src/services/dap.ts`): provides `start/initialize/launch/setBreakpoints/configure/stack/scopes/variables/step/continue/disconnect/adapterStatus`. Reuses `JsonRpcDecoder` for framing. No new code needed in DapManager — the fixture is the missing piece.

## How to wire it in (the steps)

1. **Create the directory and file** (one Write call, per the credo):
   ```bash
   New-Item -ItemType Directory -Path "E:\aide-sovereign-workbench\fixtures\debuggee" -Force
   ```
   Write `E:\aide-sovereign-workbench\fixtures\debuggee\fizz_engine.py` with the VERIFIED content above (4-space indent, LF line endings, `#!/usr/bin/env python3` shebang, NO docstring, PID marker before the first breakpoint).

2. **Verify the fixture locally** by running it with Python:
   ```bash
   py -3.10 -E "E:\aide-sovereign-workbench\fixtures\debuggee\fizz_engine.py"
   ```
   Expected stdout: `{'total': 43, 'count': 12}` and a sibling `debuggee.pid`. Exit code 0. If the output or marker is wrong, the fixture is wrong — fix the fixture, not the test.

3. **Verify debugpy is importable** in the test's Python:
   ```bash
   py -3.10 -E -c "import debugpy; print(debugpy.__version__)"
   ```
   If this fails, the test will skip (not fail). To get a real pass, install debugpy: `py -3.10 -m pip install debugpy`.

4. **Run the test solo** (per the credo, one thing at a time):
   ```bash
   cd E:\aide-sovereign-workbench
   node --experimental-strip-types --no-warnings \
        --import "file:///E:/aide-sovereign-workbench/scripts/http-close-shim.mjs" \
        --test --test-timeout=240000 --test-concurrency=1 \
        tests/arch/dap-contract.test.ts
   ```
   Expected: 9 tests pass, 0 fail, 0 skip. The `real debugpy adapter round trip` test passes in ~3s.

   Run the daemon-level lifecycle and orphan gate separately:
   ```bash
   node daemon/test-dap-fixture.mjs
   ```
   Expected: the fixture assertions pass and the test removes `debuggee.pid` during cleanup.

5. **Run the full arch battery** to confirm no regressions:
   ```bash
   node scripts/run-arch.mjs
   ```

6. **Journal the change** in AGENT_NOTES.md and T1-T2_notes.md per `agent-notes` protocol. Include: file:line of the fixture, test pass counts, debugpy version, any deviations from the recipe.

## Pitfalls (each cost a cycle in this session)

1. **Docstring with marker substrings** — `lineOf('total = sum')` matched the docstring first. REMOVE the docstring or rewrite it to not contain the markers.
2. **List of dicts instead of list of strings** — `items[2]` was a dict, not the string `'Fizz'`. USE a flat list of strings.
3. **Comprehension on the breakpoint line** — `total = sum(int(x) for x in ...)` caused debugpy to report `breakpoint` not `step` on `next`. SPLIT the comprehension into a separate line.
4. **Breakpoint in a helper function** — moved `total = sum` into `compute_total()`, frame became `compute_total` not `main`. KEEP the breakpoint line inside `main()`.
5. **Creating the file at the wrong path** — the test reads `<repoRoot>/fixtures/debuggee/fizz_engine.py`. `<repoRoot>` = `E:\aide-sovereign-workbench\`. Not `tests/fixtures/`. Not `fixtures/`. The path is EXACTLY `E:\aide-sovereign-workbench\fixtures\debuggee\fizz_engine.py`.
6. **Forgetting the `if __name__ == "__main__"` guard** — without it, debugpy will still work but the entry point won't be `main`, and `frame[0]?.name === 'main'` fails.
7. **CRLF line endings** — Windows editors may save with `\r\n`. Python's tokenizer handles it but the `lineOf` index can shift. Use LF.
8. **Modifying the test to weaken assertions** — NEVER. The test is the spec. Fix the fixture.
9. **Running the full arch battery with this test included** — the test takes ~3-5s on this HDD. Per the verified `aide-windows-dev-reality` skill, the battery is serialized at concurrency=1 and 240s per-test ceiling. Running just `dap-contract.test.ts` in isolation is enough to verify the wire-in.
10. **Omitting the PID marker** — the arch test can still pass because it copies the fixture into a temporary directory, but `daemon/test-dap-fixture.mjs` then cannot prove the directly launched debuggee was reaped. Keep both DAP batteries green.

## What NOT to do

- **Do NOT modify the test file** to weaken the assertion or skip the debugpy round trip. The test is the spec.
- **Do NOT install debugpy into a venv with `home=E:\Python310`** (per `failure-pythonpath-hijack`). Use the system Python or a clean venv.
- **Do NOT add a docstring** to the fixture (causes failure mode #1).
- **Do NOT use a list of dicts** for `items` (causes failure mode #2).
- **Do NOT put a comprehension on the breakpoint line** (causes failure mode #3).
- **Do NOT move the breakpoint into a helper function** (causes failure mode #4).
- **Do NOT remove the `disconnect → terminated` assertion** thinking "real apps don't emit terminated." DAP spec says terminated is REQUIRED in all session-end situations.
- **Do NOT use `manager.disconnect` and then NOT wait for `terminated`** — the test asserts the event arrived (`watermark < events.length`).
- **Do NOT delete or weaken the daemon-level PID/orphan assertion** — it is the independent process-cleanup proof for the repository fixture.

## Related skills

- `aide-arch-protocols` — the master DAP/LSP doctrine, includes the verified DapManager field notes and the threat matrix.
- `aide-release-engineering` — the SOP that calls for a real debuggee fixture before claiming DAP readiness.
- `aide-debugging-discipline` — general debugging playbook; useful when a DAP test misbehaves.
- `aid-venv-care` — venv survival guide; relevant when installing debugpy.
- `failure-pythonpath-hijack` — documents the `home=E:\Python310` venv trap; DO NOT install debugpy there.
- `agent-notes` — the journal protocol; this fixture-creation must be logged.

## Verification (the gate — VERIFIED 2026-09-03)

The DAP stage is complete when:
1. `fixtures/debuggee/fizz_engine.py` exists with the EXACT content above and writes its sibling PID marker before the first breakpoint. ✓
2. `py -3.10 -E -c "import debugpy"` exits 0. ✓ (debugpy 1.8.21)
3. `tests/arch/dap-contract.test.ts` runs all 9 tests, the debugpy round-trip is the 9th, and it passes (not skips) in ~3s. ✓
4. `node daemon/test-dap-fixture.mjs` passes its lifecycle and orphan check, then removes the PID marker. ✓
5. The journal entry names this skill, the new file, the debugpy version, and the test counts. ✓

## Verification record (per agent-notes)

After the fixture is written, append to `AGENT_NOTES.md`:

```
- [2026-09-03 19:50] T1: DAP real debugpy fixture VERIFIED GREEN (stage 5)
   - Wrote E:\aide-sovereign-workbench\fixtures\debuggee\fizz_engine.py
    (verifiable: py -3.10 -E <path> -> {'total': 43, 'count': 12}, sibling PID marker, exit 0)
  - Hit 5 failure modes: docstring markers, list-of-dicts, comprehension-on-line,
    helper-function frame, probe-script stdin-close
  - Fixed all 5 in the fixture (test unchanged per R5)
   - Ran tests/arch/dap-contract.test.ts in isolation -> 9/9 pass, 8.5s
   - Ran node daemon/test-dap-fixture.mjs -> lifecycle/orphan gate PASS
  - Ran real debugpy round-trip solo -> PASS, 3.0s
  - debugpy version: 1.8.21
  - Skill updated: C:\Users\Grey_\.agents\skills\aid-dap-real-debugpy-fixture\SKILL.md
  - check:arch delta: +1 passed -0 failed (the debugpy round-trip went from skip/fail to pass)
  - Next: stage 6 - Skills auto-load by context (orchestrator detects task type)
```
