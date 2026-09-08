import { type Route } from '../server.ts';
import { ClosedLoopStatusResponse } from '../../../common/contracts/closed-loop.ts';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Closed-loop status (aid-closed-loop-on-by-default wiring). Read-only:
// the daemon spawns scripts/selfimprove.mjs; this surface only reports
// whether the loop is enabled and what state it has produced. Fail-closed:
// any read failure reports zeros/disabled rather than throwing.

const LOG_NAME = 'selfimprove.log';

async function lastLogLine(workspace: string): Promise<string | null> {
  const logPath = path.join(workspace, '.aide', 'logs', LOG_NAME);
  if (!existsSync(logPath)) return null;
  try {
    const text = await fs.readFile(logPath, 'utf8');
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    return lines.length ? (lines[lines.length - 1] ?? null) : null;
  } catch {
    return null;
  }
}

export function routesForClosedLoop(workspace: string): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/closed-loop/status',
      response: ClosedLoopStatusResponse,
      handler: async () => {
        const enabled = process.env.AIDE_CLOSED_LOOP !== 'false';
        let signalFileCount = 0;
        let busEventCount = 0;
        try {
          const signalDir = path.join(workspace, '.aide', 'training');
          if (existsSync(signalDir)) {
            const entries = await fs.readdir(signalDir);
            signalFileCount = entries.filter(name => name.startsWith('signal-') && name.endsWith('.jsonl')).length;
          }
        } catch { /* fail-closed: report 0 */ }
        try {
          const busPath = path.join(workspace, '.aide', 'cipher-state.jsonl');
          if (existsSync(busPath)) {
            const text = await fs.readFile(busPath, 'utf8');
            busEventCount = text.split(/\r?\n/).filter(line => line.trim().length > 0).length;
          }
        } catch { /* fail-closed: report 0 */ }
        const lastLine = await lastLogLine(workspace);
        return {
          enabled,
          last_run_logged_at: lastLine ? (lastLine.split(' ')[0] ?? null) : null,
          signal_file_count: signalFileCount,
          bus_event_count: busEventCount
        };
      }
    }
  ];
}