// NEW FILE (Harman): the Supabase status bar (#database-status,
// #database-auth-message) is now a single truncated line (see css/style.css)
// so it takes up far less space. This keeps the FULL text available on
// hover/focus via the native title attribute, without changing anything in
// auth-ui.js — it only watches the two elements auth-ui.js already writes to.
export function mountStatusBarTooltip() {
  const targets = ['database-status', 'database-auth-message']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  const sync = el => { el.title = el.textContent.trim(); };
  targets.forEach(el => {
    sync(el);
    new MutationObserver(() => sync(el)).observe(el, { childList: true, characterData: true, subtree: true });
  });
} 
