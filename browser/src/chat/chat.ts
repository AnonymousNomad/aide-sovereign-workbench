/// <reference lib="dom" />
/// <reference lib="webworker" />

import { api } from '../services/api.ts';
import { egressFetch } from '../services/egress.ts';
import type { ChatMessageT } from '../../../common/contracts/chat.ts';

export interface ChatPanelOptions {
  onToast?: (code: string, message: string) => void;
}

export interface ChatPanel {
  refreshModels(): Promise<void>;
}

export function createChatPanel(container: HTMLElement, opts: ChatPanelOptions = {}): ChatPanel {
  container.innerHTML = `
    <div class="chat-panel">
      <div class="chat-toolbar">
        <label class="chat-model-label">Model</label>
        <select id="chat-model" class="chat-model-select"></select>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-row">
        <textarea id="chat-input" class="chat-input" rows="2" placeholder="Ask the local model…"></textarea>
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
  if (modelSelectEl === null || messagesEl === null || inputEl === null || sendBtnEl === null || stopBtnEl === null) throw new Error('chat panel mount failed');
  const modelSelect: HTMLSelectElement = modelSelectEl;
  const messages: HTMLElement = messagesEl;
  const input: HTMLTextAreaElement = inputEl;
  const sendButton: HTMLButtonElement = sendBtnEl;
  const stopButton: HTMLButtonElement = stopBtnEl;

  let conversationId: string | undefined;
  let history: ChatMessageT[] = [];
  let streaming = false;
  let controller: AbortController | null = null;

  async function refreshModels(): Promise<void> {
    try {
      const status = await api.modelsStatus();
      const current = modelSelect.value;
      modelSelect.textContent = '';
      for (const model of status.models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = `${model.name} (${model.status})`;
        modelSelect.appendChild(option);
      }
      if (current.length > 0 && [...modelSelect.options].some(option => option.value === current)) {
        modelSelect.value = current;
      } else if (modelSelect.options.length > 0 && modelSelect.value.length === 0) {
        modelSelect.selectedIndex = 0;
      }
    } catch {
      // models unavailable; picker stays empty
    }
  }

  async function restoreLatest(): Promise<void> {
    try {
      const payload = await api.chatHistory();
      const latest = payload.conversations[0];
      if (latest !== undefined) {
        conversationId = latest.id;
        history = latest.messages;
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
      const label = document.createElement('div');
      label.className = 'chat-message-label';
      label.textContent = message.role === 'user' ? 'you' : modelSelect.value || 'assistant';
      const body = document.createElement('div');
      body.className = 'chat-message-body';
      body.textContent = message.content;
      row.appendChild(label);
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

  async function persistConversation(): Promise<void> {
    if (history.length === 0) return;
    try {
      const title = history.find(message => message.role === 'user')?.content.slice(0, 60) ?? 'conversation';
      const request: { id?: string; modelId: string; title: string; messages: ChatMessageT[] } = {
        modelId: modelSelect.value,
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
    if (content.length === 0 || streaming || modelSelect.value.length === 0) return;
    input.value = '';
    history.push({ role: 'user', content });
    history.push({ role: 'assistant', content: '' });
    renderAll();
    setStreaming(true);
    const assistant = history[history.length - 1]!;
    const modelId = modelSelect.value;
    controller = new AbortController();
    try {
      const response = await egressFetch(`/api/chat/stream?modelId=${encodeURIComponent(modelId)}&prompt=${encodeURIComponent(content)}`, {
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
            const payload = JSON.parse(raw) as { delta?: string; done?: boolean; error?: string };
            if (payload.error !== undefined) {
              opts.onToast?.('INTERNAL', `model: ${payload.error}`);
            } else if (payload.delta !== undefined) {
              assistant.content += payload.delta;
              renderAll();
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
      renderAll();
      void persistConversation();
    }
  }

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
