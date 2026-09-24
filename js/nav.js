// STEP 1: sidebar built from a config. Items the role can't use disappear.
import { can } from './roles.js';
const NAV = [
  { label:'Dashboard',    route:'/dashboard' },
  { label:'Appointments', route:'/appointments', cap:'appointments.view' },
  { label:'Patients',     route:'/patients',     cap:'patients.view' },
  { label:'My Health',    route:'/my-health',    cap:'profile.own' },
  { label:'Inventory',    route:'/inventory',    cap:'inventory.view' },
  { label:'Requests',     route:'/requests',     cap:'requests.view' },
  { label:'Users',        route:'/users',        cap:'users.manage' },
  { label:'Help',         route:'/help' },
];
export function renderNav(current) {
  document.getElementById('sidebar').innerHTML = NAV
    .filter(n => !n.cap || can(n.cap) !== 'deny')
    .map(n => `<a href="#${n.route}" class="${current.startsWith(n.route) ? 'active' : ''}">${n.label}</a>`)
    .join('');
}
