import crypto from 'node:crypto';
import { evaluateWhen } from '../../../common/context-keys.mjs';

export class CommandRegistry {
  constructor({ onEvent = null } = {}) {
    this.commands = new Map();
    this.onEvent = onEvent;
  }

  registerCommand({ id, title, category = '', icon = '', when = 'true', enablement = 'true', hidden = false, handler }) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9._\-:]{3,128}$/.test(id)) throw new Error(`invalid command id: ${id}`);
    if (typeof handler !== 'function') throw new Error(`command ${id} needs a handler`);
    const descriptor = { id, title, category, icon, when, enablement, hidden };
    this.commands.set(id, { descriptor, handler });
    return {
      dispose: () => this.commands.delete(id),
      descriptor
    };
  }

  list() {
    return Array.from(this.commands.values()).map(entry => entry.descriptor);
  }

  get(id) {
    return this.commands.get(id) ?? null;
  }

  async invoke(id, args, context = {}) {
    const entry = this.get(id);
    if (!entry) return { error: 'NOT_FOUND', message: `unknown command: ${id}` };
    if (!evaluateWhen(entry.descriptor.enablement, context)) return { error: 'FORBIDDEN', message: `command disabled by enablement: ${id}` };
    this.onEvent?.('command', { event: 'will-execute', id });
    try {
      const result = await entry.handler(args);
      this.onEvent?.('command', { event: 'did-execute', id });
      return { result };
    } catch (error) {
      this.onEvent?.('command', { event: 'execute-failed', id });
      return { error: 'BAD_RESPONSE', message: String(error?.message ?? error) };
    }
  }

  fingerprint() {
    return crypto.createHash('sha256').update(JSON.stringify(this.list())).digest('hex').slice(0, 16);
  }
}
