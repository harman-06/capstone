import { isConfigured, requestEquipment } from '../api.js';
// NEW FILE (Harman): Inventory item detail subpage.
// Route: #/inventory/:id (added to js/main.js's route list)
//
// Shows an item's description, quantity on hand, and unit location, and lets
// a qualified role select a quantity + patient and administer it:
//   1. If the item needs doctor approval (requiresApproval) and the current
//      role only has 'approval' for that action, this re-uses the existing
//      roles.js lock/approval flow instead of opening anything itself.
//   2. Otherwise, a modal collects quantity + patient.
//   3. If the item has a prerequisite (e.g. "confirm blood pressure before
//      giving this"), a second modal asks for it and checks the answer
//      against the patient's chart. A failed check offers an emergency
//      override with a required reason instead of silently blocking.
//   4. Either way, the result is recorded: inventory quantity decreases, a
//      note is added to the patient's chart automatically, and an entry
//      appears on the Requests page.
//
// SPRINT 2 ADDITION (cross-unit availability): equipment items now show which
// other units hold the same item, and the equipment request modal lets the
// user choose which unit to request from. The chosen unit is saved on the
// request log entry (sourceItemId, sourceUnit).
import { ROLES, session, can, requestApproval } from '../roles.js';
import { getInventoryItem, getInventory, getUnits, getPatients, adjustInventoryQty, addPatientNote, addRequestLogEntry } from '../data.js';
import { openModal } from '../modal.js';

