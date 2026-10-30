import { isConfigured, requestEquipment, fetchTransfers, decideTransfer } from '../api.js';
import { reloadEquipment } from '../data.js';
// STEP 5: placeholder pages with the deep links already wired (?patient=, ?unit=, ?tab=&item=).
import { ROLES, session, applyPermissions } from '../roles.js';
import { getPatients, getPatient, getAppointments, getInventory, addPatientNote, addAppointment, addRequestLogEntry, getRequestLog, myUnit, canDecideTransfer, acceptTransfer, rejectTransfer, getRequestsForMe, getQcItems, qualityCheckState, recordQualityCheck, QC_WINDOW_HOURS } from '../data.js';
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

// Picks the first appointment on file for this patient to show as a
// preview. Note: appointment "when" values are display strings, not real
// dates, so this isn't a true chronological sort — it's whichever
// appointment is first in the list (newly booked ones are added to the front).
function nextAppointmentPreview(p) {
  const [next] = getAppointments(p.id);
  if (!next) return '<p class="muted">Nothing scheduled.</p>';
  return `<div class="row"><b>${escapeHtml(next.when)}</b><span>${escapeHtml(next.type)}</span></div>`;
}

export function patientProfile(el, { params }) {
  const p = getPatient(params[0]);
  if (!p) return void (el.innerHTML = page('Patient not found', '<p class="muted">This patient doesn\'t exist or you don\'t have access.</p>'));

  // CHANGED (Harman): banners side by side; appointments card moved up with
  // a next-appointment preview; the remaining four cards shrunk into a 2x2
  // grid (medication schedule + providers, documents/requisitions + notes).
  el.innerHTML = page(p.name, `
    <div class="patient-profile">

      <div class="patient-banners">
        <div class="banner" data-cap="patients.viewSensitive">Diagnoses: ${p.diagnoses.join(', ') || 'None recorded'}</div>
        <div class="banner">Medications: ${p.meds.map(m => `<a data-cap="inventory.view" data-fallback="text" href="#/inventory?tab=medicine&item=${m.itemId}">${m.name}</a>`).join(', ') || 'None'}</div>
        <div class="banner">Allergies: ${p.allergies.join(', ') || 'None recorded'}</div>
      </div>

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

      <div class="card">
        <h3>Upcoming appointments</h3>
        ${nextAppointmentPreview(p)}
        <p><a href="#/appointments?patient=${p.id}">Expand</a> · <button id="book-appt-btn" type="button" data-cap="appointments.view">Book a new appointment</button></p>
      </div>

      <div class="patient-squares">
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
      </div>

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
  // SPRINT 2: the Request button now compares against myUnit() (the Unit
  // clerk's own unit) instead of session.unit; other roles are unchanged.
  const rows = getInventory().filter(i => i.type === tab).map(i => `<tr data-inventory-row data-name="${escapeHtml(i.name.toLowerCase())}" data-unit="${escapeHtml(i.unit)}" class="${i.id === query.item ? 'hl' : ''}">
    <td><a href="#/inventory/${escapeHtml(i.id)}">${i.name}</a>${i.requiresApproval ? ' <span class="approval-marker" tabindex="0">⚠<span class="approval-tooltip">Requires a doctor\'s approval to administer.</span></span>' : ''}</td>
    <td>${i.unit}${i.unitNo ? ` <span class="muted">(${i.unitNo})</span>` : ''}</td><td>${i.qty}</td><td><span class="badge ${i.status}">${i.status}</span></td>
    <td>${i.unit !== myUnit() ? `<button data-cap="transfers.request" data-request-item="${escapeHtml(i.id)}">Request</button>` : ''}</td></tr>`).join('');
  const units = [...new Set(getInventory().filter(i => i.type === tab).map(i => i.unit))].sort();
  // SPRINT 2: BGM quality-check panel. Only users with the equipment.qc
  // capability (charge nurse) see it; applyPermissions removes it for others.
  // BGMs that are overdue or never checked are listed first.
  const qcItems = (tab === 'equipment' ? getQcItems() : [])
    .sort((a, b) => Number(qualityCheckState(a).ok) - Number(qualityCheckState(b).ok));
  const qcDone = qcItems.filter(i => qualityCheckState(i).ok).length;
  const qcRows = qcItems.map(i => {
    const s = qualityCheckState(i);
    return `<tr><td><a href="#/inventory/${escapeHtml(i.id)}">${escapeHtml(i.name)}</a></td><td>${escapeHtml(i.unit)}</td><td><span class="badge ${s.ok ? 'available' : 'out'}">${escapeHtml(s.label)}</span></td><td>${escapeHtml(i.qcBy) || '—'}</td><td><button type="button" data-qc="${escapeHtml(i.id)}">Record check</button></td></tr>`;
  }).join('');
  const qcCard = qcItems.length ? `<div class="card" data-cap="equipment.qc">
    <h3>BGM quality checks</h3>
    <p class="muted">Each BGM needs a quality check every ${QC_WINDOW_HOURS} hours. ${qcDone} of ${qcItems.length} checked in the last ${QC_WINDOW_HOURS} hours.</p>
    <table><thead><tr><th scope="col">BGM</th><th scope="col">Unit</th><th scope="col">Quality check</th><th scope="col">Last checked by</th><th scope="col">Action</th></tr></thead><tbody>${qcRows}</tbody></table>
  </div>` : '';
  el.innerHTML = page('Inventory', `<div class="tabs"><a class="${tab === 'equipment' ? 'on' : ''}" href="#/inventory?tab=equipment">Equipment</a><a class="${tab === 'medicine' ? 'on' : ''}" href="#/inventory?tab=medicine">Medicine</a></div>
    <p class="muted">Find items and check stock across units. Medicine is sample data.</p>
    <div class="inventory-tools"><label>Search items<input id="inventory-search" type="search" placeholder="Search by item name"></label><label>Unit<select id="inventory-unit"><option value="">All units</option>${units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('')}</select></label><span id="inventory-count" class="muted" role="status"></span></div>
    <div class="card"><table><thead><tr><th scope="col">Item</th><th scope="col">Unit</th><th scope="col">Quantity</th><th scope="col">Availability</th><th scope="col">Action</th></tr></thead><tbody>${rows}</tbody></table><p id="inventory-empty" class="empty-state" hidden>No items match your filters.</p></div>${qcCard}`);
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
  el.querySelectorAll('[data-qc]').forEach(button => button.addEventListener('click', () => {
    recordQualityCheck(button.dataset.qc);
    inventory(el, { query });      // redraw so the status updates
    applyPermissions(el);          // redraw skips the router, so re-apply role rules
  }));
  el.querySelectorAll('[data-request-item]').forEach(button => {
    // CHANGED (Harman): this quick "Request" button (for an item not in the
    // user's own unit) now actually logs a transfer request so it shows up
    // on the Requests page, instead of just linking there with no record.
    // SPRINT 2: the entry now records which unit it is requested from
    // (sourceItemId, sourceUnit) and which unit is asking (requestingUnit),
    // so that unit's clerk can accept or reject it on the Requests page.
    button.addEventListener('click', async () => {
      const item = getInventory().find(i => i.id === button.dataset.requestItem);
      if (isConfigured()) {
        if (!item) return;
        button.disabled = true;
        try {
          await requestEquipment(item.id);
          location.hash = '#/requests';
        } catch (error) { alert(error.message); }
        finally { button.disabled = false; }
        return;
      }
      if (item) addRequestLogEntry({
        type: 'transfer', item: item.name, itemId: item.id,
        sourceItemId: item.id, sourceUnit: item.unit, requestingUnit: myUnit(),
        quantity: 1, requestedBy: ROLES[session.role].user, status: 'pending',
      });
      location.hash = '#/requests?item=' + encodeURIComponent(button.dataset.requestItem);
    });
  });
}

// CHANGED (Harman): this page now shows the actual tracked log — every
// transfer request from the Inventory list and every administer request
// from an item's detail page (js/pages/inventory-item.js) — instead of a
// single-item lookup with no real record of anything.
// SPRINT 2: added a "From unit" column and an Action column. A unit clerk
// (or anyone allowed by canDecideTransfer in data.js) sees Accept / Reject
// on pending transfers whose source unit is their own unit.
export async function requests(el) {
  const renderedRoute = globalThis.location?.hash;
  let log;
  if (isConfigured()) {
    el.innerHTML = page('Requests and approvals', '<p role="status">Loading saved equipment requests…</p>');
    try {
      log = (await fetchTransfers()).map(r => ({...r, createdAt: new Date(r.createdAt)}));
      if ((!el.isConnected && el.isConnected !== undefined) || globalThis.location?.hash !== renderedRoute) return;
    } catch (error) {
      el.innerHTML = page('Requests and approvals', `<p role="alert">${escapeHtml(error.message)}</p><a href="#/inventory">Back to Inventory</a>`);
      return;
    }
  } else log = getRequestsForMe();   // SPRINT 2: unit clerks only see their own unit's requests
  const badgeClass = s => /completed|approved/.test(s) ? 'available' : s === 'rejected' ? 'out' : 'low';
  const rows = log.map(r => `<tr>
    <td>${r.createdAt.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
    <td>${r.type === 'administer' ? 'Administer' : 'Transfer'}</td>
    <td>${escapeHtml(r.item)}${r.quantity ? ` × ${r.quantity}` : ''}</td>
    <td>${escapeHtml(r.sourceUnit) || '—'}</td>
    <td>${escapeHtml(r.patientName) || '—'}</td>
    <td>${escapeHtml(r.requestedBy)}</td>
    <td><span class="badge ${badgeClass(r.status)}">${escapeHtml(r.status)}</span>${r.decidedBy ? ` <span class="muted">by ${escapeHtml(r.decidedBy)}</span>` : ''}</td>
    <td>${canDecideTransfer(r) ? `<button type="button" data-accept="${escapeHtml(r.id)}">${r.persisted ? 'Approve and reserve' : 'Accept demo'}</button> <button type="button" data-reject="${escapeHtml(r.id)}">Reject</button>` : ''}</td>
  </tr>`).join('');
  el.innerHTML = page('Requests and approvals', `
    <p class="muted">${isConfigured() ? 'Saved equipment requests. Approval reserves an asset; it does not move equipment between units. Account permissions come from the database.' : 'Demo requests reset on reload.'}</p>
    <div class="card">
      ${log.length ? `<table><thead><tr><th>When</th><th>Type</th><th>Item</th><th>From unit</th><th>Patient</th><th>Requested by</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="muted">No equipment requests to show. Use Request on an Inventory item.</p>'}
    </div>
    <p><a href="#/inventory">← Back to Inventory</a></p>`);

  async function decide(button, approve) {
    button.disabled = true;
    try {
      if (isConfigured()) {
        await decideTransfer(approve ? button.dataset.accept : button.dataset.reject, approve);
        // The decision is already committed. A refresh failure must not suggest it was rolled back.
        await reloadEquipment();
      } else {
        const result = approve ? acceptTransfer(button.dataset.accept) : rejectTransfer(button.dataset.reject);
        if (!result.ok) alert(result.reason);
      }
      if (globalThis.location?.hash === renderedRoute) await requests(el);
    } catch (error) { alert(error.message); }
    finally { button.disabled = false; }
  }
  el.querySelectorAll('[data-accept]').forEach(button => button.addEventListener('click', () => decide(button, true)));
  el.querySelectorAll('[data-reject]').forEach(button => button.addEventListener('click', () => decide(button, false)));
  applyPermissions(el);
}
export const users = soon('Users');
export const notFound = soon('Page not found');
export const help = el => { el.innerHTML = page('Help', `<div class="card"><ol>
  <li>Use the sidebar to move between sections. You only see what your role can use.</li>
  <li>The dashboard is your home page. Select any card to open the full page.</li>
  <li>Search Inventory for equipment or medicine. Select Request to view the item's stock details. Online requests are not available yet.</li>
  <li>A lock icon means the action needs approval from a doctor.</li></ol></div>`); };
