# W1 EXIT BATTERY — MAKE THE SERVED APP ACTUALLY WORK
Date: 2026-08-24 | Actor: ox-alpha | Commit under test: 50e9044 (facade unwrap) + HELP wiring

## Cold boot (node scripts/start.mjs, detached)
- UI static server 4173: HTTP 200 on /
- facade listening 4777 (map: common/facade-route-map.json, ts:4778, legacy:4779)
- legacy backend ready 4779; ts backend ready 4778 (first health probe hit documented cold-start 502 -> 200 after warmup)
- Boot log preserved in live-stack.out

## Consumer-compat battery (all requests THROUGH public facade :4777)
1. GET /api/health            -> ts   200 {"version":"dev","uptimeMs":11129,"workspace":"E:\\aide-sovereign-workbench","freeMemoryMB":5014}
   ^ BARE payload - {ok,data} wrapper stripped by facade unwrap adapter (the fix)
2. GET /api/models/status     -> legacy 200 {"models":[{..."endpoint":"http://127.0.0.1:8082/v1"...}]} passthrough untouched
3. GET /api/file?path=package.json -> ts 200 {"path":"package.json","content":"{\n  \"name\": \"aide-sovereign-workbench\",..."} BARE
4. POST /api/file/write {"path":".aide/w1-probe.txt","content":"W1 round-trip probe 2026-08-24","approved":true}
   -> ts 200 {"path":".aide/w1-probe.txt","bytes":30} BARE
5. Negative path: same write WITHOUT approved field -> 400 rewritten into legacy shape {"error":"invalid request body","code":"BAD_REQUEST"}
6. READBACK of written file -> content byte-exact ("W1 round-trip probe 2026-08-24", size 30)

## Unit suite
node --test tests/unit/test-facade.mjs -> 12 pass / 0 fail (597ms), incl. 4 new unwrap tests
(unwrap-to-bare, non-envelope passthrough incl 1.5MiB under 4MiB cap, wrapped-error->legacy shape, legacy targets never rewritten)

## Conclusion
Editor open/save round-trip is consumer-compatible through the public endpoint in BOTH directions.
Legacy consumers see one shape everywhere: bare success payloads + {error,code} errors.
Blank-content bug class eliminated at the boundary. W1 gate CLOSED.
