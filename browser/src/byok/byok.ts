import { api, ApiError } from '../services/api.ts';
import type { ByokStatusResponseT } from '../../../common/contracts/byok.ts';

export interface ByokPanelOptions {
  onToast: (code: string, message: string) => void;
}

export interface ByokPanel {
  refresh(): Promise<void>;
}

const ROLES = ['plan', 'act', 'utility'] as const;
type Role = (typeof ROLES)[number];

function renderProviderRow(list: HTMLElement, provider: ByokStatusResponseT['providers'][number], actions: {
  onEdit(): void;
  onDelete(): void;
}): void {
  const row = document.createElement('div');
  row.className = 'byok-row';
  row.dataset.providerId = provider.id;
  const dot = document.createElement('span');
  dot.className = provider.key_stored ? 'provider-dot connected' : 'provider-dot disconnected';
  const name = document.createElement('span');
  name.className = 'provider-name';
  name.textContent = provider.name;
  const status = document.createElement('span');
  status.className = 'provider-status';
  status.textContent = `${provider.model_id} · key ${provider.key_stored ? 'stored' : 'missing'}`;
  const test = document.createElement('button');
  test.type = 'button';
  test.className = 'provider-action';
  test.textContent = 'Test';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'provider-action';
  edit.textContent = provider.key_stored ? 'Replace key' : 'Set key';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'provider-action danger';
  remove.textContent = 'Delete';
  test.addEventListener('click', () => {
    test.disabled = true;
    status.textContent = 'testing…';
    api
      .byokTest(provider.id)
      .then(result => {
        status.textContent = result.ok ? `reachable (${result.detail})` : `failed: ${result.detail}`;
        opts.onToast(result.ok ? 'OK' : 'NOT_READY', result.detail);
      })
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'test failed';
        status.textContent = message;
        opts.onToast('INTERNAL', message);
      })
      .finally(() => {
        test.disabled = false;
      });
  });
  edit.addEventListener('click', actions.onEdit);
  remove.addEventListener('click', actions.onDelete);
  row.appendChild(dot);
  row.appendChild(name);
  row.appendChild(status);
  row.appendChild(test);
  row.appendChild(edit);
  row.appendChild(remove);
  list.appendChild(row);
}

let opts: ByokPanelOptions;

