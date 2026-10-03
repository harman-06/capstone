// STEP 5: placeholder pages with the deep links already wired (?patient=, ?unit=, ?tab=&item=).
import { ROLES, session } from '../roles.js';
import { getPatients, getPatient, getAppointments, getInventory } from '../data.js';
const page = (title, body) => `<h1>${title}</h1>${body}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  const rows = getInventory().filter(i => i.type === tab).map(i => `<tr data-inventory-row data-name="${escapeHtml(i.name.toLowerCase())}" data-unit="${escapeHtml(i.unit)}" class="${i.id === query.item ? 'hl' : ''}">
    <td>${i.name}</td><td>${i.unit}${i.unitNo ? ` <span class="muted">(${i.unitNo})</span>` : ''}</td><td>${i.qty}</td><td><span class="badge ${i.status}">${i.status}</span></td>
    <td>${i.unit !== session.unit ? `<button data-cap="transfers.request" data-request-item="${escapeHtml(i.id)}">Request</button>` : ''}</td></tr>`).join('');
  const units = [...new Set(getInventory().filter(i => i.type === tab).map(i => i.unit))].sort();
  el.innerHTML = page('Inventory', `<div class="tabs"><a class="${tab === 'equipment' ? 'on' : ''}" href="#/inventory?tab=equipment">Equipment</a><a class="${tab === 'medicine' ? 'on' : ''}" href="#/inventory?tab=medicine">Medicine</a></div>
    <p class="muted">Find items and check stock across units. Medicine is sample data.</p>
    <div class="inventory-tools"><label>Search items<input id="inventory-search" type="search" placeholder="Search by item name"></label><label>Unit<select id="inventory-unit"><option value="">All units</option>${units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('')}</select></label><span id="inventory-count" class="muted" role="status"></span></div>
    <div class="card"><table><thead><tr><th scope="col">Item</th><th scope="col">Unit</th><th scope="col">Quantity</th><th scope="col">Availability</th><th scope="col">Action</th></tr></thead><tbody>${rows}</tbody></table><p id="inventory-empty" class="empty-state" hidden>No items match your filters.</p></div>`);
  const search = el.querySelector('#inventory-search');
  const unit = el.querySelector('#inventory-unit');
  const filter = () => {
    let visible = 0;
    el.querySelectorAll('[data-inventory-row]').forEach(row => {
      row.hidden = !row.dataset.name.includes(search.value.trim().toLowerCase()) || Boolean(unit.value && row.dataset.unit !== unit.value);
      if (!row.hidden) visible++;
    });
    el.querySelector('#inventory-count').textContent = `${visible} item${visible === 1 ? '' : 's'}`;
    el.querySelector('#inventory-empty').hidden = visible !== 0;
  };
  search.addEventListener('input', filter);
  unit.addEventListener('change', filter);
  filter();
  el.querySelector('.hl')?.scrollIntoView({ block: 'center' });
  el.querySelectorAll('[data-request-item]').forEach(button => {
    button.addEventListener('click', () => {
      location.hash = '#/requests?item=' + encodeURIComponent(button.dataset.requestItem);
    });
  });
}

export function requests(el, { query }) {
  const item = getInventory().find(i => i.id === query.item);
  let body = '<p>Select an item in Inventory to view its request details.</p>';
  if (query.item && !item) body = '<p>This item is not currently loaded. Sign in and refresh Inventory, then select the item again.</p>';
  if (item) body = `<h2>${escapeHtml(item.name)}</h2>
    <p>Source unit: ${escapeHtml(item.unit)}</p>
    <p>Recorded quantity: ${escapeHtml(item.qty)} · Status: ${escapeHtml(item.status)}</p>
    ${Number(item.qty) <= 0 ? '<p>This unit has no recorded stock for this item. Check Inventory for stock in another unit.</p>' : ''}
    ${item.type === 'medicine' ? '<p>Medicine quantities are sample data. Medication requests are not supported.</p>' : ''}`;
  el.innerHTML = page('Requests and approvals', `<div class="card">${body}
    <p role="status">Online transfer requests are not available yet. No request has been submitted.</p>
    <a href="#/inventory">Back to Inventory</a></div>`);
}
export const users = soon('Users');
export const notFound = soon('Page not found');
export const help = el => { el.innerHTML = page('Help', `<div class="card"><ol>
  <li>Use the sidebar to move between sections. You only see what your role can use.</li>
  <li>The dashboard is your home page. Select any card to open the full page.</li>
  <li>Search Inventory for equipment or medicine. Select Request to view the item's stock details. Online requests are not available yet.</li>
  <li>A lock icon means the action needs approval from a doctor.</li></ol></div>`); };
