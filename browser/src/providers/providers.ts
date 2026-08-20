import { api, ApiError } from '../services/api.ts';
import type { ProviderInfoT, ProviderConnectionStatusT } from '../../../common/contracts/providers.ts';

export interface ProvidersPanelOptions {
  onToast: (code: string, message: string) => void;
}

export interface ProvidersPanel {
  refresh(): Promise<void>;
}

const MAX_IMPORT_BYTES = 10_000_000;

function statusClass(status: ProviderConnectionStatusT): string {
  return `provider-dot ${status}`;
}

function statusText(status: ProviderConnectionStatusT): string {
  return status.replace(/_/g, ' ');
}

function renderRow(list: HTMLElement, provider: ProviderInfoT, onAction: (row: HTMLElement) => void): void {
  const row = document.createElement('div');
  row.className = 'provider-row';
  row.dataset.providerId = provider.id;
  const dot = document.createElement('span');
  dot.className = statusClass(provider.status);
  dot.title = statusText(provider.status);
  const name = document.createElement('span');
  name.className = 'provider-name';
  name.textContent = provider.name;
  const status = document.createElement('span');
  status.className = 'provider-status';
  status.textContent = statusText(provider.status);
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'provider-action';
  action.textContent = provider.status === 'connected' ? 'Disconnect' : 'Connect';
  action.addEventListener('click', () => onAction(row));
  row.appendChild(dot);
  row.appendChild(name);
  row.appendChild(status);
  row.appendChild(action);
  list.appendChild(row);
}

function renderConnectForm(row: HTMLElement, provider: ProviderInfoT, onToast: (code: string, message: string) => void, refresh: () => Promise<void>): void {
  row.replaceChildren();
  const form = document.createElement('div');
  form.className = 'provider-form';

  const keyLabel = document.createElement('label');
  keyLabel.className = 'provider-label';
  keyLabel.textContent = 'API key (stored encrypted by the daemon, never shown again)';
  const key = document.createElement('input');
  key.type = 'password';
  key.className = 'provider-key';
  key.placeholder = 'paste your API key';
  keyLabel.appendChild(key);

  const baseLabel = document.createElement('label');
  baseLabel.className = 'provider-label';
  baseLabel.textContent = 'Base URL';
  const baseUrl = document.createElement('input');
  baseUrl.type = 'text';
  baseUrl.className = 'provider-base';
  baseUrl.value = provider.baseUrl;
  baseUrl.spellcheck = false;
  baseLabel.appendChild(baseUrl);

  const modelLabel = document.createElement('label');
  modelLabel.className = 'provider-label';
  modelLabel.textContent = 'Model (optional)';
  const model = document.createElement('input');
  model.type = 'text';
  model.className = 'provider-model';
  model.placeholder = provider.models.join(', ');
  modelLabel.appendChild(model);

  const approveRow = document.createElement('label');
  approveRow.className = 'provider-approve';
  const approve = document.createElement('input');
  approve.type = 'checkbox';
  approve.className = 'provider-approve-input';
  approveRow.appendChild(approve);
  const approveText = document.createElement('span');
  approveText.textContent = 'This is a custom host — I approve connecting to it';
  approveRow.appendChild(approveText);

  const actions = document.createElement('div');
  actions.className = 'provider-form-actions';
  const connect = document.createElement('button');
  connect.type = 'button';
  connect.className = 'provider-confirm';
  connect.textContent = 'Connect';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'provider-cancel';
  cancel.textContent = 'Cancel';
  actions.appendChild(connect);
  actions.appendChild(cancel);

  const result = document.createElement('div');
  result.className = 'provider-result';

  form.appendChild(keyLabel);
  form.appendChild(baseLabel);
  form.appendChild(modelLabel);
  form.appendChild(approveRow);
  form.appendChild(actions);
  form.appendChild(result);
  row.appendChild(form);

  const showApprove = (): void => {
    let custom: boolean;
    try {
      custom = new URL(baseUrl.value).hostname !== new URL(provider.baseUrl).hostname;
    } catch {
      custom = true;
    }
    approveRow.classList.toggle('hidden', !custom);
  };
  baseUrl.addEventListener('input', showApprove);
  showApprove();

  connect.addEventListener('click', () => {
    const keyValue = key.value.trim();
    if (keyValue.length === 0) {
      onToast('NOT_READY', 'paste an API key to connect');
      return;
    }
    connect.disabled = true;
    result.textContent = 'checking…';
    api
      .providerConnect({
        providerId: provider.id,
        key: keyValue,
        baseUrl: baseUrl.value.trim() || undefined,
        model: model.value.trim() || undefined,
        approveHost: approve.checked
      })
      .then(response => {
        result.textContent = response.message;
        if (response.status !== 'connected') {
          onToast(response.status === 'invalid_key' ? 'NOT_READY' : 'INTERNAL', response.message);
        }
        void refresh();
      })
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'connect failed';
        result.textContent = message;
        onToast('INTERNAL', message);
        connect.disabled = false;
      });
  });

  cancel.addEventListener('click', () => void refresh());
}

