import { randomUUID } from 'node:crypto';

// Private Node IPC only. The supervisor supplies the ChildProcess reference;
// a message's claimed role, PID, Origin or headers never select its authority.
// No TCP token minting, credential files, URL secrets, or fallback credentials.
export function connectAuthorityChannel(peer, handle = async () => { throw new Error('private authority operation unavailable'); }) {
  if (typeof peer?.send !== 'function' || typeof peer?.on !== 'function') throw new TypeError('owned IPC endpoint required');
  const pending = new Map();
  let closed = false;
  function send(message) {
    return new Promise((resolve, reject) => {
      if (closed || peer.connected === false) { reject(new Error('authority IPC disconnected')); return; }
      try { peer.send({ protocol: 'covert-authority-v1', ...message }, error => error ? reject(error) : resolve()); }
      catch (error) { reject(error); }
    });
  }
  function close() {
    if (closed) return;
    closed = true;
    peer.off('message', onMessage);
    peer.off('disconnect', close);
    peer.off('exit', close);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('authority IPC disconnected')); }
    pending.clear();
  }
  async function onMessage(message) {
    if (closed || !message || message.protocol !== 'covert-authority-v1' || typeof message.id !== 'string') return;
    if (message.type === 'response') {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.ok === true) entry.resolve(message.value);
      else entry.reject(Object.assign(new Error('private authority request denied or unavailable'), { code: message.code ?? 'NOT_READY' }));
      return;
    }
    if (message.type !== 'request' || typeof message.method !== 'string') return;
    try {
      const value = await handle(message.method, message.payload);
      await send({ type: 'response', id: message.id, ok: true, value });
    } catch (error) {
      // Never echo payloads, credentials, arbitrary exception text or stacks.
      const code = ['FORBIDDEN', 'CONFLICT', 'BAD_REQUEST', 'NOT_READY', 'NOT_FOUND'].includes(error?.code) ? error.code : 'NOT_READY';
      try { await send({ type: 'response', id: message.id, ok: false, code }); }
      catch { close(); }
    }
  }
  peer.on('message', onMessage);
  peer.once('disconnect', close);
  peer.once('exit', close);
  return Object.freeze({
    call(method, payload, timeoutMs = 10000) {
      if (closed || peer.connected === false) return Promise.reject(new Error('authority IPC disconnected'));
      if (pending.size >= 256) return Promise.reject(new Error('authority IPC capacity exceeded'));
      if (typeof method !== 'string' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return Promise.reject(new TypeError('invalid authority IPC request'));
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('authority IPC request expired; execution state unknown; do not replay')); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        void send({ type: 'request', id, method, payload }).catch(error => { clearTimeout(timer); pending.delete(id); reject(error); });
      });
    },
    close
  });
}

// Only the launch supervisor possesses these exact child-channel references.
// Adapters may ask for transport authentication, never operator pairing.
export function superviseAuthority(archChild) {
  const adapters = new Map();
  const arch = connectAuthorityChannel(archChild, async (method, payload) => {
    if (!['legacy.describe', 'legacy.invoke'].includes(method) || !adapters.has('legacy')) {
      throw Object.assign(new Error('private adapter unavailable'), { code: 'FORBIDDEN' });
    }
    return adapters.get('legacy').call(method, payload, 120000);
  });
  return Object.freeze({
    attach(role, child) {
      if (!['facade', 'legacy'].includes(role) || adapters.has(role)) throw new TypeError('invalid or duplicate authority adapter');
      const channel = connectAuthorityChannel(child, async (method, payload) => {
        if (method === 'transport.authenticate') return arch.call(method, payload);
        if (role === 'legacy' && method === 'legacy.execute') return arch.call(method, payload, 120000);
        throw Object.assign(new Error('adapter cannot establish authority'), { code: 'FORBIDDEN' });
      });
      adapters.set(role, channel);
    },
    pairing(origin) { return arch.call('supervisor.pairing', { origin }, 60000); },
    authenticate(token, origin) { return arch.call('transport.authenticate', { token, origin }); },
    async ready() {
      return { arch: await arch.call('supervisor.ready', {}, 60000),
        legacy: adapters.has('legacy') ? await adapters.get('legacy').call('legacy.ready', {}, 60000) : null };
    },
    close() { arch.close(); for (const channel of adapters.values()) channel.close(); adapters.clear(); }
  });
}
