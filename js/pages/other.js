// STEP 5: placeholder pages with the deep links already wired (?patient=, ?unit=, ?tab=&item=).
import { ROLES, session } from '../roles.js';
import { getPatients, getPatient, getAppointments, getInventory, addPatientNote, addAppointment, addRequestLogEntry, getRequestLog } from '../data.js';
import { openModal } from '../modal.js';
const page = (title, body) => `<h1>${title}</h1>${body}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const soon = title => el => { el.innerHTML = page(title, '<p class="muted">Coming in a later sprint.</p>'); };

// Shared "Book a new appointment" modal — used from both the Patient
// Profile page and the Appointments page. If patientId is given, the
// patient field is preset and hidden; otherwise staff pick from the list.
function openBookAppointmentModal(onBooked, patientId) {
  const patients = getPatients();
  const preset = patientId ? patients.find(p => p.id === patientId) : null;
  openModal({
    title: 'Book a new appointment',
    submitLabel: 'Book appointment',
    bodyHtml: `
      ${preset ? `<p>Patient: <b>${escapeHtml(preset.name)}</b></p>`
        : `<label>Patient <select name="patient">${patients.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select></label>`}
      <label>Type <input name="type" placeholder="e.g. Follow-up, Consult" required></label>
      <label>Date and time <input name="when" type="datetime-local" required></label>`,
    onSubmit(form) {
      const patient = preset ?? patients.find(p => p.id === form.patient.value);
      const when = new Date(form.when.value);
      if (!patient || Number.isNaN(when.getTime())) { alert('Enter a valid date and time.'); return false; }
      addAppointment({
        patientId: patient.id, patientName: patient.name, unit: patient.unit,
        type: form.type.value.trim() || 'Appointment',
        when: when.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
      });
      onBooked?.();
    },
  });
}

export function appointments(el, { query }) {
  const rows = getAppointments(query.patient).map(a => `<div class="row"><b>${a.when}</b><span>${a.patientName} · ${a.type}</span></div>`).join('');
  // ADDED (Harman): "Book a new appointment" button, same modal used on the Patient Profile page.
  el.innerHTML = page('Appointments', `
    ${query.patient ? '<p class="muted">Filtered by patient. <a href="#/appointments">Clear filter</a></p>' : ''}
    <p><button id="book-appt-btn" type="button" data-cap="appointments.view">Book a new appointment</button></p>
    <div class="card">${rows || '<p class="muted">No appointments.</p>'}</div>`);
  el.querySelector('#book-appt-btn').addEventListener('click', () => openBookAppointmentModal(() => appointments(el, { query })));
}

export function patients(el, { query }) {
  const all = getPatients(), unit = query.unit || '';
  const units = [...new Set(all.map(p => p.unit))];
  const locked = ROLES[session.role].scope !== 'all' ? 'disabled' : '';
  const rows = all.filter(p => !unit || p.unit === unit).map(p => `<a class="row" href="#/patients/${p.id}">${p.name}<span class="muted">${p.unit}</span></a>`).join('');
  el.innerHTML = page('Patients', `<p><label>Department <select id="unit-filter" ${locked}><option value="">All</option>${units.map(u => `<option ${u === unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label></p><div class="card">${rows}</div>`);
  el.querySelector('#unit-filter').onchange = e => { location.hash = '#/patients' + (e.target.value ? '?unit=' + e.target.value : ''); };
}

// Formats a yyyy-mm-dd dob into "54 yrs (Mar 14, 1972)"; falls back to the
// patient's stored `age` if dob is missing (keeps old demo records working).
function ageLine(p) {
  if (!p.dob) return p.age != null ? `${p.age} yrs` : '—';
  const dob = new Date(p.dob);
  const years = Math.floor((Date.now() - dob.getTime()) / 31557600000);
  return `${years} yrs (${dob.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })})`;
}

