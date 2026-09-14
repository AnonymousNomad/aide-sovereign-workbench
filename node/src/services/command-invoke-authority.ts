import { createHash } from 'node:crypto';
import { normalizeOperation } from '../../../common/security/operation-policy.mjs';
import type { CommandRegistry } from './command-registry.mjs';

export class CommandInvokeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = code;
    this.code = code;
  }
}

const fail = (code: string, message: string): never => { throw new CommandInvokeError(code, message); };

export interface BuiltinCommand {
  readonly id: string;
  readonly title: string;
  readonly category: string;
}

export interface CommandInvokeBindings {
  readonly id: string;
  readonly args_digest: string;
  readonly registry_digest: string;
  readonly handler_digest: string;
}

function readDataProperty(target: object, key: string | symbol): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('BAD_REQUEST', 'args must be a JSON value');
  return descriptor.value;
}

/**
 * Specialized iterative args encoder for POST /api/commands/invoke. This is
 * not a general serializer: it covers exactly the accepted JSON.parse domain
 * (null, boolean, finite and non-finite number including -0 and ±Infinity,
 * string, array, plain object) plus the omitted/undefined top-level case, and
 * it streams into SHA-256 without recursion, so there is no depth limit and
 * no call-stack ceiling. Distinct values always produce distinct digests.
 */
export function commandArgsDigest(args: unknown): string {
  const hash = createHash('sha256');
  const stack: Array<{ phase: 'value' | 'end'; value?: unknown }> = [{ phase: 'value', value: args }];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.phase === 'end') { hash.update('}'); continue; }
    const value = frame.value;
    if (value === undefined) { hash.update('U'); continue; }
    if (value === null) { hash.update('n'); continue; }
    if (typeof value === 'boolean') { hash.update(value ? 'T' : 'F'); continue; }
    if (typeof value === 'string') { hash.update(`s${Buffer.byteLength(value, 'utf8')}:`); hash.update(value, 'utf8'); continue; }
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return fail('BAD_REQUEST', 'args must be a JSON value');
      if (Object.is(value, -0)) { hash.update('N-0'); continue; }
      if (value === Infinity) { hash.update('Ninf'); continue; }
      if (value === -Infinity) { hash.update('N-inf'); continue; }
      hash.update(`N${String(value)}`); continue;
    }
    if (typeof value !== 'object') return fail('BAD_REQUEST', 'args must be a JSON value');
    if (seen.has(value)) return fail('BAD_REQUEST', 'args must be a JSON value');
    seen.add(value);
    if (Array.isArray(value)) {
      hash.update(`A${value.length}:`);
      stack.push({ phase: 'end' });
      for (let index = value.length - 1; index >= 0; index--) stack.push({ phase: 'value', value: readDataProperty(value, String(index)) });
      continue;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail('BAD_REQUEST', 'args must be a JSON value');
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) return fail('BAD_REQUEST', 'args must be a JSON value');
    hash.update(`O${keys.length}:`);
    stack.push({ phase: 'end' });
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index] as string;
      stack.push({ phase: 'value', value: readDataProperty(value, key) });
      stack.push({ phase: 'value', value: key });
    }
  }
  return hash.digest('hex');
}

/**
 * Full 64-hex digest over the exact command id plus the live handler's
 * inspectable function source. Native, bound, and uninspectable handlers
 * fail closed: they cannot be bound by an authority approval.
 */
export function handlerDigestFor(registry: CommandRegistry, id: string): string {
  const entry = registry.get(id);
  if (!entry) return fail('NOT_FOUND', `unknown command: ${id}`);
  if (typeof entry.handler !== 'function') return fail('FORBIDDEN', 'command handler unavailable');
  let source = '';
  try { source = Function.prototype.toString.call(entry.handler); } catch { return fail('FORBIDDEN', 'command handler uninspectable'); }
  if (!source || source.includes('[native code]')) return fail('FORBIDDEN', 'command handler uninspectable');
  return createHash('sha256').update(JSON.stringify([id, source])).digest('hex');
}

/**
 * Full 64-hex digest over the live registry projection, computed through the
 * existing authority normalization seam (normalizeOperation) — no new
 * general serializer is introduced.
 */
export function registryDigestFor(registry: CommandRegistry, workspace: string, taskId: string): string {
  const projection = registry.list().map(descriptor => ({
    id: descriptor.id,
    title: descriptor.title,
    category: descriptor.category,
    icon: descriptor.icon,
    when: descriptor.when,
    enablement: descriptor.enablement,
    hidden: descriptor.hidden
  })).sort((a, b) => a.id.localeCompare(b.id));
  return normalizeOperation({ workspace, taskId, kind: 'capability.execute', args: { body: { registry: projection } } }).digest;
}

export function describeCommandInvoke(
  registry: CommandRegistry,
  allowedIds: ReadonlySet<string>,
  workspace: string,
  taskId: string,
  id: unknown,
  args: unknown
): CommandInvokeBindings {
  if (typeof id !== 'string' || id.length < 3 || id.length > 128) return fail('BAD_REQUEST', 'invalid command id');
  if (!allowedIds.has(id)) return fail('NOT_FOUND', `unknown command: ${id}`);
  return {
    id,
    args_digest: commandArgsDigest(args),
    registry_digest: registryDigestFor(registry, workspace, taskId),
    handler_digest: handlerDigestFor(registry, id)
  };
}