export function createProvidersPanel(container: HTMLElement, opts: ProvidersPanelOptions): ProvidersPanel {
  container.innerHTML = `
    <div class="providers-panel">
      <h3 class="providers-title">Providers</h3>
      <p class="providers-note">Local GGUF models stay the default. Online providers are opt-in: a ChatGPT/Claude/Gemini subscription does NOT grant API access — connect with an API key from the provider console.</p>
      <div class="provider-list" id="provider-list"></div>
      <h3 class="providers-title">Import chat history</h3>
      <div class="import-row">
        <input type="file" id="import-file" accept=".json,application/json" class="import-file" />
        <span class="import-status" id="import-status"></span>
      </div>
      <p class="providers-note">Import a ChatGPT or Claude <code>conversations.json</code> export (JSON, up to 10 MB). Imports are additive and stored locally.</p>
    </div>
  `;
  const list = container.querySelector<HTMLElement>('#provider-list');
  const fileInput = container.querySelector<HTMLInputElement>('#import-file');
  const importStatus = container.querySelector<HTMLElement>('#import-status');
  if (list === null || fileInput === null || importStatus === null) throw new Error('providers panel mount failed');
  const listEl: HTMLElement = list;

  async function refresh(): Promise<void> {
    let providers: ProviderInfoT[];
    try {
      providers = (await api.providers()).providers;
    } catch {
      listEl.textContent = '';
      opts.onToast('INTERNAL', 'providers unavailable');
      return;
    }
    listEl.textContent = '';
    for (const provider of providers) {
      renderRow(listEl, provider, row => {
        if (provider.status === 'connected') {
          api
            .providerDisconnect(provider.id)
            .then(() => void refresh())
            .catch((error: unknown) => opts.onToast('INTERNAL', error instanceof Error ? error.message : 'disconnect failed'));
        } else {
          renderConnectForm(row, provider, opts.onToast, refresh);
        }
      });
    }
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file === undefined) return;
    importStatus.textContent = 'reading…';
    void (async () => {
      if (file.size > MAX_IMPORT_BYTES) {
        importStatus.textContent = 'file is larger than 10 MB';
        opts.onToast('PAYLOAD_TOO_LARGE', 'import file is larger than 10 MB');
        return;
      }
      const text = await file.text();
      let format: 'chatgpt' | 'claude';
      try {
        const parsed = JSON.parse(text) as { mapping?: unknown; conversations?: unknown };
        const entries = (Array.isArray(parsed) ? parsed : Array.isArray(parsed.conversations) ? parsed.conversations : []) as { mapping?: unknown; chat_messages?: unknown }[];
        if (parsed.mapping !== undefined || entries.some(entry => entry.mapping !== undefined)) {
          format = 'chatgpt';
        } else if (entries.some(entry => entry.chat_messages !== undefined)) {
          format = 'claude';
        } else {
          throw new Error('could not detect export format');
        }
      } catch (error) {
        importStatus.textContent = 'not a recognized export';
        opts.onToast('NOT_READY', error instanceof Error ? error.message : 'import failed');
        return;
      }
      importStatus.textContent = 'importing…';
      try {
        const outcome = await api.providerImport(format, text);
        const warningText = outcome.warnings.length > 0 ? ` (${outcome.warnings[0]})` : '';
        importStatus.textContent = `imported ${outcome.imported} chat(s), skipped ${outcome.skipped}${warningText}`;
      } catch (error) {
        const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'import failed';
        importStatus.textContent = message;
        opts.onToast('NOT_READY', message);
      }
    })();
    fileInput.value = '';
  });

  void refresh();

  return { refresh };
}