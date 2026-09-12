import { AuthoritySessionResponse, AuthorityOperationResponse } from '../../../common/contracts/authority.ts';
import { Envelope } from '../../../common/errors.ts';
import { egressFetch } from './egress.ts';
import { facadeHttpUrl } from './runtime-config.ts';

// Memory only; never localStorage, URLs, workspace files or model context.
let credential: string | null = null;
let expiresAt = 0;
const format = { 'Content-Type': 'application/json', 'X-AIDE-API-Format': 'envelope-v1' };

async function control(path: string, body: unknown): Promise<unknown> {
  const response = await egressFetch(facadeHttpUrl(path), { method: 'POST', headers: withAuthority(format), body: JSON.stringify(body) });
  const envelope = Envelope.parse(await response.json());
  if (!envelope.ok) throw new Error(`${envelope.error.code}: ${envelope.error.message}`);
  return envelope.data;
}
export function withAuthority(input?: HeadersInit): Headers {
  const headers = new Headers(input);
  if (credential && Date.now() < expiresAt) headers.set('Authorization', `Bearer ${credential}`);
  return headers;
}
export async function pairAuthority(proof: string): Promise<void> {
  const session = AuthoritySessionResponse.parse(await control('/api/authority/pair', { proof }));
  credential = session.token; expiresAt = session.expires_at;
}
export async function initializeAuthority(): Promise<void> {
  const host = window as unknown as { __TAURI_INTERNALS__?: { invoke(command: string): Promise<unknown> } };
  const proof = host.__TAURI_INTERNALS__ ? await host.__TAURI_INTERNALS__.invoke('authority_pairing')
    : window.prompt('Pair this Covert session: type pair in the launch terminal, then enter its one-use code.');
  if (typeof proof !== 'string' || !proof.trim()) throw new Error('Pairing cancelled; privileged access remains disabled.');
  await pairAuthority(proof.trim());
}
export function authenticateEventSocket(socket: WebSocket): void {
  if (!credential || Date.now() >= expiresAt) { socket.close(); return; }
  socket.send(JSON.stringify({ type: 'authenticate', token: credential }));
}
export async function approveRequest(path: string, init: RequestInit): Promise<Headers> {
  if (!credential || Date.now() >= expiresAt) throw new Error('Paired operator session required.');
  if (init.body !== undefined && typeof init.body !== 'string') throw new Error('Exact JSON operation body required.');
  const task = crypto.randomUUID();
  const operation = AuthorityOperationResponse.parse(await control('/api/authority/prepare', {
    method: init.method ?? 'GET', path, task_id: task, body: init.body === undefined ? {} : JSON.parse(init.body) as unknown
  }));
  const description = JSON.stringify({ operation: operation.kind, workspace: operation.workspace, task: operation.task_id, risk: operation.risk, arguments: operation.args }, null, 2);
  // One explicit decision for this exact immutable operation; never approve
  // automatically because a caller or model supplied approved:true.
  const allowed = typeof window !== 'undefined' && window.confirm(`Approve this operation once?\n${description}`);
  await control('/api/authority/decision', { operation_id: operation.operation_id, decision: allowed ? 'approve' : 'reject' });
  if (!allowed) throw new Error('Operation denied; no execution authorized.');
  const headers = withAuthority(init.headers);
  headers.set('X-AIDE-Operation', operation.operation_id); headers.set('X-AIDE-Task', task);
  return headers;
}
