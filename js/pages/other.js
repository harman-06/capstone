import { openEquipmentNeed } from './equipment-need.js';
import { renderAllocationQueue } from './allocation.js';
import { isConfigured, fetchTransfers, decideTransfer, verifyTransferAsset } from '../api.js';
import { reloadEquipment } from '../data.js';
// STEP 5: placeholder pages with the deep links already wired (?patient=, ?unit=, ?tab=&item=).
import { ROLES, session, applyPermissions } from '../roles.js';
import { getPatients, getPatient, getAppointments, getInventory, addPatientNote, addAppointment, addRequestLogEntry, getRequestLog, myUnit, canDecideTransfer, acceptTransfer, rejectTransfer, getRequestsForMe, getQcItems, qualityCheckState, recordQualityCheck, QC_WINDOW_HOURS } from '../data.js';
import { openModal } from '../modal.js';
import { updatePatientProfile, addEvent } from '../data.js';
import { can } from '../roles.js';
import { toast } from '../toast.js';
const page = (title, body) => `<h1>${title}</h1>${body}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Shared "Book a new appointment" modal, used on the Appointments page and on a patient's profile.
// Patients book for themselves; staff pick from the patients they can see.
function openBookAppointmentModal(onBooked, patientId) {
  const patients = getPatients();
  const preset = patientId ? patients.find(p => p.id === patientId) : patients.length === 1 ? patients[0] : null;
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openModal({
    title: 'Book an appointment',
    submitLabel: 'Book appointment',
    bodyHtml: `
      ${preset ? `<p>Patient: <b>${escapeHtml(preset.name)}</b></p>`
        : `<label>Patient <select name="patient">${patients.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}</select></label>`}
      <label>Appointment type <input name="type" placeholder="e.g. Follow-up, Consultation" required></label>
      <label>Date and time <input name="when" type="datetime-local" min="${now}" required></label>`,
    onSubmit(form) {
      const patient = preset ?? patients.find(p => p.id === form.patient.value);
      const date = new Date(form.when.value);
      if (!patient || Number.isNaN(date.getTime())) { toast('Enter a valid date and time.', { error: true }); return false; }
      if (date < new Date()) { toast('Choose a date and time in the future.', { error: true }); return false; }
      const type = form.type.value.trim() || 'Appointment';
      const when = date.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      addAppointment({ patientId: patient.id, patientName: patient.name, unit: patient.unit, type, when });
      if (ROLES[session.role].scope === 'self') addEvent({ audience: 'staff', severity: 'info', text: `${patient.name} booked an appointment`, detail: `${type} · ${when}`, target: `#/patients/${patient.id}` });
      else addEvent({ audience: `patient:${patient.id}`, severity: 'info', text: `Appointment booked: ${type}`, detail: when, target: '#/appointments' });
      toast('Appointment booked.');
      onBooked?.();
    },
  });
}

export function appointments(el, { query }) {
  const rows = getAppointments(query.patient).map(a => `<div class="row"><b>${escapeHtml(a.when)}</b><span>${escapeHtml(a.patientName)} · ${escapeHtml(a.type)}</span></div>`).join('');
  el.innerHTML = page('Appointments', `
    ${query.patient ? '<p class="muted">Showing one patient. <a href="#/appointments">Show all</a></p>' : ''}
    <p><button id="book-appt-btn" type="button" data-cap="appointments.view">Book an appointment</button></p>
    <div class="card">${rows || '<p class="muted">No appointments scheduled.</p>'}</div>`);
  el.querySelector('#book-appt-btn')?.addEventListener('click', () => openBookAppointmentModal(() => appointments(el, { query })));
}

