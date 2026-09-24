// STEP 5: placeholder pages with the deep links already wired (?patient=, ?unit=, ?tab=&item=).
import { ROLES, session } from '../roles.js';
import { getPatients, getPatient, getAppointments, getInventory } from '../data.js';
const page = (title, body) => `<h1>${title}</h1>${body}`;
const soon = title => el => { el.innerHTML = page(title, '<p class="muted">Coming in a later sprint.</p>'); };

export function appointments(el, { query }) {
  const rows = getAppointments(query.patient).map(a => `<div class="row"><b>${a.when}</b><span>${a.patientName} · ${a.type}</span></div>`).join('');
  el.innerHTML = page('Appointments', `${query.patient ? '<p class="muted">Filtered by patient. <a href="#/appointments">Clear filter</a></p>' : ''}<div class="card">${rows || '<p class="muted">No appointments.</p>'}</div>`);
}

export function patients(el, { query }) {
  const all = getPatients(), unit = query.unit || '';
  const units = [...new Set(all.map(p => p.unit))];
  const locked = ROLES[session.role].scope !== 'all' ? 'disabled' : '';
  const rows = all.filter(p => !unit || p.unit === unit).map(p => `<a class="row" href="#/patients/${p.id}">${p.name}<span class="muted">${p.unit}</span></a>`).join('');
  el.innerHTML = page('Patients', `<p><label>Department <select id="unit-filter" ${locked}><option value="">All</option>${units.map(u => `<option ${u === unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label></p><div class="card">${rows}</div>`);
  el.querySelector('#unit-filter').onchange = e => { location.hash = '#/patients' + (e.target.value ? '?unit=' + e.target.value : ''); };
}

export function patientProfile(el, { params }) {
  const p = getPatient(params[0]);
  if (!p) return void (el.innerHTML = page('Patient not found', '<p class="muted">This patient doesn\'t exist or you don\'t have access.</p>'));
  el.innerHTML = page(p.name, `
    <div class="banner">Allergies: ${p.allergies.join(', ') || 'None recorded'}</div>
    <div class="card"><h3>Diagnoses</h3><p data-cap="patients.viewSensitive">${p.diagnoses.join(', ')}</p></div>
    <div class="card"><h3>Medications</h3>${p.meds.map(m => `<a class="row" data-cap="inventory.view" data-fallback="text" href="#/inventory?tab=medicine&item=${m.itemId}">${m.name}</a>`).join('') || '<p class="muted">None.</p>'}</div>
    <div class="card"><h3>Upcoming appointments</h3><a href="#/appointments?patient=${p.id}">Expand</a></div>`);
}
export const myHealth = el => patientProfile(el, { params: [getPatients()[0]?.id] });

export function inventory(el, { query }) {
  const tab = query.tab || 'equipment';
  const rows = getInventory().filter(i => i.type === tab).map(i => `<tr class="${i.id === query.item ? 'hl' : ''}">
    <td>${i.name}</td><td>${i.unit}</td><td>${i.qty}</td><td><span class="badge ${i.status}">${i.status}</span></td>
    <td>${i.unit !== session.unit ? '<button data-cap="transfers.request">Request</button>' : ''}</td></tr>`).join('');
  el.innerHTML = page('Inventory', `<div class="tabs"><a class="${tab === 'equipment' ? 'on' : ''}" href="#/inventory?tab=equipment">Equipment</a><a class="${tab === 'medicine' ? 'on' : ''}" href="#/inventory?tab=medicine">Medicine</a></div>
    <div class="card"><table><tr><th>Item</th><th>Unit</th><th>Qty</th><th>Status</th><th></th></tr>${rows}</table></div>`);
  el.querySelector('.hl')?.scrollIntoView({ block: 'center' });
}

export const requests = soon('Requests and approvals');
export const users = soon('Users');
export const notFound = soon('Page not found');
export const help = el => { el.innerHTML = page('Help', `<div class="card"><ol>
  <li>Use the sidebar to move between sections. You only see what your role can use.</li>
  <li>The dashboard is your home page. Select any card to open the full page.</li>
  <li>Search Inventory for equipment or medicine. If it's in another unit, select Request.</li>
  <li>A lock icon means the action needs approval from a doctor.</li></ol></div>`); };
