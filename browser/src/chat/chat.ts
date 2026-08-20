/// <reference lib="dom" />
/// <reference lib="webworker" />

import { api } from '../services/api.ts';
import { egressFetch } from '../services/egress.ts';
import type { ChatMessageT } from '../../../common/contracts/chat.ts';
import type { RouteEntryT } from '../../../common/contracts/routing.ts';

export interface ChatPanelOptions {
  onToast?: (code: string, message: string) => void;
}

export interface ChatPanel {
  refreshModels(): Promise<void>;
}

const STATUS_ORDER: Record<string, number> = { ready: 0, starting: 1, unverified: 2, down: 3 };

function routeLabel(route: RouteEntryT): string {
  const status = route.status === 'down' ? ' (down)' : route.status === 'starting' ? ' (starting)' : '';
  return `${route.displayName} · ${route.providerType}${status}`;
}

export function createChatPanel(container: HTMLElement, opts: ChatPanelOptions = {}): ChatPanel {
  container.innerHTML = `
    <div class="chat-panel">
      <div class="chat-toolbar">
        <label class="chat-model-label">Model</label>
        <select id="chat-model" class="chat-model-select"></select>
        <span id="chat-meter" class="chat-meter"></span>
      </div>
      <div id="chat-banner" class="chat-banner"></div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-row">
        <textarea id="chat-input" class="chat-input" rows="2" placeholder="Ask the model…"></textarea>
        <button type="button" id="chat-send" class="chat-send">Send</button>
        <button type="button" id="chat-stop" class="chat-stop hidden">Stop</button>
      </div>
    </div>
  `;
  const modelSelectEl = container.querySelector<HTMLSelectElement>('#chat-model');
  const messagesEl = container.querySelector<HTMLElement>('#chat-messages');
  const inputEl = container.querySelector<HTMLTextAreaElement>('#chat-input');
  const sendBtnEl = container.querySelector<HTMLButtonElement>('#chat-send');
  const stopBtnEl = container.querySelector<HTMLButtonElement>('#chat-stop');
  const bannerEl = container.querySelector<HTMLElement>('#chat-banner');
  const meterEl = container.querySelector<HTMLElement>('#chat-meter');
  if (modelSelectEl === null || messagesEl === null || inputEl === null || sendBtnEl === null || stopBtnEl === null || bannerEl === null || meterEl === null) throw new Error('chat panel mount failed');
  const modelSelect: HTMLSelectElement = modelSelectEl;
  const messages: HTMLElement = messagesEl;
  const input: HTMLTextAreaElement = inputEl;
  const sendButton: HTMLButtonElement = sendBtnEl;
  const stopButton: HTMLButtonElement = stopBtnEl;
  const banner: HTMLElement = bannerEl;
  const meter: HTMLElement = meterEl;

  let routes: RouteEntryT[] = [];
  let boundModelId = '';
  let conversationId: string | undefined;
  let history: ChatMessageT[] = [];
  let streaming = false;
  let controller: AbortController | null = null;

  function orderedRoutes(): RouteEntryT[] {
    return [...routes].sort((a, b) => STATUS_ORDER[a.status]! - STATUS_ORDER[b.status]! || a.displayName.localeCompare(b.displayName));
  }

  function routeById(id: string): RouteEntryT | undefined {
    return routes.find(route => route.id === id);
  }

  async function refreshModels(): Promise<void> {
    try {
      routes = (await api.routes()).routes;
      const current = boundModelId;
      modelSelect.textContent = '';
      for (const route of orderedRoutes()) {
        const option = document.createElement('option');
        option.value = route.id;
        option.textContent = routeLabel(route);
        modelSelect.appendChild(option);
      }
      if (current.length > 0 && routeById(current) !== undefined) {
        modelSelect.value = current;
      } else {
        const ready = orderedRoutes().find(route => route.status === 'ready');
        modelSelect.value = ready?.id ?? (modelSelect.options.length > 0 ? modelSelect.options[0]!.value : '');
      }
      boundModelId = modelSelect.value;
      void refreshMeter();
    } catch {
      // routes unavailable; picker stays empty
    }
  }

  async function refreshMeter(): Promise<void> {
    const route = routeById(boundModelId);
    if (route === undefined || history.length === 0) {
      meter.textContent = '';
      return;
    }
    try {
      const fit = await api.fit(history, route.contextLength);
      meter.textContent = `~${fit.estimatedTokens} of ${route.contextLength} tokens (approx)`;
    } catch {
      meter.textContent = '';
    }
  }

  function restoreBinding(storedModelId: string): void {
    const candidates = [storedModelId, `local:${storedModelId}`];
    let route = candidates.map(routeById).find(entry => entry !== undefined);
    if (route === undefined) route = orderedRoutes().find(entry => entry.status === 'ready');
    if (route !== undefined) {
      boundModelId = route.id;
      modelSelect.value = route.id;
    }
  }

  async function restoreLatest(): Promise<void> {
    try {
      const payload = await api.chatHistory();
      const latest = payload.conversations[0];
      if (latest !== undefined) {
        conversationId = latest.id;
        history = latest.messages;
        restoreBinding(latest.modelId);
        renderAll();
      }
    } catch {
      // fresh conversation
    }
  }

  function renderAll(): void {
    messages.textContent = '';
    for (const message of history) {
      const row = document.createElement('div');
      row.className = `chat-message ${message.role}`;
      const labelRow = document.createElement('div');
      labelRow.className = 'chat-message-label-row';
      const label = document.createElement('div');
      label.className = 'chat-message-label';
      label.textContent = message.role === 'user' ? 'you' : routeById(boundModelId)?.displayName ?? 'assistant';
      labelRow.appendChild(label);
      if (message.role === 'assistant') {
        const reask = document.createElement('button');
        reask.type = 'button';
        reask.className = 'chat-reask';
        reask.textContent = 're-ask';
        reask.title = `Re-ask this turn with ${routeById(boundModelId)?.displayName ?? 'the current model'}`;
        reask.disabled = streaming;
        reask.addEventListener('click', () => {
          if (streaming) return;
          const index = history.indexOf(message);
          if (index >= 0) {
            history.splice(index);
            renderAll();
            void send();
          }
        });
        labelRow.appendChild(reask);
      }
      const body = document.createElement('div');
      body.className = 'chat-message-body';
      body.textContent = message.content;
      row.appendChild(labelRow);
      row.appendChild(body);
      messages.appendChild(row);
    }
    messages.scrollTop = messages.scrollHeight;
  }

  function setStreaming(value: boolean): void {
    streaming = value;
    sendButton.disabled = value;
    stopButton.classList.toggle('hidden', !value);
  }

  function showBanner(text: string): void {
    banner.textContent = text;
    banner.classList.add('visible');
  }

  function hideBanner(): void {
    banner.textContent = '';
    banner.classList.remove('visible');
  }

  async function persistConversation(): Promise<void> {
    if (history.length === 0) return;
    try {
      const title = history.find(message => message.role === 'user')?.content.slice(0, 60) ?? 'conversation';
      const request: { id?: string; modelId: string; title: string; messages: ChatMessageT[] } = {
        modelId: boundModelId,
        title,
        messages: history
      };
      if (conversationId !== undefined) request.id = conversationId;
      const saved = await api.chatHistorySave(request);
      conversationId = saved.id;
    } catch {
      // persistence is best-effort
    }
  }

  async function send(): Promise<void> {
    const content = input.value.trim();
    if (content.length === 0 && history[history.length - 1]?.role !== 'user') return;
    if (streaming || boundModelId.length === 0) return;
    if (content.length > 0) {
      input.value = '';
      history.push({ role: 'user', content });
    }
    history.push({ role: 'assistant', content: '' });
    renderAll();
    setStreaming(true);
    const assistant = history[history.length - 1]!;
    const modelId = boundModelId;
    controller = new AbortController();
    try {
      const response = await egressFetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId, messages: history }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`daemon returned HTTP ${response.status}`);
      if (response.body === null) throw new Error('daemon returned no stream');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (raw.length === 0) continue;
          try {
            const payload = JSON.parse(raw) as { delta?: string; done?: boolean; error?: string; modelId?: string; usedApprox?: number; dropped?: number; truncatedSystem?: boolean };
            if (payload.error !== undefined) {
              opts.onToast?.('INTERNAL', `model: ${payload.error}`);
            } else if (payload.delta !== undefined) {
              assistant.content += payload.delta;
              renderAll();
            } else if (payload.done === true) {
              const used = payload.usedApprox;
              const dropped = payload.dropped;
              const truncated = payload.truncatedSystem === true;
              const route = routeById(payload.modelId ?? boundModelId);
              if (used !== undefined && route !== undefined) {
                meter.textContent = `~${used} of ${route.contextLength} tokens (approx)`;
              }
              if (payload.modelId !== undefined && payload.modelId !== modelId) {
                const fellTo = routeById(payload.modelId);
                const fellFrom = routeById(modelId);
                showBanner(`${fellFrom?.displayName ?? modelId} is down — this answer came from ${fellTo?.displayName ?? payload.modelId}`);
              }
              if (truncated) {
                opts.onToast?.('INTERNAL', 'model: the system prompt did not fit the model context and was truncated');
              } else if (dropped !== undefined && dropped > 0) {
                showBanner(`the model window fits the most recent turns; ${dropped} older turn(s) were not sent to ${route?.displayName ?? 'the model'}`);
              }
            }
          } catch {
            // skip malformed events
          }
        }
      }
      if (assistant.content.length === 0) {
        history.pop();
        opts.onToast?.('NOT_READY', 'the model returned an empty response');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (assistant.content.length === 0) history.pop();
        else assistant.content += '\n[stopped]';
      } else {
        history.pop();
        opts.onToast?.('INTERNAL', error instanceof Error ? error.message : 'chat failed');
      }
    } finally {
      setStreaming(false);
      controller = null;
      hideBanner();
      renderAll();
      void persistConversation();
      void refreshMeter();
    }
  }

  modelSelect.addEventListener('change', () => {
    const previous = boundModelId;
    const next = modelSelect.value;
    if (next === previous) return;
    const from = routeById(previous);
    const to = routeById(next);
    boundModelId = next;
    if (from !== undefined && to !== undefined && to.contextLength < from.contextLength) {
      showBanner(`switching from ${from.displayName} (${from.contextLength} ctx) to ${to.displayName} (${to.contextLength} ctx) — the most recent turns will be kept, older ones are not sent`);
    }
    void refreshMeter();
  });

  sendButton.addEventListener('click', () => void send());
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  });
  stopButton.addEventListener('click', () => {
    controller?.abort();
  });

  void restoreLatest();
  void refreshModels();

  return { refreshModels };
}