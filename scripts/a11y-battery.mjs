#!/usr/bin/env node
/**
 * Accessibility battery — verifies ARIA landmarks, dialog roles, aria-live,
 * aria-pressed, Escape handler, responsive breakpoints, and focus-visible.
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const total = 14;

function probe(name, fn) {
  const ok = fn();
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}`); }
}

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('styles.css', 'utf8');
const js = readFileSync('app.js', 'utf8');
const has = (src, pattern) => new RegExp(pattern).test(src);

// Landmark roles
probe('header-role-banner', () => has(html, 'role="banner"'));
probe('main-role-main', () => has(html, 'role="main"'));
probe('aside-role-complementary', () => has(html, 'role="complementary"'));
probe('footer-role-contentinfo', () => has(html, 'role="contentinfo"'));

// Dialog roles
probe('overlays-have-dialog-role', () => {
  const panels = ['help-panel','models-panel','command-palette','search-overlay','git-sheet','skills-panel','plugins-panel','telegram-panel','desktop-panel'];
  return panels.every(id => has(html, `id="${id}"[^>]*role="dialog"`));
});

// aria-live regions
probe('thread-aria-live', () => has(html, 'id="thread"[^>]*aria-live="polite"'));
probe('strip-aria-live', () => has(html, 'id="strip-text"[^>]*aria-live="polite"'));
probe('engine-chip-aria-live', () => has(html, 'id="engine-name"[^>]*aria-live="polite"'));

// aria-pressed toggles
probe('delegation-toggle-aria-pressed', () => has(html, 'id="delegation-toggle"[^>]*aria-pressed'));
probe('fos-toggle-aria-pressed', () => has(html, 'id="fos-toggle"[^>]*aria-pressed'));

// Escape handler
probe('escape-closes-overlays', () => has(js, "e\\.key === 'Escape'"));

// Keyboard toggle support
probe('toggle-keyboard-support', () => has(js, 'delegation-toggle.*keydown|fos-toggle.*keydown'));

// Responsive breakpoints
probe('responsive-breakpoints', () => has(css, '@media.*max-width.*820px') && has(css, '@media.*max-width.*640px'));

// Focus-visible
probe('focus-visible-styles', () => has(css, ':focus-visible'));

console.log(`\nBATTERY: ${pass}/${total} passed`);
process.exit(fail > 0 ? 1 : 0);
