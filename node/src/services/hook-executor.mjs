import { AuthorityError } from './execution-authority.mjs';

/**
 * Deferred continuation owner for notification hook execution.
 *
 * HookExecutor sits between task events and hook execution. It describes the
 * exact capability.execute operation for a task event, prepares a pending
 * authority operation, returns immediately, and later executes the hook once
 * after a real operator approval. It never approves, delegates, or manufactures
 * authority.
 */
export class HookExecutor {
  #authority;
  #notifications;
  #pending = new Map();
  #closed = false;

  constructor({ authority, notifications } = {}) {
    this.#authority = authority;
    this.#notifications = notifications;
  }

  close() {
    this.#closed = true;
    this.#pending.clear();
  }

  /** Read-only observability for continuation cleanup; exposes no authority material. */
  pendingCount() {
    return this.#pending.size;
  }

  /**
   * Synchronous, non-blocking entry point. Task-event observation is owned by
   * the caller (openapi wiring); this class only starts a detached authority
   * continuation when hooks may apply. Task execution continues independently.
   */
  onTaskEvent(evt, meta) {
    if (this.#closed || !evt || typeof evt !== 'object') return;
    const owner = meta?.owner;
    if (!owner) return;
    const eventName = this.#eventNameFor(evt);
    if (!eventName) return;
    const context = this.#contextFor(evt, eventName);
    const taskId = `hook:${evt.job_id}:${eventName}`;
    void this.#startContinuation(owner, evt, eventName, context, taskId).catch(() => {});
  }

  #eventNameFor(evt) {
    if (evt.event === 'started') return 'task.started';
    if (evt.event === 'exit') {
      if (evt.exitCode === 0) return 'task.completed';
      if (evt.exitCode === null && evt.signal) return null;
      return 'task.failed';
    }
    if (evt.event === 'problems') return 'diagnostics.new';
    return null;
  }

  #contextFor(evt, eventName) {
    const label = evt.label ?? evt.job_id ?? 'task';
    if (eventName === 'task.started') return { label, job_id: evt.job_id };
    if (eventName === 'diagnostics.new') {
      const count = Array.isArray(evt.problems) ? evt.problems.length : 0;
      return { label, job_id: evt.job_id, count };
    }
    return { label, job_id: evt.job_id, exit_code: evt.exitCode };
  }

  async #startContinuation(owner, evt, eventName, context, taskId) {
    let operationId = null;
    try {
      const input = this.#notifications.describeHookExecution(eventName, context, taskId);
      const hooks = input?.args?.body?.hooks;
      if (!Array.isArray(hooks) || hooks.length === 0) return;
      const operation = await this.#authority.prepare(owner, input);
      operationId = operation.operation_id;
      this.#pending.set(operationId, { owner, input, evt, eventName, context, taskId });
      this.#recordLifecycle(eventName, evt, 'pending', operationId);
      try {
        const decided = await this.#authority.waitForDecision(owner, operationId);
        if (decided.state !== 'approved') {
          this.#cleanup(operationId);
          this.#recordLifecycle(eventName, evt, 'denied', operationId);
          return;
        }
        await this.#authority.execute(owner, operationId, input, async (_operation, execution) => {
          return this.#notifications.runHooks(eventName, context, execution);
        });
        this.#cleanup(operationId);
        this.#recordLifecycle(eventName, evt, 'succeeded', operationId);
      } catch (error) {
        this.#cleanup(operationId);
        const state = this.#terminalStateFromError(error);
        this.#recordLifecycle(eventName, evt, state, operationId, error.message);
      }
    } catch (error) {
      this.#recordLifecycle(eventName, evt, 'failed', operationId, error.message);
    }
  }

  #cleanup(operationId) {
    if (operationId) this.#pending.delete(operationId);
  }

  #terminalStateFromError(error) {
    if (error instanceof AuthorityError) {
      if (error.code === 'CONFLICT') {
        if (error.message.includes('expired')) return 'expired';
        if (error.message.includes('revoked')) return 'revoked';
        return 'denied';
      }
    }
    return 'failed';
  }

  #recordLifecycle(eventName, evt, state, operationId, detail) {
    const title = state === 'pending'
      ? `Hook ${eventName} pending approval`
      : state === 'succeeded'
        ? `Hook ${eventName} succeeded`
        : state === 'denied'
          ? `Hook ${eventName} denied`
          : `Hook ${eventName} ${state}`;
    const body = operationId ? `${state}; operation_id=${operationId}${detail ? `; ${detail}` : ''}` : `${state}${detail ? `; ${detail}` : ''}`;
    this.#notifications?.record({ severity: state === 'succeeded' ? 'success' : state === 'pending' ? 'info' : 'warn', source: 'hook', title, body, job_id: evt.job_id });
  }
}