export function patients(el, { query }) {
  const all = getPatients(), unit = query.unit || '';
  const units = [...new Set(all.map(p => p.unit))].sort();
  const locked = ROLES[session.role].scope !== 'all' ? 'disabled' : '';
  const nextOf = id => getAppointments(id)[0]?.when ?? 'None scheduled';
  const rows = all.filter(p => !unit || p.unit === unit).map(p => `<tr data-search="${escapeHtml(`${p.name} ${p.medicalId ?? ''}`.toLowerCase())}">
    <td><a href="#/patients/${escapeHtml(p.id)}">${escapeHtml(p.name)}</a></td>
    <td data-cap="patients.viewSensitive">${escapeHtml(p.medicalId ?? '—')}</td>
    <td>${escapeHtml(p.unit)}</td><td>${escapeHtml(nextOf(p.id))}</td></tr>`).join('');
  el.innerHTML = page('Patients', `
    <div class="inventory-tools">
      <label>Search patients<input id="patient-search" type="search" placeholder="Name or medical ID" autocomplete="off"></label>
      <label>Department<select id="unit-filter" ${locked}><option value="">All departments</option>${units.map(u => `<option ${u === unit ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}</select></label>
      <span class="muted" id="patient-count" role="status"></span>
    </div>
    <div class="card"><table><thead><tr><th scope="col">Patient</th><th scope="col">Medical ID</th><th scope="col">Department</th><th scope="col">Next appointment</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">No patients to show.</td></tr>'}</tbody></table></div>`);
  const search = el.querySelector('#patient-search');
  const count = el.querySelector('#patient-count');
  const filter = () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    el.querySelectorAll('tbody tr[data-search]').forEach(tr => { const match = !q || tr.dataset.search.includes(q); tr.hidden = !match; if (match) shown++; });
    count.textContent = `${shown} of ${all.filter(p => !unit || p.unit === unit).length} patients`;
  };
  search.addEventListener('input', filter);
  filter();
  el.querySelector('#unit-filter').onchange = e => { location.hash = '#/patients' + (e.target.value ? '?unit=' + encodeURIComponent(e.target.value) : ''); };
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
  if (!p) return void (el.innerHTML = page('Patient not found', '<p class="muted">This patient does not exist or you do not have access to the record. <a href="#/dashboard">Return to the dashboard</a>.</p>'));
  const own = ROLES[session.role].scope === 'self';
  const ec = p.emergencyContact;
  const updated = p.profileUpdatedAt ? `Updated by the patient on ${new Date(p.profileUpdatedAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '';

  // Sensitive values are masked one by one (data-cap on the value), so the rest of the
  // record, including notes and booking, stays usable for roles that cannot see them.
  el.innerHTML = page(escapeHtml(p.name), `
    <div class="patient-profile">

      <div class="patient-banners">
        <div class="banner">Diagnoses: <span data-cap="patients.viewSensitive">${escapeHtml(p.diagnoses.join(', ') || 'None recorded')}</span></div>
        <div class="banner">Medications: ${p.meds.map(m => `<a data-cap="inventory.view" data-fallback="text" href="#/inventory?tab=medicine&item=${encodeURIComponent(m.itemId)}">${escapeHtml(m.name)}</a>`).join(', ') || 'None'}</div>
        <div class="banner">Allergies: ${escapeHtml(p.allergies.join(', ') || 'None recorded')}</div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Patient details</h3>${own ? '<button type="button" id="edit-profile-btn">Edit profile</button>' : ''}</div>
        <dl class="item-facts">
          <div><dt>Medical ID</dt><dd data-cap="patients.viewSensitive">${escapeHtml(p.medicalId) || '—'}</dd></div>
          <div><dt>Date of birth / age</dt><dd data-cap="patients.viewSensitive">${escapeHtml(ageLine(p))}</dd></div>
          <div><dt>Height</dt><dd>${p.heightCm ? p.heightCm + ' cm' : '—'}</dd></div>
          <div><dt>Weight</dt><dd>${p.weightKg ? p.weightKg + ' kg' : '—'}</dd></div>
          <div><dt>Phone</dt><dd data-cap="patients.viewSensitive">${escapeHtml(p.contact?.phone) || '—'}</dd></div>
          <div><dt>Email</dt><dd data-cap="patients.viewSensitive">${escapeHtml(p.contact?.email) || '—'}</dd></div>
          <div><dt>Address</dt><dd data-cap="patients.viewSensitive">${escapeHtml(p.contact?.address) || '—'}</dd></div>
          <div><dt>Emergency contact</dt><dd data-cap="patients.viewSensitive">${ec ? escapeHtml([ec.name, ec.relationship, ec.phone].filter(Boolean).join(' · ')) : '—'}</dd></div>
        </dl>
        ${updated ? `<p class="muted">${escapeHtml(updated)}</p>` : ''}
      </div>

      <div class="card">
        <h3>Upcoming appointments</h3>
        ${nextAppointmentPreview(p)}
        <p><a href="#/appointments?patient=${encodeURIComponent(p.id)}">View all</a> · <button id="book-appt-btn" type="button" data-cap="appointments.view">Book an appointment</button></p>
      </div>

      <div class="patient-squares">
        <div class="card">
          <h3>Medication schedule</h3>
          ${(p.medicationSchedule ?? []).map(s => `<div class="row"><b>${escapeHtml(s.time)}</b><span>${escapeHtml(s.med)} — ${escapeHtml(s.route)}</span></div>`).join('') || '<p class="muted">Nothing scheduled.</p>'}
        </div>

        <div class="card">
          <h3>Primary providers</h3>
          ${(p.providers ?? []).map(pr => `<div class="row"><b>${escapeHtml(pr.name)}</b><span>${escapeHtml(pr.role)} · ${escapeHtml(pr.org)}</span></div>`).join('') || '<p class="muted">None recorded.</p>'}
        </div>

        <div class="card">
          <h3>Documents &amp; requisitions</h3>
          ${(p.documents ?? []).map(d => `<div class="row"><span>${escapeHtml(d.name)}</span><span class="muted">${escapeHtml(d.date)}</span></div>`).join('')}
          ${(p.requisitions ?? []).map(r => `<div class="row"><span>${escapeHtml(r.name)}</span><span class="muted">${escapeHtml(r.status)} · ${escapeHtml(r.date)}</span></div>`).join('')}
          ${!(p.documents?.length || p.requisitions?.length) ? '<p class="muted">Nothing on file.</p>' : ''}
        </div>

        <div class="card">
          <h3>Notes</h3>
          <div id="patient-notes">${renderNotes(p)}</div>
          <form id="add-note-form" data-cap="notes.add">
            <label>Add a note <textarea name="text" rows="2" required placeholder="Visible to staff who can view this patient"></textarea></label>
            <button type="submit">Add note</button>
          </form>
        </div>
      </div>

    </div>`);

  el.querySelector('#book-appt-btn')?.addEventListener('click', () => openBookAppointmentModal(() => patientProfile(el, { params }), p.id));
  el.querySelector('#edit-profile-btn')?.addEventListener('click', () => openEditProfile(p, () => { patientProfile(el, { params }); applyPermissions(el); }));

  const noteForm = el.querySelector('#add-note-form');
  noteForm?.addEventListener('submit', e => {
    e.preventDefault();
    const text = noteForm.text.value.trim();
    if (!text || can('notes.add') !== 'allow') return;
    const actor = ROLES[session.role];
    const when = new Date().toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    addPatientNote(p.id, { author: actor.user, role: actor.label, date: when, text });
    noteForm.reset();
    el.querySelector('#patient-notes').innerHTML = renderNotes(p);
    toast('Note added.');
  });
}

// Patients edit their own contact details, measurements, allergies and emergency contact.
// Medical ID and date of birth are shown but cannot be changed here.
function openEditProfile(p, onSaved) {
  const field = (name, label, value, attrs = '') => `<label>${label}<input name="${name}" value="${escapeHtml(value ?? '')}" ${attrs}></label>`;
  const ec = p.emergencyContact ?? {};
  openModal({
    title: 'Edit profile',
    submitLabel: 'Save changes',
    bodyHtml: `
      ${field('phone', 'Phone', p.contact?.phone, 'type="tel" autocomplete="tel"')}
      ${field('email', 'Email', p.contact?.email, 'type="email" autocomplete="email"')}
      ${field('address', 'Address', p.contact?.address, 'autocomplete="street-address"')}
      ${field('heightCm', 'Height (cm)', p.heightCm, 'type="number" step="any" min="50" max="260"')}
      ${field('weightKg', 'Weight (kg)', p.weightKg, 'type="number" step="any" min="2" max="400"')}
      ${field('allergies', 'Allergies (separate with commas)', (p.allergies ?? []).join(', '))}
      ${field('emergencyName', 'Emergency contact name', ec.name)}
      ${field('emergencyRelationship', 'Relationship', ec.relationship)}
      ${field('emergencyPhone', 'Emergency contact phone', ec.phone, 'type="tel"')}
      <p class="muted">To correct your date of birth or medical ID, contact hospital registration.</p>`,
    onSubmit(form) {
      const result = updatePatientProfile(p.id, Object.fromEntries(new FormData(form)));
      if (!result.ok) { toast(Object.values(result.errors)[0], { error: true }); return false; }
      toast('Profile updated.');
      onSaved();
    },
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
    <td>${(isConfigured() && i.type === 'equipment') || i.unit !== myUnit() ? `<button data-cap="transfers.request" data-request-item="${escapeHtml(i.id)}">Request</button>` : ''}</td></tr>`).join('');
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
    <p class="muted">Find items and check stock across units.</p>
    <div class="inventory-tools"><label>Search items<input id="inventory-search" type="search" placeholder="Search by item name"></label><label>Unit<select id="inventory-unit"><option value="">All units</option>${units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('')}</select></label><span id="inventory-count" class="muted" role="status"></span></div>
    <div class="card"><table><thead><tr><th scope="col">Item</th><th scope="col">Unit</th><th scope="col">${tab === 'equipment' ? 'Available now' : 'Quantity'}</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>${rows}</tbody></table><p id="inventory-empty" class="empty-state" hidden>No items match your filters.</p></div>${qcCard}`);
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
        if (item?.type === 'equipment') await openEquipmentNeed(item, el, button);
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
      if (el.isConnected === false || globalThis.location?.hash !== renderedRoute) return;
      el.innerHTML = page('Requests and approvals', `<p role="alert">${escapeHtml(error.message)}</p><a href="#/inventory">Back to Inventory</a>`);
      return;
    }
  } else log = getRequestsForMe();   // SPRINT 2: unit clerks only see their own unit's requests
  const stageLabels = {requested: 'Request', reviewed: 'Priority review', allocated: 'Allocate', reserved: 'Reserve', dispatched: 'Dispatch', in_transit: 'In transit', received: 'Receive', completed: 'Complete'};
  const scannedTag = new URLSearchParams(renderedRoute?.split('?')[1]).get('asset');
  const scannedTransfer = scannedTag && log.find(r => r.assetTag === scannedTag && (r.canDispatch || r.canReceive));
  const badgeClass = s => /completed|approved/.test(s) ? 'available' : s === 'rejected' ? 'out' : 'low';
  const rows = log.map(r => `<tr>
    <td>${r.createdAt.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
    <td>${r.type === 'administer' ? 'Administer' : 'Transfer'}</td>
    <td>${escapeHtml(r.item)}${r.quantity ? ` × ${r.quantity}` : ''}</td>
    <td>${escapeHtml(r.sourceUnit) || '—'}</td>
    <td>${escapeHtml(r.patientName) || '—'}</td>
    <td>${escapeHtml(r.requestedBy)}</td>
    <td><span class="badge ${badgeClass(r.status)}">${escapeHtml(stageLabels[r.status] ?? r.status)}</span>${r.decidedBy ? ` <span class="muted">by ${escapeHtml(r.decidedBy)}</span>` : ''}</td>
    <td>${r.canDispatch ? `<button type="button" data-dispatch="${escapeHtml(r.id)}">Verify dispatch</button>` : ''}${r.canReceive ? `<button type="button" data-receive="${escapeHtml(r.id)}">Verify receipt</button>` : ''}${canDecideTransfer(r) ? `<button type="button" data-accept="${escapeHtml(r.id)}" ${r.persisted ? 'disabled title="Use the allocation queue for new requests"' : ''}>${r.persisted ? 'Approve through queue' : 'Accept demo'}</button> <button type="button" data-reject="${escapeHtml(r.id)}">Reject</button>` : ''}</td>
  </tr>${r.timeline?.length ? `<tr><td colspan="8"><details><summary>Transfer timeline · ${escapeHtml(r.sourceUnit)} → ${escapeHtml(r.requestingUnit)}</summary><ol>${r.timeline.map(event => `<li>${escapeHtml(stageLabels[event.stage] ?? event.stage)}${event.tagVerified ? ' · Equipment tag matched' : ''} · ${escapeHtml(new Date(event.at).toLocaleString())}</li>`).join('')}</ol></details></td></tr>` : ''}`).join('');
  el.innerHTML = page('Requests and approvals', `
    ${isConfigured() ? '<section class="card" id="allocation-queue"></section><h2>Transfer history</h2><button type="button" data-transfer-refresh>Refresh transfers</button>' : ''}
    <p class="muted">${isConfigured() ? 'Saved transfers. The source unit dispatches reserved equipment. The destination unit confirms receipt to complete the transfer and update inventory.' : 'Demo requests reset on reload.'}</p>
    ${scannedTag ? `<div class="card">
      ${scannedTransfer ? `<p>Equipment tag found. Confirm the ${scannedTransfer.canDispatch ? 'dispatch' : 'receipt'} in your unit.</p>
        <button type="button" data-verify-scan>Review scanned equipment</button>`
        : '<p role="status">There is no handoff you can confirm for this tag right now.</p>'}
    </div>` : ''}
    <div class="card">
      ${log.length ? `<table><thead><tr><th>When</th><th>Type</th><th>Item</th><th>From unit</th><th>Patient</th><th>Requested by</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="muted">No equipment requests to show. Use Request on an Inventory item.</p>'}
    </div>
    <p><a href="#/inventory">← Back to Inventory</a></p>`);

  async function refreshAfterMovement() {
    const refreshed = await reloadEquipment().catch(() => false);
    if (globalThis.location?.hash !== renderedRoute || el.isConnected === false) return;
    await requests(el);
    if (refreshed === false) toast('The inventory could not be refreshed.', { error: true });
  }
  const refreshButton = el.querySelector('[data-transfer-refresh]');
  if (refreshButton) refreshButton.onclick = refreshAfterMovement;
  if (isConfigured()) await renderAllocationQueue(el.querySelector('#allocation-queue'), refreshAfterMovement);
  if (globalThis.location?.hash !== renderedRoute || el.isConnected === false) return;

  function openHandoff(record, action, scanned = false) {
    const actionName = action === 'dispatch' ? 'dispatch' : 'receipt';
    const unit = action === 'dispatch' ? record.sourceUnit : record.requestingUnit;
    const demoTag = !scanned && /^NX-(?:DEMO-SCALE-(?:CARD|ER|ONC)-[A-Za-z0-9-]+|PUMP-CARD|VEN-(?:ER|ONC)|DEF-ER)-[0-9]{3}$/.test(record.assetTag ?? '')
      ? escapeHtml(record.assetTag) : '';
    openModal({
      title: `Verify ${actionName}`,
      submitLabel: `Confirm ${actionName}`,
      bodyHtml: `<p>${escapeHtml(record.item)} · ${escapeHtml(unit)}</p>
        ${demoTag ? `<label>Assigned demo tag<select name="demoTag">
          <option value="">Enter tag manually</option>
          <option value="${demoTag}">${demoTag}</option>
        </select></label>` : ''}
        <label>Equipment tag<input name="assetTag" maxlength="60" required autocomplete="off" autocapitalize="off" spellcheck="false" value="${scanned ? escapeHtml(scannedTag) : ''}"></label>
        <p class="muted">${demoTag ? 'For a walkthrough, select the assigned demo tag. For a physical handoff, scan or type the code on the equipment sticker.' : 'Scan the sticker with your phone camera or type the code printed on it.'}</p>`,
      onMount(form) {
        if (!demoTag) return;
        form.demoTag.onchange = () => { form.assetTag.value = form.demoTag.value; };
        form.assetTag.oninput = () => { form.demoTag.value = ''; };
      },
      async onSubmit(form) {
        await verifyTransferAsset(record.id, action, form.assetTag.value.trim());
        if (globalThis.location?.hash !== renderedRoute || el.isConnected === false) return;
        toast(action === 'dispatch' ? 'Dispatch confirmed.' : 'Receipt confirmed. Inventory updated.');
        await refreshAfterMovement();
      }
    });
  }
  const scanButton = el.querySelector('[data-verify-scan]');
  if (scanButton) scanButton.onclick = () => openHandoff(scannedTransfer, scannedTransfer.canDispatch ? 'dispatch' : 'receive', true);
  el.querySelectorAll('[data-dispatch]').forEach(button => {
    button.onclick = () => openHandoff(log.find(r => r.id === button.dataset.dispatch), 'dispatch');
  });
  el.querySelectorAll('[data-receive]').forEach(button => {
    button.onclick = () => openHandoff(log.find(r => r.id === button.dataset.receive), 'receive');
  });

  async function decide(button, approve) {
    button.disabled = true;
    try {
      if (isConfigured()) {
        await decideTransfer(approve ? button.dataset.accept : button.dataset.reject, approve);
        // The decision is already committed. A refresh failure must not suggest it was rolled back.
        await reloadEquipment();
      } else {
        const result = approve ? acceptTransfer(button.dataset.accept) : rejectTransfer(button.dataset.reject);
        if (!result.ok) toast(result.reason, { error: true });
      }
      if (globalThis.location?.hash === renderedRoute) await requests(el);
    } catch (error) { toast(error.message, { error: true }); }
    finally { button.disabled = false; }
  }
  el.querySelectorAll('[data-accept]').forEach(button => button.addEventListener('click', () => decide(button, true)));
  el.querySelectorAll('[data-reject]').forEach(button => button.addEventListener('click', () => decide(button, false)));
  applyPermissions(el);
}
export const notFound = el => { el.innerHTML = page('Page not found', '<p class="muted">The page you asked for does not exist. <a href="#/dashboard">Return to the dashboard</a>.</p>'); };
