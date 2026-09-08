# Skill: aide-acceptance-test-repair

# Acceptance Test Repair — Fixing Pre-Existing Test Failures

The acceptance-real.mjs test has a pre-existing failure on line 44: the terminal
check expects `terminal.body.stdout === 'terminal-ok'` but gets `undefined`.
This skill covers diagnosing and fixing it.

## The Failure

```
AssertionError: Expected values to be strictly equal:
+ actual - expected
+ undefined
- 'terminal-ok'
    at acceptance-real.mjs:44:244
```

Line 44:
```js
const terminal = await request('/api/terminal/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ program: 'node', args: ['-e', "process.stdout.write('terminal-ok')"], approved: true })
});
assert.equal(terminal.body.stdout, 'terminal-ok');
```

## Root Cause Analysis

The `/api/terminal/run` endpoint returns a response but `body.stdout` is undefined.
Possible causes:

1. **Response shape mismatch** — endpoint returns `{result: ...}` not `{stdout: ...}`
2. **Endpoint missing** — `/api/terminal/run` doesn't exist in the daemon
3. **Process spawn failure** — node process doesn't start or output is captured differently
4. **Timing issue** — process exits before output is captured

## Debugging Steps

### 1. Check the actual response shape

```js
const terminal = await request('/api/terminal/run', { ... });
console.log('Terminal response:', JSON.stringify(terminal.body));
```

### 2. Check if endpoint exists

```bash
curl -X POST http://localhost:4777/api/terminal/run \
  -H "Content-Type: application/json" \
  -d '{"program":"node","args":["-e","process.stdout.write(\"test\")"],"approved":true}'
```

### 3. Check daemon route registration

In `daemon/server.mjs`, search for `terminal/run` or `terminal` routes.
If missing, the endpoint needs to be added.

### 4. Check terminal service

If the endpoint exists, check what it returns:
```bash
# Check if terminal service is implemented
grep -n "terminal" daemon/server.mjs | head -20
```

## Fix Options

### Option A: Fix the response shape (if endpoint exists but returns wrong shape)
Update the assertion to match the actual response:
```js
assert.equal(terminal.body.result, 'terminal-ok');
// or
assert.equal(terminal.body.output, 'terminal-ok');
```

### Option B: Add the endpoint (if missing)
Add `/api/terminal/run` route to daemon/server.mjs that:
1. Spawns the process with `child_process.spawn`
2. Captures stdout
3. Returns `{ stdout: capturedOutput }`

### Option C: Fix the terminal service
If the service exists but doesn't capture output correctly, fix the spawn logic.

## Verification

After fix, run:
```bash
node scripts/acceptance-real.mjs
```
Expected: `REAL AIDE ACCEPTANCE PASSED: workspace, write, patch, terminal, LSP...`

## Rules

- NEVER skip the terminal test — it's a core feature
- NEVER change the test to pass without fixing the underlying issue
- ALWAYS verify the fix doesn't break other tests
- Run the full battery after any change
