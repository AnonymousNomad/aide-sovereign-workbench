import fs from 'node:fs';
import path from 'node:path';

export function createByokService(options) {
  const workspace = options.workspace;
  const secretStore = options.secretStore;
  const byokDir = path.join(workspace, '.aide', 'byok');
  const providersPath = path.join(byokDir, 'providers.json');
  const routingPath = path.join(byokDir, 'routing.json');
  const consentPath = path.join(byokDir, 'consent.json');
  const fetchImpl = options.fetchImpl ?? null;
  const onEgress = options.onEgress ?? (() => {});

  function readJson(filePath, fallback) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return fallback;
    }
  }

  function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 1), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  function listProviders() {
    const stored = new Set(secretStore.listProviderIds());
    return readJson(providersPath, []).map(provider => ({ ...provider, key_stored: stored.has(provider.id) }));
  }

  function setProvider(provider) {
    const providers = readJson(providersPath, []).filter(p => p.id !== provider.id);
    providers.push({ ...provider, tool_calling: provider.tool_calling ?? false, api_type: provider.api_type ?? 'chat-completions' });
    writeJson(providersPath, providers);
    return { ...provider, key_stored: secretStore.listProviderIds().includes(provider.id) };
  }

  function deleteProvider(id) {
    writeJson(providersPath, readJson(providersPath, []).filter(p => p.id !== id));
    secretStore.deleteKey(id);
    return { deleted: true };
  }

  function putKey(providerId, apiKey) {
    if (!listProviders().some(p => p.id === providerId)) {
      throw Object.assign(new Error(`unknown provider: ${providerId}`), { code: 'NOT_FOUND' });
    }
    secretStore.setKey(providerId, apiKey);
    return { stored: true };
  }

  function deleteKey(providerId) {
    return { deleted: secretStore.deleteKey(providerId) };
  }

  function getRouting() {
    const routing = readJson(routingPath, {});
    return { plan: routing.plan ?? 'local', act: routing.act ?? 'local', utility: routing.utility ?? 'local' };
  }

  function setRouting(routing) {
    writeJson(routingPath, getRouting() && routing);
    return getRouting();
  }

  function getConsent() {
    return readJson(consentPath, { enabled: false }).enabled === true;
  }

  function setConsent(enabled) {
    writeJson(consentPath, { enabled: enabled === true });
    return getConsent();
  }

  function status() {
    return { providers: listProviders(), routing: getRouting(), consent_enabled: getConsent() };
  }

  async function testProvider(providerId, fetchOverride) {
    const provider = listProviders().find(p => p.id === providerId);
    if (!provider) throw Object.assign(new Error(`unknown provider: ${providerId}`), { code: 'NOT_FOUND' });
    const apiKey = secretStore.getKey(providerId);
    if (!apiKey) throw Object.assign(new Error(`no key stored for ${providerId}`), { code: 'NOT_FOUND' });
    if (!getConsent()) throw Object.assign(new Error('egress consent disabled'), { code: 'FORBIDDEN' });
    const doFetch = fetchOverride ?? fetchImpl;
    if (!doFetch) throw Object.assign(new Error('no fetch transport available'), { code: 'NOT_READY' });
    onEgress({ kind: 'byok-test', provider_id: providerId, host: new URL(provider.base_url).host });
    try {
      const response = await doFetch(`${provider.base_url.replace(/\/$/, '')}/models`, {
        headers: { authorization: `Bearer ${apiKey}` }
      });
      return { ok: response.ok, detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status} from provider` };
    } catch (error) {
      return { ok: false, detail: String(error.message).slice(0, 200) };
    }
  }

  function resolveChatFn(role) {
    const target = getRouting()[role] ?? 'local';
    if (target === 'local' || !getConsent()) return null;
    const provider = listProviders().find(p => p.id === target.provider_id);
    if (!provider || !secretStore.getKey(target.provider_id)) return null;
    const doFetch = fetchImpl;
    if (!doFetch) return null;
    return async messages => {
      onEgress({ kind: 'byok-chat', role, provider_id: provider.id, host: new URL(provider.base_url).host });
      const response = await doFetch(`${provider.base_url.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secretStore.getKey(target.provider_id)}` },
        body: JSON.stringify({ model: target.model_id, messages })
      });
      if (!response.ok) throw new Error(`provider HTTP ${response.status}`);
      const payload = await response.json();
      return payload?.choices?.[0]?.message?.content ?? '';
    };
  }

  return {
    status, setProvider, deleteProvider, putKey, deleteKey,
    getRouting, setRouting, getConsent, setConsent, testProvider, resolveChatFn
  };
}
