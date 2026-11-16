// Personal interface preferences (Settings page). These are display choices only,
// not protected data, so they are kept in this browser's localStorage.
const KEY = 'nexora.prefs.v1';
const DEFAULTS = { reduceMotion: false, compactTables: false, startCollapsed: false, showBellCount: true };
const prefs = { ...DEFAULTS };

try {
  const saved = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}');
  for (const key of Object.keys(DEFAULTS)) if (typeof saved[key] === 'boolean') prefs[key] = saved[key];
} catch { /* unreadable or unavailable storage: use defaults */ }

export const getPrefs = () => ({ ...prefs });

export function applyPrefs() {
  const body = globalThis.document?.body;
  if (!body) return;
  body.classList.toggle('pref-reduce-motion', prefs.reduceMotion);
  body.classList.toggle('pref-compact', prefs.compactTables);
}

export function setPref(key, value) {
  if (!(key in DEFAULTS)) return;
  prefs[key] = Boolean(value);
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  applyPrefs();
}
