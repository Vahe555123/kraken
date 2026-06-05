// Substitutes {{name}}, {{bank}} (and any provided var) in the system prompt.
// Supports optional spaces: {{name}}, {{ name }}.
export function buildSystemPrompt(raw, vars = {}) {
  const map = {
    name: (vars.name || '').trim() || 'cliente',
    bank: (vars.bank || '').trim() || 'su banco',
  };
  // allow callers to add extra vars
  for (const [k, v] of Object.entries(vars)) {
    if (k !== 'name' && k !== 'bank') map[k.toLowerCase()] = String(v ?? '');
  }
  return String(raw || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (full, key) => {
    const k = String(key).toLowerCase();
    return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : full;
  });
}
