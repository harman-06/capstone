// STEP 4: dashboard page. The role decides which widgets appear.
import { ROLES, session } from '../roles.js';
import { widgets } from '../widgets.js';

const HOVER_EXPAND = false;   // final version: true (expands the Patients / My Health panel on hover)

export function dashboard(el) {
  const list = ROLES[session.role].dashboard;
  el.innerHTML = `<div class="dash">${list.map(w => `<div class="w-${w}">${widgets[w]()}</div>`).join('')}</div>`;
  el.querySelectorAll('.expandable').forEach(c => {
    const btn = c.querySelector('.expand-toggle');
    btn.onclick = () => btn.setAttribute('aria-expanded', c.classList.toggle('open'));
    if (HOVER_EXPAND) { c.onmouseenter = () => c.classList.add('open'); c.onmouseleave = () => c.classList.remove('open'); }
  });
}
