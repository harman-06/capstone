// STEP 1: boot file. Wires router, nav, role switcher.
import { ROLES, session, applyPermissions } from './roles.js';
import { loadData } from './data.js';
import { startRouter } from './router.js';
import { renderNav } from './nav.js';
import { dashboard } from './pages/dashboard.js';
import * as pg from './pages/other.js';

const routes = [
  [/^\/dashboard$/, dashboard],
  [/^\/appointments$/, pg.appointments],
  [/^\/patients$/, pg.patients],
  [/^\/patients\/(\w+)$/, pg.patientProfile],
  [/^\/my-health$/, pg.myHealth],
  [/^\/inventory$/, pg.inventory],
  [/^\/requests$/, pg.requests],
  [/^\/users$/, pg.users],
  [/^\/help$/, pg.help],
  [/.*/, pg.notFound],
];

const app = document.getElementById('app');
const sw = document.getElementById('role-switcher');
const who = document.getElementById('user-name');

function onRoute(handler, ctx) {
  app.classList.remove('page-enter'); void app.offsetWidth; app.classList.add('page-enter');
  handler(app, ctx);
  applyPermissions(app);
  renderNav(ctx.path);
  who.textContent = ROLES[session.role].user;
}

await loadData();
const refresh = startRouter(routes, onRoute);

sw.innerHTML = Object.entries(ROLES).map(([k, r]) => `<option value="${k}">${r.label}</option>`).join('');
sw.onchange = () => {
  session.role = sw.value;
  if (location.hash === '#/dashboard' || !location.hash) refresh(); else location.hash = '#/dashboard';
};
document.getElementById('menu-btn').onclick = () => document.body.classList.toggle('nav-closed');
if (innerWidth < 760) document.body.classList.add('nav-closed');
