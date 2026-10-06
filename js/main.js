// Boot file.
// Constructs the  site by importing everything from the other files.
import { ROLES, session, applyPermissions } from './roles.js';
import { loadData } from './data.js';
import { isSignedIn } from './api.js';
import { mountDatabaseControls } from './auth-ui.js';
import { startRouter } from './router.js';
import { renderNav } from './nav.js';
import { dashboard } from './pages/dashboard.js';
import { units } from './pages/units.js';
import * as pg from './pages/other.js';

// These are all the routes. 
// Path URL -> page function.
// The last entry (.*) is the 404 fallback. Add a page here once it exists.
const routes = [
  [/^\/dashboard$/, dashboard],
  [/^\/appointments$/, pg.appointments],
  [/^\/patients$/, pg.patients],
  [/^\/patients\/(\w+)$/, pg.patientProfile],
  [/^\/my-health$/, pg.myHealth],
  [/^\/inventory$/, pg.inventory],
  [/^\/units$/, units],
  [/^\/requests$/, pg.requests],
  [/^\/users$/, pg.users],
  [/^\/help$/, pg.help],
  [/.*/, pg.notFound],
];

const app = document.getElementById('app');
const sw = document.getElementById('role-switcher');
const who = document.getElementById('user-name');

// Top-bar clock (ticks every 30 sec)
// Shown once the dashboard's own large greeting has scrolled away, or always on other pages.
const clock = document.getElementById('clock');
const tick = () => clock.textContent = new Date().toLocaleString('en-CA',
  { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
tick(); setInterval(tick, 30000);

// page handler function
// checks status / context, loads page.
function onRoute(handler, ctx) {
  if (!isSignedIn()) { app.replaceChildren(); return; }
  app.classList.remove('page-enter'); void app.offsetWidth; app.classList.add('page-enter');
  document.body.classList.add('clock-visible');   // other pages: clock always shown
  scrollTo(0, 0);
  handler(app, ctx);    // render the page into #app
  applyPermissions(app);    // roles.js: hide/lock/mask anything with [data-cap] for this role.
  renderNav(ctx.path);   // rebuild the sidebar, highlighting the active route.
  who.textContent = ROLES[session.role].user;
}

// app started -> Loads data, starts router.
await loadData();    // data.js: load demo JSON, then try live Supabase equipment
const refresh = startRouter(routes, onRoute);
mountDatabaseControls(refresh);    // teammate: wires the sign-in form to the auth state

// Demo role switcher: lets anyone signed in preview how the UI looks per
// role. Does NOT change real database permissions — those come from Supabase Auth/RLS, independent of this dropdown.
// this is just for display/preview purposes while we're testing the site
sw.innerHTML = Object.entries(ROLES).map(([k, r]) => `<option value="${k}">${r.label}</option>`).join('');
sw.onchange = () => {
  session.role = sw.value;
  if (location.hash === '#/dashboard' || !location.hash) refresh(); else location.hash = '#/dashboard';
};
document.getElementById('menu-btn').onclick = () => document.body.classList.toggle('nav-closed');
if (innerWidth < 760) document.body.classList.add('nav-closed'); // collapse sidebar on small screens by default
