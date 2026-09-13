import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { normalizeOperation } from '../../../common/security/operation-policy.mjs';

export class AuthorityError extends Error {
  constructor(code, message, detail = undefined) {
    super(message); this.name = 'AuthorityError'; this.code = code; this.detail = detail;
  }
}
const deny = message => { throw new AuthorityError('FORBIDDEN', message); };
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

// The control object is held only by the composition root/supervisor. It is
// not exposed as an HTTP service. Actor handles are recognized by identity,
// not by their serializable claims. Credentials and decisions live in memory.
export function createExecutionAuthority({ workspace, record, clock = Date.now, sessionTtlMs = 30 * 60_000, operationTtlMs = 5 * 60_000, limit = 4096 }) {
  if (!workspace || typeof record !== 'function') throw new TypeError('workspace and required audit recorder are required');
  if (![sessionTtlMs, operationTtlMs, limit].every(n => Number.isSafeInteger(n) && n > 0)) throw new TypeError('positive finite authority limits required');
  const actors = new Map();
  const credentials = new Map();
  const pairings = new Map();
  const operations = new Map();
  const executions = new WeakMap();
  const claimedExecutions = new WeakSet();
  const decisionWaiters = new Set();
  const notifyDecisions = () => { for (const wake of [...decisionWaiters]) wake(); };
  const telegramMessages = new WeakMap();
  let revision = 1;

  function actorFor(handle) {
    const entry = handle && actors.get(handle.id);
    if (!entry || entry.handle !== handle || entry.revoked || clock() >= entry.expiresAt) deny('actor is unknown, expired or revoked');
    const owner = actors.get(entry.ownerId);
    if (!owner || owner.revoked || clock() >= owner.expiresAt) deny('actor owner is expired or revoked');
    return entry;
  }
  function audit(event) {
    return Promise.resolve().then(() => record(Object.freeze({ type: 'authority', ts: new Date(clock()).toISOString(), workspace, ...event })));
  }
  async function required(event) {
    let receipt;
    try { receipt = await audit(event); }
    catch { throw new AuthorityError('NOT_READY', 'authorization audit persistence failed'); }
    if (receipt?.persisted !== true) throw new AuthorityError('NOT_READY', 'authorization audit was not durably recorded');
  }
  function room(map) {
    for (const [id, entry] of map) if (entry.expiresAt <= clock()) {
      map.delete(id);
      if (map === actors) for (const [key, actorId] of credentials) if (actorId === id) credentials.delete(key);
    }
    if (map.size >= limit) throw new AuthorityError('NOT_READY', 'authority capacity reached');
  }
  function newActor(kind, ownerId, scope, origin) {
    room(actors);
    const id = randomUUID();
    const token = secret();
    const handle = Object.freeze({ id, kind });
    const expiresAt = clock() + sessionTtlMs;
    const entry = { handle, ownerId: ownerId ?? id, scope: new Set(scope), origin, expiresAt, revoked: false };
    actors.set(id, entry);
    credentials.set(hash(token), id);
    return { token, actor: handle, expires_at: expiresAt };
  }
  function descriptor(input) {
    let normalized;
    try { normalized = normalizeOperation(input); }
    catch { throw new AuthorityError('BAD_REQUEST', 'invalid or unknown operation'); }
    if (normalized.workspace !== workspace) deny('operation workspace mismatch');
    return normalized;
  }
  function scoped(actor, op) {
    const entry = actorFor(actor);
    if (actor.kind !== 'operator' && !entry.scope.has(op.kind)) deny('operation outside actor scope');
    return entry;
  }
  function operationFor(actor, id) {
    const entry = actorFor(actor);
    const op = operations.get(id);
    if (!op) throw new AuthorityError('NOT_FOUND', 'operation not found');
    if (entry.ownerId !== op.ownerId) deny('operation belongs to another operator');
    return op;
  }
  function valid(op) {
    if (op.expiresAt <= clock()) { op.state = 'expired'; throw new AuthorityError('CONFLICT', 'operation expired'); }
    if (op.revision !== revision || op.state === 'revoked') { op.state = 'revoked'; throw new AuthorityError('CONFLICT', 'operation revoked'); }
    actorFor(op.actor);
  }
  function view(op) {
    return Object.freeze({ operation_id: op.id, actor_id: op.actor.id, task_id: op.descriptor.taskId,
      workspace, kind: op.descriptor.kind, digest: op.descriptor.digest, risk: op.descriptor.risk,
      state: op.state, expires_at: op.expiresAt, args: op.descriptor.args });
  }
  function event(op, decision) {
    return { operation_id: op.id, actor_id: op.actor.id, owner_id: op.ownerId,
      task_id: op.descriptor.taskId, kind: op.descriptor.kind, digest: op.descriptor.digest,
      policy_revision: op.revision, decision };
  }

  function executionFor(handle, kind, body) {
    const op = handle && executions.get(handle);
    if (!op || op.state !== 'executing') deny('trusted active execution required');
    valid(op);
    if (op.descriptor.kind !== kind) deny('execution capability mismatch');
    const expected = descriptor({ ...op.descriptor, args: { body } });
    const actual = descriptor({ ...op.descriptor, args: { body: op.descriptor.args.body } });
    if (expected.digest !== actual.digest) deny('execution arguments mismatch');
    return op;
  }

  function telegramFor(handle) {
    const message = handle && telegramMessages.get(handle);
    if (!message || message.binding.closed || clock() >= message.expiresAt) deny('trusted Telegram message unavailable');
    actorFor(message.binding.actor);
    return message;
  }

  const control = Object.freeze({
    async telegramAdapter(execution, input) {
      const op = executionFor(execution, 'authority.grant', input);
      if (op.actor.kind !== 'operator' || !Number.isSafeInteger(input.chat_id) || !Number.isSafeInteger(input.user_id) || input.user_id <= 0 || input.chat_id === 0) deny('explicit operator-bound chat and sender required');
      await required(event(op, 'telegram-bound'));
      valid(op);
      const binding = { actor: newActor('adapter', op.ownerId, ['desktop.action'], null).actor,
        chatId: input.chat_id, userId: input.user_id, lastUpdate: -1, closed: false };
      return Object.freeze({
        // Private composition-root port. Only the connected Telegram transport
        // receives this object; HTTP/model payloads cannot construct it.
        receive(update) {
          actorFor(binding.actor);
          const message = update?.message;
          if (binding.closed || !Number.isSafeInteger(update?.update_id) || update.update_id <= binding.lastUpdate ||
              message?.chat?.id !== binding.chatId || message?.from?.id !== binding.userId ||
              typeof message.text !== 'string' || message.text.length > 4096) deny('Telegram identity or replay rejected');
          binding.lastUpdate = update.update_id;
          const handle = Object.freeze({});
          telegramMessages.set(handle, { binding, text: message.text.trim(), updateId: update.update_id,
            expiresAt: clock() + operationTtlMs, state: 'new' });
          return handle;
        },
        close() { binding.closed = true; control.revoke(binding.actor); }
      });
    },
    createPairing(origin) {
      if (typeof origin !== 'string' || !origin) throw new TypeError('explicit pairing origin required');
      room(pairings);
      const proof = secret();
      pairings.set(hash(proof), { origin, expiresAt: clock() + operationTtlMs });
      return proof;
    },
    delegate(owner, kind, scope) {
      const parent = actorFor(owner);
      if (owner.kind !== 'operator' || !['agent', 'adapter', 'service'].includes(kind)) deny('only operator-owned delegation is permitted');
      if (!Array.isArray(scope) || scope.some(item => typeof item !== 'string' || item.endsWith('.grants') || item.endsWith('.decision') || item === 'authority.grant')) deny('invalid delegated scope');
      return newActor(kind, parent.ownerId, scope, null).actor;
    },
    revoke(actor) {
      const entry = actors.get(actor?.id);
      if (!entry || entry.handle !== actor) deny('unknown actor');
      entry.revoked = true;
      for (const [key, actorId] of credentials) if (actorId === actor.id || actors.get(actorId)?.ownerId === actor.id) credentials.delete(key);
      for (const op of operations.values()) if ((op.actor === actor || op.ownerId === actor.id) && !['executing', 'succeeded', 'failed'].includes(op.state)) op.state = 'revoked';
      notifyDecisions();
    },
    revokePending() {
      revision += 1;
      for (const op of operations.values()) if (!['executing', 'succeeded', 'failed'].includes(op.state)) op.state = 'revoked';
      notifyDecisions();
    },
    close() {
      revision += 1;
      actors.clear(); credentials.clear(); pairings.clear(); operations.clear();
      notifyDecisions();
    }
  });

  return Object.freeze({
    control,
    async pair(proof, origin) {
      if (typeof proof !== 'string' || proof.length > 256) deny('invalid pairing proof');
      const key = hash(proof);
      const pairing = pairings.get(key);
      if (!pairing || pairing.expiresAt <= clock() || pairing.origin !== origin) deny('invalid pairing proof');
      pairings.delete(key); // one use even if audit fails
      await required({ decision: 'paired', origin });
      const created = newActor('operator', null, [], origin);
      return { token: created.token, actor_id: created.actor.id, expires_at: created.expires_at };
    },
    authenticate(token, origin) {
      if (typeof token !== 'string' || token.length > 256) deny('missing actor credential');
      const entry = actors.get(credentials.get(hash(token)));
      if (!entry || entry.origin !== origin) deny('invalid actor credential');
      actorFor(entry.handle);
      return entry.handle;
    },
    assertActor(actor) { actorFor(actor); },
    assertExecution(handle, kind, body) {
      const op = executionFor(handle, kind, body);
      return Object.freeze({ actor: op.actor, owner: actors.get(op.ownerId).handle, operation: op.descriptor });
    },
    claimTelegramMessage(handle) {
      const message = telegramFor(handle);
      if (message.state !== 'new') deny('Telegram message already consumed');
      message.state = 'claimed';
      return Object.freeze({ actor: message.binding.actor, chatId: message.binding.chatId,
        userId: message.binding.userId, text: message.text, taskId: `telegram:${message.binding.actor.id}:${message.updateId}` });
    },
    async decideTelegram(handle, id, decision) {
      const message = telegramFor(handle);
      if (message.state !== 'claimed' || !['approve', 'reject'].includes(decision) ||
          message.text.toUpperCase() !== `${decision === 'approve' ? 'YES' : 'NO'} ${id}`.toUpperCase()) deny('exact Telegram action confirmation required');
      const op = operationFor(message.binding.actor, id);
      if (op.actor !== message.binding.actor || op.descriptor.kind !== 'desktop.action') deny('Telegram operation binding mismatch');
      valid(op);
      if (op.state !== 'pending') throw new AuthorityError('CONFLICT', 'operation is not awaiting approval');
      message.state = 'consumed'; op.state = 'recording';
      try { await required({ ...event(op, decision), approver_id: op.ownerId }); valid(op); telegramFor(handle); }
      catch (error) { op.state = 'rejected'; throw error; }
      op.state = decision === 'approve' ? 'approved' : 'rejected';
      return view(op);
    },
    claimExecution(handle, kind, body) {
      executionFor(handle, kind, body);
      if (claimedExecutions.has(handle)) throw new AuthorityError('CONFLICT', 'execution service entry already consumed');
      claimedExecutions.add(handle);
    },
    async prepare(actor, input) {
      const normalized = descriptor(input);
      const owner = scoped(actor, normalized);
      room(operations);
      const op = { id: randomUUID(), actor, ownerId: owner.ownerId, descriptor: normalized,
        revision, expiresAt: Math.min(clock() + operationTtlMs, owner.expiresAt), state: 'recording' };
      operations.set(op.id, op);
      try { await required(event(op, 'proposed')); valid(op); }
      catch (error) { if (op.state === 'recording') op.state = 'rejected'; throw error; }
      op.state = normalized.risk === 'read' ? 'approved' : 'pending';
      return view(op);
    },
    inspect(actor, id) { return view(operationFor(actor, id)); },
    waitForDecision(actor, id) {
      // Notifications and an expiry deadline, not polling or implicit approval.
      return new Promise((resolve, reject) => {
        let timer;
        let deadline = 0;
        const finish = (error, value) => {
          clearTimeout(timer); decisionWaiters.delete(check);
          if (error) reject(error); else resolve(value);
        };
        const check = () => {
          try {
            const op = operationFor(actor, id); valid(op);
            if (op.state === 'approved') return finish(null, view(op));
            if (!['pending', 'recording'].includes(op.state)) throw new AuthorityError('CONFLICT', `operation ${op.state}`);
            // The deadline elapsed yet the operation still reads pending
            // (clock skew or an early timer). Probe shortly instead of
            // stranding the waiter: the next valid() must settle it.
            if (clock() >= deadline) timer = setTimeout(check, 250);
          } catch (error) { finish(error); }
        };
        decisionWaiters.add(check);
        try {
          const op = operationFor(actor, id);
          const entry = actorFor(actor), owner = actors.get(entry.ownerId);
          deadline = Math.min(op.expiresAt, entry.expiresAt, owner.expiresAt);
          timer = setTimeout(check, Math.max(1, deadline - clock()));
          check();
        } catch (error) { finish(error); }
      });
    },
    async decide(actor, id, decision) {
      if (actorFor(actor).handle.kind !== 'operator') deny('only the operator can approve');
      if (decision !== 'approve' && decision !== 'reject') throw new AuthorityError('BAD_REQUEST', 'invalid decision');
      const op = operationFor(actor, id);
      valid(op);
      if (op.state !== 'pending') throw new AuthorityError('CONFLICT', 'operation is not awaiting approval');
      op.state = 'recording';
      try { await required({ ...event(op, decision), approver_id: actor.id }); valid(op); }
      catch (error) { if (op.state === 'recording') op.state = 'rejected'; notifyDecisions(); throw error; }
      op.state = decision === 'approve' ? 'approved' : 'rejected';
      notifyDecisions();
      return view(op);
    },
    async execute(actor, id, input, executor) {
      const op = operationFor(actor, id);
      if (op.actor !== actor) deny('authorization belongs to another actor');
      const normalized = descriptor(input);
      if (normalized.digest !== op.descriptor.digest) throw new AuthorityError('CONFLICT', 'operation changed after approval');
      scoped(actor, normalized); valid(op);
      if (op.state !== 'approved') throw new AuthorityError('CONFLICT', 'operation is not approved or was already consumed');
      if (typeof executor !== 'function') throw new TypeError('executor required');
      op.state = 'consuming'; // synchronous claim before the persistence await
      try { await required(event(op, 'consumed')); valid(op); }
      catch (error) { if (op.state === 'consuming') op.state = 'rejected'; throw error; }
      op.state = 'executing';
      const execution = Object.freeze({ operation_id: op.id });
      executions.set(execution, op);
      let value;
      try { value = await executor(op.descriptor, execution); }
      catch (error) {
        op.state = 'failed';
        try { await required({ ...event(op, 'execution-failed'),
          ...(op.descriptor.kind.startsWith('checkpoint.') ? { checkpoint: {
            code: error?.code ?? 'CHECKPOINT_FAILED',
            detail: error?.detail ?? null
          } } : {}) }); }
        catch { throw new AuthorityError('NOT_READY', 'execution failed and outcome persistence failed', { execution: 'failed', persisted: false }); }
        throw error;
      } finally { executions.delete(execution); }
      op.state = 'succeeded';
      try { await required(event(op, 'execution-succeeded')); }
      catch { throw new AuthorityError('NOT_READY', 'execution succeeded but outcome persistence failed; do not replay', { execution: 'succeeded', persisted: false, operation_id: id }); }
      return value;
    }
  });
}