const page = (title, body) => `<h1>${title}</h1>${body}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// --- Sprint 2: cross-unit availability helpers ------------------------------

// "Unit name (unit number)" label; the number is looked up from the units list
// because raw inventory rows don't always carry it.
const unitLabel = i => {
  const n = getUnits().find(u => u.name === i.unit)?.number;
  return `${escapeHtml(i.unit)}${n ? ` (${escapeHtml(n)})` : ''}`;
};

// Same equipment held by other units, matched by name.
function renderOtherUnits(item) {
  const others = getInventory().filter(i => i.name === item.name && i.id !== item.id);
  if (!others.length) return '<p class="muted">No other unit holds this item.</p>';
  return others.map(i => `
    <div class="row">
      <span>${unitLabel(i)}: ${i.qty} on hand</span>
      <span class="badge ${i.status}">${escapeHtml(i.status)}</span>
    </div>`).join('');
}

// Other units that can actually supply the item (stock above 0, not 'out').
const getUnitOptions = item =>
  getInventory().filter(i => i.name === item.name && i.id !== item.id && i.qty > 0 && i.status !== 'out');

// ----------------------------------------------------------------------------

export function inventoryItem(el, { params }) {
  const item = getInventoryItem(params[0]);
  if (!item) {
    el.innerHTML = page('Item not found', '<p class="muted">This item doesn\'t exist, or hasn\'t loaded yet.</p><a href="#/inventory">← Back to Inventory</a>');
    return;
  }
  const patients = getPatients();
  const activity = [];   // this page's own session log, shown under "Recent activity"

  el.innerHTML = page(item.name, `
    <p><a href="#/inventory?tab=${item.type}">← Back to Inventory</a></p>
    <div class="card item-detail">
      <p class="item-description">${escapeHtml(item.description)}
        ${item.requiresApproval ? `
          <span class="approval-marker" tabindex="0">
            ⚠ Requires approval
            <span class="approval-tooltip">A doctor must approve this before it's administered.</span>
          </span>` : ''}
      </p>
      <dl class="item-facts">
        <div><dt>Quantity on hand</dt><dd id="item-qty">${item.qty}</dd></div>
        <div><dt>Unit location</dt><dd>${escapeHtml(item.unit)}${item.unitNo ? ` (${escapeHtml(item.unitNo)})` : ''}</dd></div>
        <div><dt>Status</dt><dd><span class="badge ${item.status}">${item.status}</span></dd></div>
      </dl>
      <button id="request-btn" type="button">Request</button>
    </div>
    <div class="card">
      <h3>Availability in other units</h3>
      ${renderOtherUnits(item)}
    </div>
    <div class="card">
      <h3>Recent activity this session</h3>
      <p class="muted" id="activity-empty">Nothing recorded yet.</p>
      <div id="activity-list"></div>
    </div>`);

  el.querySelector('#request-btn').addEventListener('click', () => {
    // Explicit permission check here (rather than relying on applyPermissions'
    // own click-intercept) so a nurse can never reach the modal for a
    // controlled item even for a moment — the check runs before anything else.
    const cap = item.requiresApproval ? 'meds.administerControlled' : 'inventory.update';
    const state = can(cap);
    if (state === 'deny') return;                 // button wouldn't normally be visible for this role
    if (state === 'approval') { requestApproval(cap); return; }
    item.type === 'medicine' ? openAdministerModal(item, patients, el, activity) : openTransferModal(item, el, activity);
  });
}

function logActivity(el, activity, entry) {
  activity.unshift(entry);
  el.querySelector('#activity-empty').hidden = true;
  el.querySelector('#activity-list').innerHTML = activity
    .map(a => `<div class="row"><span>${escapeHtml(a.summary)}</span><span class="muted">${escapeHtml(a.status)}</span></div>`).join('');
}

// Equipment: request-for-transfer from another unit, no patient/prerequisite involved.
// Sprint 2: the user picks which unit to take the item from. Stock is not
// changed here; the request stays 'pending' until an approver decides.
function openTransferModal(item, el, activity) {
  const sources = getUnitOptions(item);
  if (!sources.length) { alert(`${item.name} is not available in any other unit right now.`); return; }
  openModal({
    title: `Request ${item.name}`,
    submitLabel: 'Submit request',
    bodyHtml: `
      <label>Take from
        <select name="source">
          ${sources.map(s => `<option value="${escapeHtml(s.id)}">${unitLabel(s)}: ${s.qty} available</option>`).join('')}
        </select>
      </label>
      <label>Quantity <input name="quantity" type="number" min="1" ${isConfigured() ? 'max="1"' : ''} value="1" required></label>
      ${isConfigured() ? '<p class="muted">One reusable asset per saved request. The destination is your signed-in account’s assigned unit.</p>' : ''}`,
    async onSubmit(form) {
      const source = sources.find(s => String(s.id) === form.source.value);
      const quantity = Number(form.quantity.value);
      if (!source || !quantity || quantity < 1 || quantity > source.qty) {
        alert('Enter a quantity between 1 and the stock in the chosen unit.');
        return false;
      }
      if (isConfigured()) {
        if (quantity !== 1) { alert('Create one saved request per reusable asset.'); return false; }
        const id = await requestEquipment(source.id);
        logActivity(el, activity, {summary: `Saved equipment request ${id}`, status: 'requested'});
        return;
      }
      const record = addRequestLogEntry({
        type: 'transfer', item: item.name, itemId: item.id,
        sourceItemId: source.id, sourceUnit: source.unit,
        quantity, requestedBy: ROLES[session.role].user, status: 'pending',
      });
      logActivity(el, activity, { summary: `Requested ${quantity} × ${item.name} from ${source.unit}`, status: record.status });
    },
  });
}

// Medicine: quantity + patient first, then the prerequisite check (if any).
function openAdministerModal(item, patients, el, activity) {
  openModal({
    title: `Administer ${item.name}`,
    submitLabel: 'Continue',
    bodyHtml: `
      <label>Patient
        <select name="patient">${patients.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select>
      </label>
      <label>Quantity <input name="quantity" type="number" min="1" max="${item.qty}" value="1" required></label>
      <p class="muted">${item.qty} currently in stock at ${escapeHtml(item.unit)}.</p>`,
    onSubmit(form) {
      const quantity = Number(form.quantity.value);
      if (!quantity || quantity < 1 || quantity > item.qty) { alert('Enter a quantity between 1 and the available stock.'); return false; }
      const patient = patients.find(p => p.id === form.patient.value);
      if (item.prerequisite) runPrerequisiteCheck(item, patient, quantity, el, activity);
      else finalizeAdminister(item, patient, quantity, el, activity, { passed: true });
    },
  });
}

// Checks the typed answer against the item's prerequisite rule. A yes/no
// rule (e.g. "no active bleeding") expects reading === 'no' to pass;
// a numeric rule compares against its threshold with its operator.
function prerequisiteMet(prerequisite, reading) {
  if (prerequisite.field === 'activeBleeding') return reading === 'no';
  const num = Number(reading);
  if (Number.isNaN(num)) return false;
  if (prerequisite.op === '>=') return num >= prerequisite.value;
  if (prerequisite.op === '<=') return num <= prerequisite.value;
  if (prerequisite.op === '==') return num === prerequisite.value;
  return true;
}

function runPrerequisiteCheck(item, patient, quantity, el, activity) {
  const pre = item.prerequisite;
  const isYesNo = pre.field === 'activeBleeding';
  const chartValue = patient?.vitals?.[pre.field];
  openModal({
    title: 'Confirm before administering',
    submitLabel: 'Check answer',
    bodyHtml: `
      <p>${escapeHtml(pre.explain)}</p>
      ${isYesNo
        ? `<label>${escapeHtml(pre.question)}<select name="reading"><option value="no">No</option><option value="yes">Yes</option></select></label>`
        : `<label>${escapeHtml(pre.question)}<input name="reading" type="number" step="any" required></label>`}
      ${chartValue !== undefined ? `<p class="muted">Chart reference: ${escapeHtml(chartValue)}${pre.unit ? ' ' + pre.unit : ''}</p>` : ''}`,
    onSubmit(form) {
      const reading = form.reading.value;
      if (prerequisiteMet(pre, reading)) finalizeAdminister(item, patient, quantity, el, activity, { passed: true, reading });
      else offerEmergencyOverride(item, patient, quantity, el, activity, reading);
    },
  });
}

function offerEmergencyOverride(item, patient, quantity, el, activity, reading) {
  openModal({
    title: 'Prerequisite not met',
    submitLabel: 'Emergency override',
    bodyHtml: `
      <p>The recorded answer (<b>${escapeHtml(reading)}</b>) does not meet the safety check for ${escapeHtml(item.name)}.
         Administering anyway requires a documented reason.</p>
      <label>Reason for emergency override
        <textarea name="reason" rows="3" required placeholder="e.g. active cardiac event, attending physician present"></textarea>
      </label>`,
    onSubmit(form) {
      const reason = form.reason.value.trim();
      if (!reason) { alert('Enter a reason to proceed with an emergency override.'); return false; }
      finalizeAdminister(item, patient, quantity, el, activity, { passed: false, reading, overrideReason: reason });
    },
  });
}

// Shared ending for both the normal and the override path: decrements
// stock, writes the automatic patient note, logs the request, and updates
// the page in place (no full re-render needed).
function finalizeAdminister(item, patient, quantity, el, activity, outcome) {
  const updated = adjustInventoryQty(item.id, -quantity) ?? item;
  Object.assign(item, updated);   // keep this page's copy in sync for further requests in the same visit

  const actor = ROLES[session.role];
  const when = new Date().toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const summary = `${quantity} × ${item.name} administered to ${patient?.name ?? 'patient'}${outcome.passed ? '' : ' (emergency override)'}`;

  if (patient) {
    addPatientNote(patient.id, {
      author: actor.user, role: actor.label, date: when,
      text: outcome.passed
        ? `${summary}, confirmed by ${actor.user} (${actor.label}). Safety check passed.`
        : `${summary}, confirmed by ${actor.user} (${actor.label}). Safety check NOT met (recorded answer: ${outcome.reading}). Override reason: ${outcome.overrideReason}`,
    });
  }
  const record = addRequestLogEntry({
    type: 'administer', item: item.name, itemId: item.id, patientId: patient?.id, patientName: patient?.name,
    quantity, requestedBy: actor.user, status: outcome.passed ? 'completed' : 'completed (override)',
  });

  el.querySelector('#item-qty').textContent = updated.qty;
  const badge = el.querySelector('.item-detail .badge');
  if (badge) { badge.textContent = updated.status; badge.className = `badge ${updated.status}`; }
  logActivity(el, activity, { summary, status: record.status });
}
