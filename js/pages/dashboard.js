import { ROLES, session } from '../roles.js';
import { widgets } from '../widgets.js';

const HOVER_EXPAND = false;   // in the final version: true
let onScroll;

export function dashboard(el) {
  const list = ROLES[session.role].dashboard.filter(w => w !== 'greeting');
  el.innerHTML = `<div class="greeting-bar">${widgets.greeting()}</div>
    <div class="dash">${list.map(w => `<div class="w-${w}">${widgets[w]()}</div>`).join('')}</div>`;

  el.querySelectorAll('.expandable').forEach(c => {
    const btn = c.querySelector('.expand-toggle');
    btn.onclick = () => btn.setAttribute('aria-expanded', c.classList.toggle('open'));
    if (HOVER_EXPAND) { c.onmouseenter = () => c.classList.add('open'); c.onmouseleave = () => c.classList.remove('open'); }
  });
  el.querySelectorAll('.notif-group').forEach(g => {
    const btn = g.querySelector('.notif-toggle');
    btn.onclick = () => btn.setAttribute('aria-expanded', g.classList.toggle('open'));
  });

  // large greeting shrinks as you scroll; clock appears in the top bar once the date line is gone
  const bar = el.querySelector('.greeting-bar');
  removeEventListener('scroll', onScroll);
  onScroll = () => {
    if (!bar.isConnected) return;                 // ignore scrolling on other pages
    const p = Math.min(scrollY / 90, 1);          // 0 = top, 1 = fully shrunk
    bar.style.setProperty('--p', p);
    document.body.classList.toggle('clock-visible', p >= 1);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
