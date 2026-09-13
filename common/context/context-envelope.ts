import {
  ContextBuildInput, ContextEnvelope,
  type ContextEnvelopeT, type ContextManifestT,
  type ContextWorkerProjectionT, type DeepReadonly
} from '../contracts/context.ts';

export class ContextEnvelopeError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'ContextEnvelopeError';
    this.code = code;
  }
}

const fail = (code: string): never => { throw new ContextEnvelopeError(code); };
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Covert JSON v1 (not JCS or another named canonical-JSON standard).
 *
 * Object member names are compared lexically by JavaScript UTF-16 code units
 * (the values compared by '<'), never by Unicode code points, locale, Unicode
 * normalization, or UTF-8 bytes. No Unicode normalization is performed.
 * Arrays preserve their input order exactly; elements are never sorted or
 * normalized. Strings use JSON.stringify-equivalent JSON escaping: quotation
 * marks and reverse solidus are escaped, U+0000..U+001F use JSON short escapes
 * where defined ('\b', '\t', '\n', '\f', '\r') or '\u00XX', ordinary Unicode
 * is retained where JSON.stringify retains it, and lone or paired surrogate
 * code units follow JSON.stringify's well-formed escaping behavior.
 *
 * Numbers use the current JavaScript JSON.stringify spelling for finite values:
 * integers and decimals use its shortest round-trippable decimal form,
 * exponent notation is used where that implementation selects it, and -0 is
 * serialized as 0. NaN, positive/negative Infinity and every other non-JSON
 * value are rejected. Explicit null is serialized. Undefined, sparse array
 * elements, accessors, symbols, functions and unsupported objects are rejected;
 * optional properties absent from the canonical object remain absent.
 *
 * The resulting text is encoded as UTF-8 before SHA-256. This algorithm is
 * reproducible outside JavaScript by implementing UTF-16 code-unit comparison
 * plus the stated JSON.stringify-compatible string/number grammar. The digest
 * detects content differences only: it authenticates no producer and grants no
 * execution authority or credential status.
 *
 * Inputs must be inert data, not hostile in-process Proxies with executable traps.
 */
export function canonicalContextJson(input: unknown): string {
  const ancestors = new Set<object>();
  let nodes = 0;
  let size = 0;
  function render(value: unknown, depth: number): string {
    if (++nodes > 200_000 || depth > 64) return fail('JSON_LIMIT');
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return fail('NON_JSON_NUMBER');
      return JSON.stringify(value);
    }
    if (typeof value === 'string') {
      size += value.length;
      if (size > 16_000_000) return fail('JSON_LIMIT');
      return JSON.stringify(value);
    }
    if (typeof value !== 'object') return fail('NON_JSON_VALUE');
    if (ancestors.has(value)) return fail('JSON_CYCLE');
    const array = Array.isArray(value);
    const proto: unknown = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return fail('NON_JSON_OBJECT');
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) return fail('NON_JSON_KEY');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys as string[]) {
      if (array && key === 'length') continue;
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('NON_JSON_PROPERTY');
    }
    ancestors.add(value);
    try {
      if (array) {
        if (value.length > 200_000 || keys.length !== value.length + 1) return fail('NON_JSON_ARRAY');
        const parts: string[] = [];
        for (let i = 0; i < value.length; i++) {
          const descriptor = descriptors[String(i)];
          if (!descriptor) return fail('NON_JSON_ARRAY');
          parts.push(render(descriptor.value, depth + 1));
        }
        return '[' + parts.join(',') + ']';
      }
      return '{' + (keys as string[]).sort(compare).map(key => {
        size += key.length;
        if (size > 16_000_000) return fail('JSON_LIMIT');
        return JSON.stringify(key) + ':' + render(descriptors[key]!.value, depth + 1);
      }).join(',') + '}';
    } finally { ancestors.delete(value); }
  }
  return render(input, 0);
}