export function patientProfile(el, { params }) {
  const p = getPatient(params[0]);
  if (!p) return void (el.innerHTML = page('Patient not found', '<p class="muted">This patient doesn\'t exist or you don\'t have access.</p>'));

  // ADDED (Harman): contact/ID/vitals quick-facts, notes (multi-author, can
  // add a new one), medication schedule, documents/requisitions, providers,
  // and a "Book a new appointment" button. Diagnoses/medications/allergy
  // banner/appointments link are the original sections, kept as-is.
  el.innerHTML = page(p.name, `

    <div class="banner">Diagnoses: <data-cap="patients.viewSensitive">${p.diagnoses.join(', ') || 'None recorded'}</div>

    <div class="banner">Medications: ${p.meds.map(m => `<data-cap="inventory.view" data-fallback="text" href="#/inventory?tab=medicine&item=${m.itemId}">${m.name}</a>`).join('') || '<p class="muted">None.</p>'}
    </div>

    <div class="banner">Allergies: ${p.allergies.join(', ') || 'None recorded'}</div>

    <div class="card" data-cap="patients.viewSensitive">
      <h3>Patient details</h3>
      <dl class="item-facts">
        <div><dt>Medical ID</dt><dd>${escapeHtml(p.medicalId) || '—'}</dd></div>
        <div><dt>Date of birth / age</dt><dd>${ageLine(p)}</dd></div>
        <div><dt>Height</dt><dd>${p.heightCm ? p.heightCm + ' cm' : '—'}</dd></div>
        <div><dt>Weight</dt><dd>${p.weightKg ? p.weightKg + ' kg' : '—'}</dd></div>
        <div><dt>Phone</dt><dd>${escapeHtml(p.contact?.phone) || '—'}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(p.contact?.email) || '—'}</dd></div>
        <div><dt>Address</dt><dd>${escapeHtml(p.contact?.address) || '—'}</dd></div>
      </dl>
    </div>

    <div class="card" data-cap="patients.viewSensitive">
      <h3>Medication schedule</h3>
      ${(p.medicationSchedule ?? []).map(s => `<div class="row"><b>${escapeHtml(s.time)}</b><span>${escapeHtml(s.med)} — ${escapeHtml(s.route)}</span></div>`).join('') || '<p class="muted">Nothing scheduled.</p>'}
    </div>

    <div class="card" data-cap="patients.viewSensitive">
      <h3>Primary providers</h3>
      ${(p.providers ?? []).map(pr => `<div class="row"><b>${escapeHtml(pr.name)}</b><span>${escapeHtml(pr.role)} · ${escapeHtml(pr.org)}</span></div>`).join('') || '<p class="muted">None recorded.</p>'}
    </div>

    <div class="card" data-cap="patients.viewSensitive">
      <h3>Documents &amp; requisitions</h3>
      ${(p.documents ?? []).map(d => `<div class="row"><span>${escapeHtml(d.name)}</span><span class="muted">${escapeHtml(d.date)}</span></div>`).join('')}
      ${(p.requisitions ?? []).map(r => `<div class="row"><span>${escapeHtml(r.name)}</span><span class="muted">${escapeHtml(r.status)} · ${escapeHtml(r.date)}</span></div>`).join('')}
      ${!(p.documents?.length || p.requisitions?.length) ? '<p class="muted">Nothing on file.</p>' : ''}
    </div>

    <div class="card" data-cap="patients.viewSensitive">
      <h3>Notes</h3>
      <div id="patient-notes">${renderNotes(p)}</div>
      <form id="add-note-form">
        <label>Add a note <textarea name="text" rows="2" required placeholder="Visible to all staff who can view this patient"></textarea></label>
        <button type="submit">Add note</button>
      </form>
    </div>

    <div class="card">
      <h3>Upcoming appointments</h3>
      <a href="#/appointments?patient=${p.id}">Expand</a>
      <p><button id="book-appt-btn" type="button" data-cap="appointments.view">Book a new appointment</button></p>
    </div>`);

  el.querySelector('#book-appt-btn')?.addEventListener('click', () => openBookAppointmentModal(() => patientProfile(el, { params }), p.id));

  const noteForm = el.querySelector('#add-note-form');
  noteForm?.addEventListener('submit', e => {
    e.preventDefault();
    const text = noteForm.text.value.trim();
    if (!text) return;
    const actor = ROLES[session.role];
    const when = new Date().toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    addPatientNote(p.id, { author: actor.user, role: actor.label, date: when, text });
    noteForm.reset();
    el.querySelector('#patient-notes').innerHTML = renderNotes(p);
  });
}

