import { readFileSync } from 'node:fs';

let buffer = Buffer.alloc(0);

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString('utf8');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const raw = buffer.subarray(start, start + length).toString('utf8');
    buffer = buffer.subarray(start + length);
    try {
      void handle(JSON.parse(raw));
    } catch {
      // malformed frame dropped
    }
  }
});

function send(message, torn = false) {
  const payload = JSON.stringify(message);
  const frame = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
  if (!torn) {
    process.stdout.write(frame);
    return;
  }
  const half = Math.floor(frame.length / 2);
  process.stdout.write(frame.slice(0, half));
  setTimeout(() => process.stdout.write(frame.slice(half)), 5);
}

function respond(request, body, success = true, torn = false) {
  send({ seq: request.seq, type: 'response', request_seq: request.seq, command: request.command, success, body }, torn);
}

function event(name, body) {
  send({ seq: 0, type: 'event', event: name, body });
}

let program = null;
let breakpointLines = [];
let nextLine = null;
let secondLine = null;
let currentStopLine = null;
const REF_LOCALS = 1;
const REF_GLOBALS = 2;
const REF_ENGINE = 11;
const REF_ITEMS = 12;

async function handle(request) {
  switch (request.command) {
    case 'initialize':
      respond(request, { capabilities: { supportsConfigurationDoneRequest: true, supportsTerminateRequest: true } }, true, true);
      return;
    case 'setBreakpoints': {
      const sourcePath = request.arguments?.source?.path ?? '';
      let lineCount = 0;
      try {
        lineCount = readFileSync(sourcePath, 'utf8').split('\n').length;
      } catch {
        lineCount = 1;
      }
      const requested = request.arguments?.breakpoints ?? [];
      breakpointLines = requested.map(bp => bp.line).filter(line => Number.isFinite(line));
      [nextLine, secondLine] = breakpointLines;
      respond(request, {
        breakpoints: breakpointLines.map(line => ({
          line,
          verified: line <= lineCount,
          message: line <= lineCount ? undefined : 'line out of range'
        }))
      });
      return;
    }
    case 'configurationDone':
      respond(request, {});
      return;
    case 'launch':
      program = request.arguments?.program ?? null;
      respond(request, {});
      setTimeout(() => {
        event('initialized', {});
        if (nextLine !== undefined) {
          setTimeout(() => {
            currentStopLine = nextLine;
            event('stopped', { reason: 'breakpoint', threadId: 1, allThreadsStopped: true });
          }, 10);
        }
      }, 10);
      return;
    case 'threads':
      respond(request, { threads: [{ id: 1, name: 'main thread' }] });
      return;
    case 'stackTrace':
      respond(request, {
        stackFrames: [
          { id: 1, name: 'main', line: currentStopLine ?? 1, source: { path: program } },
          { id: 2, name: 'helper', line: (currentStopLine ?? 1) - 1, source: { path: program } }
        ]
      });
      return;
    case 'scopes':
      respond(request, {
        scopes: [
          { name: 'Locals', variablesReference: REF_LOCALS, expensive: false },
          { name: 'Globals', variablesReference: REF_GLOBALS, expensive: false }
        ]
      });
      return;
    case 'variables': {
      const ref = request.arguments?.variablesReference;
      if (ref === REF_LOCALS) {
        respond(request, { variables: [{ name: 'engine', value: '{...}', variablesReference: REF_ENGINE }] });
      } else if (ref === REF_ENGINE) {
        respond(request, { variables: [{ name: 'items', value: '[...]', variablesReference: REF_ITEMS }] });
      } else if (ref === REF_ITEMS) {
        respond(request, { variables: [{ name: '2', value: "'Fizz'", type: 'str' }] });
      } else if (ref === REF_GLOBALS) {
        respond(request, { variables: [{ name: '__name__', value: "'__main__'" }] });
      } else {
        respond(request, { variables: [] });
      }
      return;
    }
    case 'next':
      respond(request, {});
      currentStopLine = (currentStopLine ?? nextLine ?? 1) + 1;
      setTimeout(() => event('stopped', { reason: 'step', threadId: 1, allThreadsStopped: true }), 10);
      return;
    case 'continue':
      respond(request, { allThreadsContinued: true });
      if (secondLine !== undefined) {
        setTimeout(() => {
          currentStopLine = secondLine;
          event('stopped', { reason: 'breakpoint', threadId: 1, allThreadsStopped: true });
        }, 10);
      }
      return;
    case 'pause':
      respond(request, {});
      setTimeout(() => event('stopped', { reason: 'pause', threadId: 1, allThreadsStopped: true }), 10);
      return;
    case 'disconnect':
      respond(request, {});
      event('terminated', {});
      setTimeout(() => process.exit(0), 20);
      return;
    default:
      respond(request, {}, false);
  }
}