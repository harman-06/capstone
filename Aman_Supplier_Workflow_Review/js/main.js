// Boot file.
// Builds the site by importing everything from the other files.
import { accounts } from './pages/accounts.js';
import { workspace } from './workspace.js';
import { supplies } from './pages/operations.js';
import { home } from './pages/home.js';
import { account, settings } from './pages/account.js';
import { applyPermissions, can } from './roles.js';
import { loadData } from './data.js';
import { isSignedIn } from './api.js';
import { mountDatabaseControls } from './auth-ui.js';
import { mountStatusBarTooltip } from './status-bar.js';
import { mountTopbar, refreshTopbar } from './topbar.js';
import { applyPrefs, getPrefs } from './prefs.js';
import { startRouter } from './router.js';
import { renderNav } from './nav.js';
import { units } from './pages/units.js';
import { inventoryItem } from './pages/inventory-item.js';
import * as pg from './pages/other.js';

// These are all the routes.
// Path URL -> page function.
// The last entry (.*) is the 404 fallback. Add a page here once it exists.
const routes = [
  [/^\/accounts$/, accounts],
  [/^\/supplies$/, supplies],
  [/^\/dashboard$/, home],
  [/^\/account$/, account],
  [/^\/settings$/, settings],
  [/^\/appointments$/, pg.appointments],
  [/^\/patients$/, pg.patients],
  [/^\/patients\/(\w+)$/, pg.patientProfile],
  [/^\/my-health$/, pg.myHealth],
  [/^\/inventory$/, pg.inventory],
  [/^\/inventory\/([\w-]+)$/, inventoryItem],
  [/^\/units$/, units],
  [/^\/requests$/, pg.requests],
  [/.*/, pg.notFound],
];

// Which pages each kind of account may open. Anything else goes back to the dashboard.
const STAFF_PATHS = ['/dashboard', '/appointments', '/patients', '/inventory', '/units', '/requests', '/supplies', '/account', '/settings'];
const PATIENT_PATHS = ['/dashboard', '/appointments', '/my-health', '/account', '/settings'];
const SUPPLIER_PATHS = ['/dashboard', '/supplies', '/account', '/settings'];
// A page also needs its capability from roles.js (can() returns 'deny' hides it).
const ROUTE_CAPS = { '/appointments': 'appointments.view', '/patients': 'patients.view', '/my-health': 'profile.own', '/inventory': 'inventory.view', '/units': 'inventory.view', '/requests': 'requests.view' };
const SUBROUTES = ['/inventory', '/patients'];   // pages that have /<page>/<id> children

function allowed(path) {
  const base = '/' + path.split('/')[1];
  const paths = workspace.kind === 'patient' ? PATIENT_PATHS : workspace.kind === 'supplier' ? SUPPLIER_PATHS : STAFF_PATHS;
  if (!paths.includes(base)) return false;
  if (path !== base && !SUBROUTES.includes(base)) return false;
  const cap = ROUTE_CAPS[base];
  return !cap || can(cap) !== 'deny';
}

const app = document.getElementById('app');

// Top-bar clock (ticks every 30 sec)
const clock = document.getElementById('clock');
const tick = () => clock.textContent = new Date().toLocaleString('en-CA',
  { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
tick(); setInterval(tick, 30000);

// Runs on every navigation: checks sign-in and access, renders the page, then
// applies permissions, navigation and the top bar.
function onRoute(handler, ctx) {
  if (!isSignedIn() || !workspace) { app.replaceChildren(); return; }
  app.classList.remove('page-enter'); void app.offsetWidth; app.classList.add('page-enter');
  document.body.classList.add('clock-visible');
  scrollTo(0, 0);
  if (workspace.roles.includes('admin')) {
    // Administrators only see account monitoring plus their own account and settings.
    if (['/account', '/settings'].includes(ctx.path)) { handler(app, ctx); renderNav(ctx.path); refreshTopbar(); return; }
    accounts(app); renderNav('/accounts'); refreshTopbar(); return;
  }
  if (ctx.path === '/accounts') { location.hash = '#/dashboard'; return; }
  if (!allowed(ctx.path)) { location.hash = workspace.kind === 'supplier' ? '#/supplies' : '#/dashboard'; return; }
  handler(app, ctx);        // render the page into #app
  applyPermissions(app);    // roles.js: hide/lock/mask anything with [data-cap] for this role
  renderNav(ctx.path);      // rebuild the sidebar, highlighting the active route
  refreshTopbar();          // name, role, notification bell
}

// App start
applyPrefs();
mountTopbar();
await loadData();    // data.js: load demo JSON, then try live Supabase equipment
const refresh = startRouter(routes, onRoute);
mountDatabaseControls(refresh);    // wires the sign-in form to the auth state
mountStatusBarTooltip();

// Sidebar. Open = full width. Collapsed = icons only on desktop, hidden on phones
// (the bottom tab bar and the drawer take over there).
// setNavOpen() is the one place that opens or closes it.
const menuBtn = document.getElementById('menu-btn');
const isMobile = () => innerWidth <= 760;
function setNavOpen(open) {
  document.body.classList.toggle('nav-closed', !open);
  document.body.style.overflow = (open && isMobile()) ? 'hidden' : '';   // lock page scroll behind the mobile drawer
  menuBtn.setAttribute('aria-expanded', String(open));
}
menuBtn.onclick = () => setNavOpen(document.body.classList.contains('nav-closed'));
setNavOpen(!isMobile() && !getPrefs().startCollapsed);

// Clicking or tapping anywhere outside the sidebar collapses it, on desktop and phones alike.
document.addEventListener('click', e => {
  if (document.body.classList.contains('nav-closed')) return;
  if (e.target.closest('#sidebar, #menu-btn, #tabbar')) return;
  setNavOpen(false);
});
// On phones, choosing a page also closes the drawer.
addEventListener('hashchange', () => { if (isMobile()) setNavOpen(false); });
// Release the scroll lock if the window grows past the phone breakpoint.
addEventListener('resize', () => { if (!isMobile()) document.body.style.overflow = ''; });