// Each note shows who wrote it (name + role) and when — "different users can
// add different comments" means the author/role on each entry, not a single
// shared free-text box.
function renderNotes(p) {
  const notes = p.notes ?? [];
  if (!notes.length) return '<p class="muted">No notes yet.</p>';
  return notes.map(n => `<div class="note"><div class="note-meta"><b>${escapeHtml(n.author)}</b> <span class="muted">${escapeHtml(n.role)} · ${escapeHtml(n.date)}</span></div><p>${escapeHtml(n.text)}</p></div>`).join('');
}
export const myHealth = el => patientProfile(el, { params: [getPatients()[0]?.id] });

export function inventory(el, { query }) {
  const tab = query.tab || 'equipment';
  // CHANGED (Harman): item name now links to the new #/inventory/:id detail
  // page (see pages/inventory-item.js) instead of being plain text.
  const rows = getInventory().filter(i => i.type === tab).map(i => `<tr data-inventory-row data-name="${escapeHtml(i.name.toLowerCase())}" data-unit="${escapeHtml(i.unit)}" class="${i.id === query.item ? 'hl' : ''}">
    <td><a href="#/inventory/${escapeHtml(i.id)}">${i.name}</a>${i.requiresApproval ? ' <span class="approval-marker" tabindex="0">⚠<span class="approval-tooltip">Requires a doctor\'s approval to administer.</span></span>' : ''}</td>
    <td>${i.unit}${i.unitNo ? ` <span class="muted">(${i.unitNo})</span>` : ''}</td><td>${i.qty}</td><td><span class="badge ${i.status}">${i.status}</span></td>
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
    // CHANGED (Harman): this quick "Request" button (for an item not in the
    // user's own unit) now actually logs a transfer request so it shows up
    // on the Requests page, instead of just linking there with no record.
    button.addEventListener('click', () => {
      const item = getInventory().find(i => i.id === button.dataset.requestItem);
      if (item) addRequestLogEntry({ type: 'transfer', item: item.name, itemId: item.id, quantity: 1, requestedBy: ROLES[session.role].user, status: 'pending' });
      location.hash = '#/requests?item=' + encodeURIComponent(button.dataset.requestItem);
    });
  });
}

// CHANGED (Harman): this page now shows the actual tracked log — every
// transfer request from the Inventory list and every administer request
// from an item's detail page (js/pages/inventory-item.js) — instead of a
// single-item lookup with no real record of anything.
export function requests(el) {
  const log = getRequestLog();
  const rows = log.map(r => `<tr>
    <td>${r.createdAt.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
    <td>${r.type === 'administer' ? 'Administer' : 'Transfer'}</td>
    <td>${escapeHtml(r.item)}${r.quantity ? ` × ${r.quantity}` : ''}</td>
    <td>${escapeHtml(r.patientName) || '—'}</td>
    <td>${escapeHtml(r.requestedBy)}</td>
    <td><span class="badge ${r.status.includes('completed') ? 'available' : 'low'}">${escapeHtml(r.status)}</span></td>
  </tr>`).join('');
  el.innerHTML = page('Requests and approvals', `
    <div class="card">
      ${log.length ? `<table><thead><tr><th>When</th><th>Type</th><th>Item</th><th>Patient</th><th>Requested by</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="muted">No requests yet this session. Use the Request button on an Inventory item to create one.</p>'}
    </div>
    <p><a href="#/inventory">← Back to Inventory</a></p>`);
}
export const users = soon('Users');
export const notFound = soon('Page not found');
export const help = el => { el.innerHTML = page('Help', `<div class="card"><ol>
  <li>Use the sidebar to move between sections. You only see what your role can use.</li>
  <li>The dashboard is your home page. Select any card to open the full page.</li>
  <li>Search Inventory for equipment or medicine. Select Request to view the item's stock details. Online requests are not available yet.</li>
  <li>A lock icon means the action needs approval from a doctor.</li></ol></div>`); };