export function createByokPanel(container: HTMLElement, options: ByokPanelOptions): ByokPanel {
  opts = options;
  container.innerHTML = `
    <div class="byok-panel">
      <h3 class="providers-title">BYOK models</h3>
      <p class="providers-note">Route plan/act/utility to your own API-key providers. Local GGUF stays the default; egress happens ONLY after you enable consent below — every outbound call is journaled.</p>
      <label class="byok-consent"><input type="checkbox" id="byok-consent" /> Allow outbound calls to configured providers (journaled)</label>
      <div class="byok-list" id="byok-list"></div>
      <h3 class="providers-title">Add provider</h3>
      <div class="byok-form">
        <input type="text" id="byok-name" placeholder="Name (e.g. OpenRouter)" class="provider-base" />
        <input type="text" id="byok-baseurl" placeholder="Base URL ending in /v1" class="provider-base" />
        <input type="text" id="byok-model" placeholder="Model ID" class="provider-base" />
        <input type="password" id="byok-key" placeholder="API key (stored encrypted, never shown again)" class="provider-key" />
        <button type="button" id="byok-add" class="provider-confirm">Save provider</button>
      </div>
      <h3 class="providers-title">Role routing</h3>
      <div class="byok-routing" id="byok-routing"></div>
    </div>
  `;
  const list = container.querySelector<HTMLElement>('#byok-list');
  const consentBox = container.querySelector<HTMLInputElement>('#byok-consent');
  const nameInput = container.querySelector<HTMLInputElement>('#byok-name');
  const baseInput = container.querySelector<HTMLInputElement>('#byok-baseurl');
  const modelInput = container.querySelector<HTMLInputElement>('#byok-model');
  const keyInput = container.querySelector<HTMLInputElement>('#byok-key');
  const addButton = container.querySelector<HTMLButtonElement>('#byok-add');
  const routingBox = container.querySelector<HTMLElement>('#byok-routing');
  if (list === null || consentBox === null || nameInput === null || baseInput === null || modelInput === null || keyInput === null || addButton === null || routingBox === null) throw new Error('byok panel mount failed');
  const listEl: HTMLElement = list;
  const consentEl: HTMLInputElement = consentBox;
  const routingEl: HTMLElement = routingBox;
  const nameEl: HTMLInputElement = nameInput;
  const baseEl: HTMLInputElement = baseInput;
  const modelEl: HTMLInputElement = modelInput;
  const keyEl: HTMLInputElement = keyInput;
  const addEl: HTMLButtonElement = addButton;

  function toast(code: string, message: string): void {
    opts.onToast(code, message);
  }

  async function refreshRouting(status: ByokStatusResponseT): Promise<void> {
    routingEl.textContent = '';
    for (const role of ROLES) {
      const line = document.createElement('div');
      line.className = 'byok-role-row';
      const label = document.createElement('span');
      label.className = 'byok-role-label';
      label.textContent = role;
      const select = document.createElement('select');
      select.className = 'byok-role-select';
      select.dataset.role = role;
      const localOption = document.createElement('option');
      localOption.value = 'local';
      localOption.textContent = 'Local GGUF';
      select.appendChild(localOption);
      for (const provider of status.providers) {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = `${provider.name} · ${provider.model_id}`;
        select.appendChild(option);
      }
      const current = status.routing[role];
      if (current !== 'local') select.value = current.provider_id;
      else select.value = 'local';
      select.addEventListener('change', () => {
        const providerId = select.value;
        if (providerId === 'local') {
          void applyRouting(role, 'local');
          return;
        }
        const provider = status.providers.find(p => p.id === providerId);
        if (provider === undefined) return;
        void applyRouting(role, { provider_id: provider.id, model_id: provider.model_id });
      });
      line.appendChild(label);
      line.appendChild(select);
      routingEl.appendChild(line);
    }
    lastStatus = status;
  }

  async function applyRouting(role: Role, target: 'local' | { provider_id: string; model_id: string }): Promise<void> {
    const routing: Record<string, 'local' | { provider_id: string; model_id: string }> = {};
    for (const other of ROLES) {
      const select = routingEl.querySelector<HTMLSelectElement>(`.byok-role-select[data-role="${other}"]`);
      if (other === role) {
        routing[other] = target;
        continue;
      }
      const providerId = select?.value ?? 'local';
      const provider = lastStatus.providers.find(p => p.id === providerId);
      routing[other] = provider === undefined ? 'local' : { provider_id: provider.id, model_id: provider.model_id };
    }
    try {
      await api.byokSetRouting(routing as ByokStatusResponseT['routing']);
      toast('OK', `${role} routed`);
    } catch (error) {
      toast('INTERNAL', error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'routing failed');
      await refresh();
    }
  }

  let lastStatus: ByokStatusResponseT = {
    providers: [],
    routing: { plan: 'local', act: 'local', utility: 'local' },
    consent_enabled: false
  };

  async function refresh(): Promise<void> {
    let status: ByokStatusResponseT;
    try {
      status = await api.byokStatus();
    } catch {
      listEl.textContent = '';
      toast('INTERNAL', 'BYOK unavailable');
      return;
    }
    consentEl.checked = status.consent_enabled;
    listEl.textContent = '';
    for (const provider of status.providers) {
      renderProviderRow(listEl, provider, {
        onEdit: () => {
          keyEl.value = '';
          keyEl.dataset.forProvider = provider.id;
          keyEl.focus();
          toast('OK', `paste a new key, then press Save provider with matching fields for ${provider.id}`);
        },
        onDelete: () => {
          void api
            .byokDeleteProvider(provider.id)
            .then(() => void refresh())
            .catch((error: unknown) => toast('INTERNAL', error instanceof Error ? error.message : 'delete failed'));
        }
      });
    }
    await refreshRouting(status);
  }

  consentEl.addEventListener('change', () => {
    void api
      .byokConsent(consentBox.checked)
      .then(() => toast('OK', consentEl.checked ? 'egress consent ENABLED — calls will be journaled' : 'egress consent disabled'))
      .catch((error: unknown) => {
        consentEl.checked = !consentEl.checked;
        toast('INTERNAL', error instanceof Error ? error.message : 'consent toggle failed');
      });
  });

  addEl.addEventListener('click', () => {
    const name = nameEl.value.trim();
    const baseUrl = baseEl.value.trim().replace(/\/$/, '');
    const modelId = modelEl.value.trim();
    const apiKey = keyEl.value.trim();
    if (name.length === 0 || baseUrl.length === 0 || modelId.length === 0 || apiKey.length === 0) {
      toast('BAD_REQUEST', 'name, base URL, model ID and key are all required');
      return;
    }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    addEl.disabled = true;
    void (async () => {
      try {
        await api.byokSetProvider({ id, name, base_url: baseUrl, api_type: 'chat-completions', model_id: modelId, tool_calling: false });
        await api.byokPutKey(id, apiKey);
        nameEl.value = '';
        baseEl.value = '';
        modelEl.value = '';
        keyEl.value = '';
        delete keyEl.dataset.forProvider;
        toast('OK', `provider ${id} saved`);
        await refresh();
      } catch (error) {
        const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'save failed';
        toast('INTERNAL', message);
      } finally {
        addEl.disabled = false;
      }
    })();
  });

  void refresh();

  return { refresh };
}
