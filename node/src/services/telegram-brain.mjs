// Telegram Command Brain — turns /ask <natural language> into a SAFE local
// execution loop: model proposes (bounded to the operator's desktop grants),
// human confirms via reply, executor runs, evidence lands everywhere.
// Transport lives in telegram.mjs (this file adds the cognition seam).
import { stripToken } from './telegram.mjs';

const CONFIRM_WINDOW_MS = 5 * 60 * 1000;

export function createTelegramBrain({ desktop, resolveEngineChat }) {
  // desktop: desktop-control service; resolveEngineChat: async (messages) =>
  // {text} | null when no engine is READY.
  const pending = new Map(); // chatId -> { action, proposed_at }

  const CLASS_BY_OP = {
    list_windows: 'READ',
    focus_window: 'WRITE',
    launch_app: 'OPEN',
    open_path: 'OPEN',
    move_file: 'DESTRUCTIVE'
  };

  function parseProposal(text) {
    const m = /^\s*(launch_app|open_path|move_file|focus_window|list_windows)\s*\(\s*target\s*=\s*"([^"]{0,300})"\s*(?:,\s*destination\s*=\s*"([^"]{0,300})")?\s*\)\s*;?\s*$/i.exec(String(text || '').trim());
    if (!m) return null;
    const out = { op: m[1].toLowerCase(), target: m[2] };
    if (m[3] !== undefined) out.destination = m[3];
    return out;
  }

  async function grantsBlock() {
    const s = await desktop.status();
    if (!s.enabled) {
      return 'Desktop control is DISABLED. You may answer questions directly, or tell the user they can enable it in AIDE under Ctrl+K → Desktop control.';
    }
    const g = s.grants ?? {};
    return [
      'DESKTOP OPS AVAILABLE (deny-by-default; anything outside these grants will be REFUSED):',
      `- launch_app(target="<app>") — allowed apps: ${(g.apps || []).join(', ') || 'none'}`,
      `- open_path(target="<path>") — granted roots: ${(g.roots || []).join(' ; ') || 'none'}`,
      `- move_file(target="<path>", destination="<path>") — both inside granted roots`,
      `- focus_window(target="<title substring>") — titles: ${(g.window_titles || []).join(', ') || 'none'}`,
      `- list_windows()`,
      `Session expires in ~${Math.max(0, Math.ceil(s.ttl_minutes - (Date.now() - new Date(s.session_started_at).getTime()) / 60000))} min.`,
      'To propose ONE action, end your reply with exactly one line: op(target="...")'
    ].join('\n');
  }

  async function handleAsk(chatId, prompt) {
    const block = await grantsBlock();
    const result = await resolveEngineChat([
      { role: 'system', content: `You are AIDE running locally on the user's Windows machine. ${block}\nBe brief and concrete. If the request needs no desktop action, just answer.` },
      { role: 'user', content: String(prompt).slice(0, 2000) }
    ]);
    if (!result?.text) return 'No local engine is READY right now — start one in AIDE (Ctrl+K → Models), then ask again.';
    const lines = String(result.text).trim().split('\n');
    const proposalLine = [...lines].reverse().find(l => parseProposal(l));
    const answerText = lines.filter(l => l !== proposalLine).join('\n').trim();
    if (!proposalLine) return answerText || 'Done.';
    const proposal = parseProposal(proposalLine);
    pending.set(chatId, { proposal, proposed_at: Date.now(), note: answerText.slice(0, 200) });
    const cls = CLASS_BY_OP[proposal.op] || 'WRITE';
    return [
      answerText ? `${answerText}` : null,
      `PROPOSED ACTION [${cls}]: ${proposal.op}(target="${proposal.target}"${proposal.destination ? `, destination="${proposal.destination}"` : ''})`,
      cls === 'DESTRUCTIVE' ? '⚠️ destructive class.' : '',
      'Reply YES to execute, NO to cancel (valid 5 minutes).'
    ].filter(Boolean).join('\n');
  }

  async function handleConfirm(chatId, yesNo) {
    const p = pending.get(chatId);
    if (!p) return 'Nothing pending — use /ask first.';
    if (Date.now() - p.proposed_at > CONFIRM_WINDOW_MS) {
      pending.delete(chatId);
      return 'Proposal expired (5 min). Ask again.';
    }
    pending.delete(chatId);
    if (yesNo !== true) return 'Cancelled — nothing executed.';
    try {
      const result = await desktop.act({
        op: p.proposal.op,
        target: p.proposal.target,
        destination: p.proposal.destination,
        approved: true,
        note: `telegram-approved by chat ${chatId}: ${p.note}`
      });
      return `✅ Executed (${result.latency_ms} ms). ${result.output || ''}`.trim();
    } catch (error) {
      return `❌ Refused: ${error instanceof Error ? error.message : 'execution failed'}`;
    }
  }

  // Wired as the bridge's onCommand handler.
  async function onCommand({ chatId, text }) {
    const t = text.trim();
    if (/^\/ask\b/i.test(t)) {
      const prompt = t.replace(/^\/ask\b/i, '').trim();
      if (!prompt) return 'Usage: /ask what you need';
      return handleAsk(chatId, prompt);
    }
    if (/^\s*yes\b/i.test(t)) return handleConfirm(chatId, true);
    if (/^\s*no\b/i.test(t)) return handleConfirm(chatId, false);
    return null; // not ours — let other commands (status/ping/help) handle
  }

  void stripToken;
  return { onCommand, _test: { parseProposal, pending } };
}