async function sha256(text: string): Promise<string> {
  // Web Crypto works in the supported browser and Node runtime. No fs,
  // process, network or Node module import is reachable from this module.
  const bytes = new TextEncoder().encode(text);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

type Exclusion = ContextManifestT['excluded'][number]['reason'];

/** Pure decision over a supplied snapshot of information. The future Context
 * Engine must obtain trusted policy, freshness, scope and destination inputs.
 * This function neither authenticates those inputs nor performs release/egress.
 * ASK is deliberately unavailable until a separately trusted release seam exists.
 */
export async function buildContextEnvelope(input: unknown): Promise<DeepReadonly<ContextEnvelopeT>> {
  // Validate inert JSON BEFORE schema parsing; then detach every input alias
  // before the first await (including caller mutation during SHA computation).
  const parsed = ContextBuildInput.safeParse(JSON.parse(canonicalContextJson(input)));
  if (!parsed.success) return fail('INVALID_CONTRACT');
  const { request, policy, items } = parsed.data;
  if (request.destination.locality === 'remote' && policy.destinations === 'local_only') return fail('DESTINATION_POLICY');
  const byId = new Map(items.map(item => [item.id, item]));
  if (byId.size !== items.length) return fail('DUPLICATE_ITEM');
  const ordered = [...items].sort((a, b) => compare(a.id, b.id));
  const unavailable = new Map<string, Exclusion>();
  const now = Date.parse(request.evaluatedAt);
  for (const item of ordered) {
    if (item.scope.workspaceId !== request.workspaceId ||
      (item.scope.taskId !== null && item.scope.taskId !== request.taskId) ||
      !item.scope.roles.includes(request.role)) return fail('SCOPE_MISMATCH');
    for (const refs of [item.selection.dependencies, item.selection.conflicts]) {
      if (new Set(refs).size !== refs.length || refs.some(ref => !byId.has(ref) || ref === item.id)) return fail('INVALID_REFERENCE');
    }
    let reason: Exclusion | undefined;
    if (item.privacy === 'NEVER_EXPOSE' || (item.privacy === 'LOCAL_ONLY' && request.destination.locality === 'remote')) reason = 'privacy';
    else if (item.privacy === 'ASK') reason = 'release_required';
    else if (item.freshness.revoked) reason = 'revoked';
    else if (item.freshness.validUntil !== null && Date.parse(item.freshness.validUntil) <= now) reason = 'expired';
    else if (Date.parse(item.provenance.observedAt) > now ||
      (item.freshness.snapshotRef !== null && item.freshness.snapshotRef !== request.snapshotRef)) reason = 'stale';
    if (reason) unavailable.set(item.id, reason);
  }

  // Validate the whole reference graph, even excluded items, so malformed
  // inventory never silently becomes a usable future dependency.
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) fail('DEPENDENCY_CYCLE');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)!.selection.dependencies) visit(dep);
    visiting.delete(id); visited.add(id);
  }
  for (const item of ordered) visit(item.id);
  function closure(id: string, set: Set<string>): void {
    if (set.has(id)) return;
    set.add(id);
    for (const dep of byId.get(id)!.selection.dependencies) closure(dep, set);
  }
  function collision(set: Set<string>): Exclusion | null {
    const groups = new Set<string>();
    for (const item of ordered.filter(candidate => set.has(candidate.id))) {
      if (item.selection.conflicts.some(ref => set.has(ref))) return 'conflict';
      const group = item.selection.redundancyGroup;
      if (group !== null) {
        if (groups.has(group)) return 'redundant';
        groups.add(group);
      }
    }
    return null;
  }
  function workerFor(set: Set<string>): ContextWorkerProjectionT {
    return {
      role: request.role, destination: { ...request.destination },
      messages: ordered.filter(item => set.has(item.id)).map(item => ({ channel: 'untrusted_data', text: item.content }))
    };
  }
  function inputCost(set: Set<string>): number {
    // Estimated token units: one UTF-8 byte of serialized model messages per
    // unit, plus explicit provider framing reserve. This is NOT exact tokenizer
    // accounting or a universal tokenizer upper bound; adoption must recheck
    // actual provider framing/tokenization at the invocation boundary.
    return new TextEncoder().encode(canonicalContextJson(workerFor(set).messages)).byteLength + policy.framingReserveTokens;
  }
  function fits(set: Set<string>): boolean {
    const cost = inputCost(set);
    return cost <= policy.maxInputTokens && cost + policy.reservedOutputTokens + policy.safetyMarginTokens <= request.destination.servedContextLimit;
  }

  let selected = new Set<string>();
  for (const item of ordered.filter(item => item.selection.required)) closure(item.id, selected);
  for (const id of selected) {
    const reason = unavailable.get(id);
    if (reason) fail('REQUIRED_' + reason.toUpperCase());
  }
  const requiredCollision = collision(selected);
  if (requiredCollision) return fail('REQUIRED_' + requiredCollision.toUpperCase());
  if (!fits(selected)) return fail('REQUIRED_BUDGET');

  const reasons = new Map(unavailable);
  const ranked = [...items].sort((a, b) => Number(b.selection.pinned) - Number(a.selection.pinned) ||
    b.selection.relevance - a.selection.relevance || compare(a.id, b.id));
  const dependencies = new Set<string>();
  for (const item of ranked) {
    if (selected.has(item.id) || unavailable.has(item.id)) continue;
    const group = new Set<string>(); closure(item.id, group);
    const candidate = new Set([...selected, ...group]);
    const reason = [...group].some(id => unavailable.has(id)) ? 'dependency_unavailable' :
      collision(candidate) ?? (!fits(candidate) ? 'budget' : null);
    if (reason) { reasons.set(item.id, reason); continue; }
    selected = candidate;
  }
  for (const id of selected) for (const dep of byId.get(id)!.selection.dependencies) dependencies.add(dep);

  const worker = workerFor(selected);
  const included: ContextManifestT['included'] = [];
  for (const item of ordered.filter(item => selected.has(item.id))) {
    included.push({ item, contentDigest: await sha256(item.content), itemDigest: await sha256(canonicalContextJson(item)),
      reason: item.selection.required ? 'required' : dependencies.has(item.id) ? 'dependency' : 'ranked' });
  }
  const manifest: ContextManifestT = {
    request, requestDigest: await sha256(canonicalContextJson(request)),
    policy, policyDigest: await sha256(canonicalContextJson(policy)), included,
    excluded: ordered.filter(item => !selected.has(item.id)).map(item => ({
      itemId: item.id, revision: item.revision, source: item.source, reason: reasons.get(item.id) ?? 'budget'
    })),
    budget: {
      inputTokens: inputCost(selected), reservedOutputTokens: policy.reservedOutputTokens,
      safetyMarginTokens: policy.safetyMarginTokens, framingReserveTokens: policy.framingReserveTokens,
      servedContextLimit: request.destination.servedContextLimit, maxInputTokens: policy.maxInputTokens,
      measurement: 'conservative_estimate', counterVersion: 'utf8-bytes-plus-framing-v1'
    }
  };
  const unsigned = { schemaVersion: '1' as const, serialization: 'covert-context-json-v1' as const, manifest, worker };
  return freeze(ContextEnvelope.parse({ ...unsigned, digest: await sha256(canonicalContextJson(unsigned)) }));
}

/** Integrity comparison only. A matching hash is not authentic provenance,
 * fresh eligibility or execution authority; rebuilt decisions are still needed.
 */
export async function hasContextIntegrity(input: unknown): Promise<boolean> {
  const parsed = ContextEnvelope.safeParse(JSON.parse(canonicalContextJson(input)));
  if (!parsed.success) return false;
  const { digest, ...unsigned } = parsed.data;
  return digest === await sha256(canonicalContextJson(unsigned));
}
