// Builds the sidebar from a single list of entries, filtering out any item the current role can't access.
// Built from one config array below - add nav items here, not in HTML. 
// This helps make scalability very easy, because as we expand the project more and more, adding a new nav item is as simple as one line. 
// Items whose cap the current role can't use (can() returns 'deny') are filtered out, 
// so the sidebar shrinks per role automatically.
import { can } from './roles.js';
const NAV = [
  { label:'Dashboard',    route:'/dashboard' },
  { label:'Appointments', route:'/appointments', cap:'appointments.view' },
  { label:'Patients',     route:'/patients',     cap:'patients.view' },
  { label:'My Health',    route:'/my-health',    cap:'profile.own' },
  { label:'Inventory',    route:'/inventory',    cap:'inventory.view' },
  { label:'Units',        route:'/units',        cap:'inventory.view' },
  { label:'Requests',     route:'/requests',     cap:'requests.view' },
  { label:'Users',        route:'/users',        cap:'users.manage' },
  { label:'Help',         route:'/help' },
];
// One SVG path per NAV item above, same order, so icons[i] matches NAV[i].
const icons = [
  'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  'M4 5h16v16H4z M8 2v6 M16 2v6 M4 11h16',
  'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8a4 4 0 0 0 0-8 M17 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-4',
  'M3 12h4l3-8 4 16 3-8h4',
  'M3 7l9-4 9 4v13H3z M3 7l9 4 9-4 M12 11v9',
  'M4 21V3h16v18 M8 7h2 M14 7h2 M8 11h2 M14 11h2 M10 21v-6h4v6',
  'M4 7h16 M16 3l4 4-4 4 M20 17H4 M8 13l-4 4 4 4',
  'M12 3a4 4 0 1 0 0 8a4 4 0 0 0 0-8 M4 21v-2a8 8 0 0 1 16 0v2',
  'M12 22a10 10 0 1 0 0-20a10 10 0 0 0 0 20 M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01'
];
NAV.forEach((item,i) => item.icon = icons[i]);

// Shared SVG wrapper so the sidebar and the tab bar draw icons identically.
const svg = path => `<svg class="nav-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;

// ADDED (Harman): mobile bottom tab bar.
// TAB_PRIORITY is the order we prefer for the quick-access tabs. The bar takes
// the first 4 entries the current role is actually allowed to see, so a nurse
// gets Dashboard / Patients / Appointments / Inventory, while a patient gets
// Dashboard / My Health / Appointments. Everything else stays in the drawer,
// reachable through the "More" tab. CSS only shows the bar on narrow screens.
const TAB_PRIORITY = ['/dashboard', '/patients', '/my-health', '/appointments', '/inventory', '/requests', '/users'];
const MORE_ICON = 'M4 6h16 M4 12h16 M4 18h16';
let tabbar;   // created once on first render, then reused

function renderTabBar(current, allowed) {
  if (!tabbar) {
    tabbar = document.createElement('nav');
    tabbar.id = 'tabbar';
    tabbar.className = 'tabbar';
    tabbar.setAttribute('aria-label', 'Quick navigation');
    document.body.appendChild(tabbar);
    // "More" opens the same drawer as the hamburger button by clicking it.
    // stopPropagation keeps main.js's "click outside closes the sidebar"
    // listener from seeing this click and closing the drawer it just opened.
    tabbar.addEventListener('click', e => {
      if (!e.target.closest('[data-tab-more]')) return;
      e.stopPropagation();
      document.getElementById('menu-btn').click();
    });
  }
  const tabs = TAB_PRIORITY
    .map(route => allowed.find(n => n.route === route))
    .filter(Boolean)
    .slice(0, 4);
  tabbar.innerHTML = tabs.map(n => {
    const active = current.startsWith(n.route);
    return `<a href="#${n.route}" class="${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${svg(n.icon)}<span>${n.label}</span></a>`;
  }).join('') + `<button type="button" data-tab-more aria-label="More navigation">${svg(MORE_ICON)}<span>More</span></button>`;
}

// Rebuilds #sidebar for the current route and role. Called from main.js after every navigation. 
// `current` is the active path, used to mark the matching link as .active / aria-current.
export function renderNav(current) {
  const allowed = NAV.filter(n => !n.cap || can(n.cap) !== 'deny');
  document.getElementById('sidebar').innerHTML = '<span class="nav-caption">WORKSPACE</span>' + allowed
    .map(n => `<a href="#${n.route}" class="${current.startsWith(n.route) ? 'active' : ''}" ${current.startsWith(n.route) ? 'aria-current="page"' : ''}>${svg(n.icon)}${n.label}</a>`)
    .join('') + '<span class="nav-footer">Nexora Health<br>Capstone demonstration</span>';
  renderTabBar(current, allowed);   // ADDED (Harman): keep the mobile tab bar in sync with the sidebar
}
