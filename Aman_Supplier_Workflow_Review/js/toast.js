// Small confirmation / error message at the bottom of the screen.
let timer;
export function toast(message, { error = false } = {}) {
  const el = globalThis.document?.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), error ? 6000 : 3200);
}
