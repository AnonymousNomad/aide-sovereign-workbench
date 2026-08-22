
function asBoolean(value) {
  if (value === true || value === 'true' || value === 1) return true;
  return false;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function editorOptionsFromSettings(settings) {
  const values = settings.merged();
  const modifier = values['aide.editor.multiCursorModifier'];
  return {
    fontSize: clampInt(values['aide.editor.fontSize'], 8, 48, 14),
    tabSize: clampInt(values['aide.editor.tabSize'], 1, 8, 2),
    wordWrap: asBoolean(values['aide.editor.wordWrap']),
    minimap_enabled: asBoolean(values['aide.editor.minimap']),
    stickyScroll_enabled: asBoolean(values['aide.editor.stickyScroll']),
    folding_enabled: asBoolean(values['aide.editor.folding']),
    bracketPairColorization_enabled: asBoolean(values['aide.editor.bracketColorization']),
    multiCursorModifier: ['ctrlKey', 'altKey', 'metaKey'].includes(String(modifier)) ? String(modifier) : 'ctrlKey'
  };
}

