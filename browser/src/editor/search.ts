import type { SearchResponseT } from '../../../common/contracts/search.ts';
import { api } from '../services/api.ts';
import type { EditorHost } from './host.ts';
import { openPaths, isDirty, reloadClean } from './models.ts';
import { revealLine } from './views.ts';

export interface SearchPanelDeps {
  host: EditorHost;
  onToast: (code: string, message: string) => void;
}

interface SearchOpts {
  q: string;
  regex: boolean;
  icase: boolean;
  word: boolean;
  mask: string;
}

function toRelPath(entryPath: string): string {
  return entryPath.replace(/\//g, '\\');
}

export function createSearchPanel(container: HTMLElement, deps: SearchPanelDeps): void {
  const form = document.createElement('form');
  form.className = 'search-form';
  form.autocomplete = 'off';

  const input = document.createElement('input');
  input.type = 'search';
  input.id = 'search-q';
  input.placeholder = 'Search workspace…';
  input.setAttribute('aria-label', 'Search workspace');

  const searchButton = document.createElement('button');
  searchButton.type = 'submit';
  searchButton.textContent = 'Search';

  form.append(input, searchButton);

  const optsRow = document.createElement('div');
  optsRow.className = 'search-opts';

  const caseBox = document.createElement('label');
  caseBox.className = 'search-opt';
  const caseInput = document.createElement('input');
  caseInput.type = 'checkbox';
  const caseText = document.createElement('span');
  caseText.textContent = 'Aa';
  caseBox.append(caseInput, caseText);

  const wordBox = document.createElement('label');
  wordBox.className = 'search-opt';
  const wordInput = document.createElement('input');
  wordInput.type = 'checkbox';
  const wordText = document.createElement('span');
  wordText.textContent = '\\b';
  wordBox.append(wordInput, wordText);

  const regexBox = document.createElement('label');
  regexBox.className = 'search-opt';
  const regexInput = document.createElement('input');
  regexInput.type = 'checkbox';
  const regexText = document.createElement('span');
  regexText.textContent = '.*';
  regexBox.append(regexInput, regexText);

  const maskInput = document.createElement('input');
  maskInput.type = 'text';
  maskInput.className = 'search-mask';
  maskInput.placeholder = 'mask (*.ts)';
  maskInput.setAttribute('aria-label', 'File mask');

  optsRow.append(caseBox, wordBox, regexBox, maskInput);

  const replaceRow = document.createElement('div');
  replaceRow.className = 'search-replace';

  const replaceInput = document.createElement('input');
  replaceInput.type = 'text';
  replaceInput.id = 'replace-q';
  replaceInput.placeholder = 'Replace with…';
  replaceInput.setAttribute('aria-label', 'Replacement text');

  const replaceButton = document.createElement('button');
  replaceButton.type = 'button';
  replaceButton.textContent = 'Replace all';
  replaceButton.disabled = true;

  replaceRow.append(replaceInput, replaceButton);

  const results = document.createElement('div');
  results.className = 'search-results';
  results.setAttribute('role', 'list');

  container.append(form, optsRow, replaceRow, results);

  const current: SearchOpts = { q: '', regex: false, icase: false, word: false, mask: '' };
  let lastResponse: SearchResponseT | null = null;

  function currentOpts(): SearchOpts {
    return {
      q: input.value.trim(),
      regex: regexInput.checked,
      icase: caseInput.checked,
      word: wordInput.checked,
      mask: maskInput.value.trim()
    };
  }

  function render(response: SearchResponseT): void {
    lastResponse = response;
    results.textContent = '';
    const summary = document.createElement('div');
    summary.className = 'search-summary';
    summary.textContent =
      response.total === 0
        ? `No matches for \u201c${response.query}\u201d`
        : `${response.total} match${response.total === 1 ? '' : 'es'} in ${response.results.length} file${response.results.length === 1 ? '' : 's'}`;
    results.appendChild(summary);
    replaceButton.disabled = response.total === 0;
    for (const file of response.results) {
      const fileHeader = document.createElement('div');
      fileHeader.className = 'search-file';
      fileHeader.textContent = file.path;
      results.appendChild(fileHeader);
      for (const hit of file.hits) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'search-hit';
        const number = document.createElement('span');
        number.className = 'search-line';
        number.textContent = `${hit.line}`;
        const text = document.createElement('span');
        text.className = 'search-text';
        text.textContent = hit.text;
        button.append(number, text);
        button.addEventListener('click', () => {
          const relPath = toRelPath(file.path);
          void deps.host.open(relPath, hit.line);
        });
        results.appendChild(button);
      }
    }
  }

  async function runSearch(): Promise<void> {
    const opts = currentOpts();
    if (opts.q === '') return;
    Object.assign(current, opts);
    try {
      const response = await api.search(opts.q, { regex: opts.regex, icase: opts.icase, word: opts.word, mask: opts.mask });
      render(response);
    } catch (error) {
      deps.onToast('BAD_REQUEST', error instanceof Error ? error.message : 'search failed');
    }
  }

  async function runReplace(): Promise<void> {
    if (current.q === '' || lastResponse === null) return;
    const total = lastResponse.total;
    const files = lastResponse.results.length;
    if (!window.confirm(`Replace ${total} occurrence${total === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}?\nThis cannot be undone.`)) return;
    const replacement = replaceInput.value;
    try {
      const result = await api.searchReplace({
        query: current.q,
        replacement,
        regex: current.regex,
        icase: current.icase,
        word: current.word,
        mask: current.mask
      });
      const affected = lastResponse.results.map(file => toRelPath(file.path));
      const skipped: string[] = [];
      for (const relPath of affected) {
        if (!openPaths().includes(relPath)) continue;
        if (isDirty(relPath)) {
          skipped.push(relPath);
          continue;
        }
        try {
          const file = await api.fileRead(relPath);
          if (file.too_large || file.content === null) continue;
          if (reloadClean(relPath, file.content)) revealLine(relPath, 1);
        } catch {
          skipped.push(relPath);
        }
      }
      deps.onToast('OK', `replaced ${result.occurrences} occurrence${result.occurrences === 1 ? '' : 's'} in ${result.files_changed} file${result.files_changed === 1 ? '' : 's'}`);
      if (skipped.length > 0) deps.onToast('CONFLICT', `skipped ${skipped.length} open file(s) with unsaved changes: ${skipped.join(', ')}`);
      await runSearch();
    } catch (error) {
      deps.onToast('COMMIT_FAILED', error instanceof Error ? error.message : 'replace failed');
    }
  }

  form.addEventListener('submit', (event: Event) => {
    event.preventDefault();
    void runSearch();
  });
  replaceButton.addEventListener('click', () => {
    void runReplace();
  });
}