import { promises as fs } from 'node:fs';

export class ProviderManager {
  constructor(manifestPath) { this.manifestPath = manifestPath; this.providers = []; }
  async load() { this.providers = JSON.parse(await fs.readFile(this.manifestPath, 'utf8')).providers || []; return this.list(); }
  list() { return this.providers.map(provider => ({ id: provider.id, name: provider.name, kind: provider.kind, endpoint: provider.endpoint, model: provider.model, offline: provider.offline, configured: provider.offline || Boolean(provider.credential_env && process.env[provider.credential_env]) })); }
  get(id) { return this.providers.find(provider => provider.id === id); }
  async chat(id, messages, options = {}) {
    const provider = this.get(id); if (!provider) throw new Error('provider is not allowlisted');
    if (!provider.offline && (!provider.credential_env || !process.env[provider.credential_env])) throw new Error(`${provider.name} is not configured; set ${provider.credential_env} outside AIDE`);
    if (provider.kind === 'anthropic') return this.#anthropic(provider, messages, options);
    if (provider.kind === 'gemini') return this.#gemini(provider, messages, options);
    const headers = { 'Content-Type': 'application/json' }; if (provider.credential_env) headers.Authorization = `Bearer ${process.env[provider.credential_env]}`;
    const response = await fetch(`${provider.endpoint.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: provider.model, messages, temperature: 0.2, max_tokens: Math.min(options.max_tokens || 512, 1024) }) });
    if (!response.ok) throw new Error(`${provider.name} returned HTTP ${response.status}`); return response.json();
  }
  async #anthropic(provider, messages, options) {
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
    const response = await fetch(`${provider.endpoint}/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env[provider.credential_env], 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: provider.model, system, messages: messages.filter(message => message.role !== 'system'), max_tokens: Math.min(options.max_tokens || 512, 1024) }) });
    if (!response.ok) throw new Error(`${provider.name} returned HTTP ${response.status}`); const data = await response.json(); return { choices: [{ message: { role: 'assistant', content: data.content?.map(item => item.text || '').join('') || '' } }] };
  }
  async #gemini(provider, messages, options) {
    const contents = messages.filter(message => message.role !== 'system').map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }));
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n'); if (system) contents.unshift({ role: 'user', parts: [{ text: system }] });
    const url = `${provider.endpoint}/models/${provider.model}:generateContent?key=${encodeURIComponent(process.env[provider.credential_env])}`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: Math.min(options.max_tokens || 512, 1024), temperature: 0.2 } }) });
    if (!response.ok) throw new Error(`${provider.name} returned HTTP ${response.status}`); const data = await response.json(); return { choices: [{ message: { role: 'assistant', content: data.candidates?.[0]?.content?.parts?.map(item => item.text || '').join('') || '' } }] };
  }
}
