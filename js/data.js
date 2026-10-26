// Data access layer
// Loads the four JSON files once at startup, 
// “gets” functions like patient lists, appointments, unit, inventory and notifications, 
// and automatically filters results by the current role's scope.
// Pages never read JSON or Supabase directly.
// They only call the getters below.
// So the data source can easily change without touching any page.
import { ROLES, session, can } from './roles.js';
import { isConfigured, fetchInventory, fetchUnits } from './api.js';
const db = {};
let source = 'Loading'; // human-readable string shown in the sign-in status area
export const getDataSource = () => source;
// Loads one of the static demo JSON files from /data
async function json(name) {
  const response = await fetch(`data/${name}.json`);
  if (!response.ok) throw new Error(`Could not load ${name} demo data`);
  return response.json();
}
// Called once on app start (main.js). 
// Patients/appointments/notifications are always the static demo JSON. 
// Euipment inventory is handled separately below.
export async function loadData() {
  [db.patients, db.appointments, db.notifications] = await Promise.all([
    json('patients'), json('appointments'), json('notifications')
  ]);
  await reloadEquipment();
}
// Loads equipment inventory + units. Falls back to demo JSON if Supabase
// isn't configured (config.js empty) or the live fetch fails; otherwise
// merges live equipment rows with the still-synthetic medicine rows.
export async function reloadEquipment() {
  const demoInventory = await json('inventory');
  if (!isConfigured()) {
    db.inventory = demoInventory;
    db.units = await json('units');
    addSprint2Equipment();
    source = 'Demo JSON — database not configured';
    return;
  }
  // Medicine remains synthetic JSON and is not part of this equipment database.
  db.inventory = demoInventory.filter(i => i.type !== 'equipment');
  db.units = [];
  try {
    const [inventory, units] = await Promise.all([fetchInventory(), fetchUnits()]);
    if (!units.length) throw new Error('No units returned. Your account may not be provisioned, or demo data is missing.');
    db.inventory = [...inventory, ...db.inventory];
    db.units = units;
    addSprint2Equipment();
    source = 'Live Supabase equipment · medicine/patients remain demo data';
  } catch (error) {
    source = `Database equipment unavailable: ${error.message}`;
  }
}
// Filters a list down to what the current role's scope allows (all/unit/self/none — see roles.js).
function scoped(list) {
  const r = ROLES[session.role];
  if (r.scope === 'all') return list;
  if (r.scope === 'self') return list.filter(x => (x.patientId ?? x.id) === r.patientId);
  if (r.scope === 'unit') return list.filter(x => x.unit === session.unit);
  return [];
}
export const getPatients = () => scoped(db.patients);
export const getPatient = id => getPatients().find(p => p.id === id);
export const getAppointments = patientId => scoped(db.appointments).filter(a => !patientId || a.patientId === patientId);
export const getNotifications = () => db.notifications.filter(n => can(n.cap) === 'allow');
export const getUnits = () => db.units;

// ============================================================================
// ADDED BY HARMAN — everything below is new, nothing above this line changed.
// Supports: the Inventory item detail page, the patient profile expansion,
// appointment booking, and the Requests page.
//
// Everything here is IN-MEMORY ONLY for this demo (no Supabase write path
// exists yet for stock deduction, patient notes, appointments, or requests —
// that's the authorization/database teammate's next piece). State resets on
// reload. Once a real write workflow exists, these are the functions to
// point at it instead of mutating `db` directly.
// ============================================================================

// NOTE: getInventory() itself is intentionally left exactly as it was
// (db.inventory, no wrapping) — a teammate's test in tests/frontend.test.mjs
// asserts its exact output shape in the "live fetch failed" fallback case,
// and changing that shape would break it. The item detail page only needs
// defaults for a SINGLE looked-up item, so that's where defaulting happens
// instead (below), leaving the shared getInventory() contract untouched.
export const getInventory = () => db.inventory;

// Looks up one item and fills safe defaults for fields live Supabase
// equipment rows (via api.js) don't carry yet — description, requiresApproval,
// prerequisite, unitNo. Demo JSON items (including all medicine, which never
// comes from Supabase per reloadEquipment() above) already have these fields
// set directly in data/inventory.json, so defaults only matter for the live case.
export function getInventoryItem(id) {
  const item = db.inventory.find(i => i.id === id);
  if (!item) return undefined;
  return {
    description: 'No description recorded yet.',
    requiresApproval: false,
    prerequisite: null,
    unitNo: db.units.find(u => u.name === item.unit)?.number ?? '',
    lowThreshold: item.type === 'equipment' ? 5 : 20,
    ...item,   // real values (when present) win over the defaults above
  };
}

// Recalculates available/low/out from an item's current quantity vs. its lowThreshold.
function deriveStatus(item) {
  if (item.qty <= 0) return 'out';
  if (item.qty <= (item.lowThreshold ?? 5)) return 'low';
  return 'available';
}

// Adjusts an item's recorded quantity (e.g. -2 after administering 2 units)
// and recalculates its status. Mutates the real db.inventory record (not a
// withDefaults() copy), so the change is visible to every later getInventory() call.
export function adjustInventoryQty(id, delta) {
  const item = db.inventory.find(i => i.id === id);
  if (!item) return null;
  item.qty = Math.max(0, item.qty + delta);
  item.status = deriveStatus(item);
  return item;
}

// Adds one note to a patient's chart (newest first). Used both for manual
// notes typed on the Patient Profile page and for the automatic entry the
// administer flow records (see pages/inventory-item.js).
export function addPatientNote(patientId, note) {
  const p = db.patients.find(x => x.id === patientId);
  if (!p) return null;
  p.notes = p.notes ?? [];
  p.notes.unshift(note);
  return note;
}

// Adds a new appointment (from "Book a new appointment" on either the
// Patient Profile or Appointments page).
export function addAppointment(entry) {
  const appt = { id: `a-new-${db.appointments.length + 1}`, today: false, ...entry };
  db.appointments.unshift(appt);
  return appt;
}

// Request log: tracks both cross-unit transfer requests (from the Inventory
// list's "Request" button) and medication-administer requests (from the new
// item detail page), so the Requests page has one real list to show instead
// of being a placeholder.
const requestLog = [];
export function addRequestLogEntry(entry) {
  const record = {
    id: `REQ-${String(requestLog.length + 1).padStart(3, '0')}`,
    createdAt: new Date(),
    status: 'pending',
    ...entry,
  };
  requestLog.unshift(record);
  return record;
}
export const getRequestLog = () => requestLog;
export function updateRequestStatus(id, status) {
  const r = requestLog.find(r => r.id === id);
  if (r) r.status = status;
  return r;
}

// ============================================================================
// SPRINT 2 — unit clerk accept / reject of equipment transfer requests.
// Still IN-MEMORY ONLY. These checks run in the browser, so they demonstrate
// the workflow but do not secure it; real enforcement needs the Supabase
// access rules (database teammate).
// ============================================================================

// The unit the current user works in. A role can carry its own `unit`
// (e.g. the Unit clerk in roles.js); otherwise fall back to the session unit.
export const myUnit = () => ROLES[session.role].unit ?? session.unit;

// Can the current user accept/reject this request right now?
// Rules: it is a pending transfer, the user has transfers.approve, the request
// names the user's own unit as the source, and the user did not raise it.
// (To let doctors accept for any unit, add: || ROLES[session.role].scope === 'all')
export function canDecideTransfer(request) {
  if (!request || request.type !== 'transfer' || request.status !== 'pending') return false;
  if (can('transfers.approve') !== 'allow') return false;
  if (request.sourceUnit !== myUnit()) return false;
  if (request.requestedBy === ROLES[session.role].user) return false;
  return true;
}

// Accept: moves stock from the source unit's item to the requesting unit's
// item, then marks the request approved. Returns { ok, reason?, request? }.
export function acceptTransfer(id) {
  const r = requestLog.find(x => x.id === id);
  if (!r) return { ok: false, reason: 'Request not found.' };
  if (!canDecideTransfer(r)) return { ok: false, reason: 'You cannot accept this request.' };
  const from = db.inventory.find(i => i.id === r.sourceItemId);
  // Item-page requests: itemId is the row that receives the stock.
  // List-button requests: itemId equals sourceItemId, so the receiving row is
  // the same item in the requesting unit (matched by name).
  const to = r.itemId !== r.sourceItemId
    ? db.inventory.find(i => i.id === r.itemId)
    : db.inventory.find(i => i.type === from?.type && i.name === r.item && i.unit === r.requestingUnit);
  if (!from || !to) return { ok: false, reason: 'Could not find the items for this request.' };
  if (from.qty < r.quantity) return { ok: false, reason: `Only ${from.qty} left in ${from.unit}.` };
  adjustInventoryQty(from.id, -r.quantity);
  adjustInventoryQty(to.id, r.quantity);
  r.decidedBy = ROLES[session.role].user;
  r.decidedAt = new Date();
  updateRequestStatus(id, 'approved');
  return { ok: true, request: r };
}

// Reject: no stock moves, the request is marked rejected.
export function rejectTransfer(id) {
  const r = requestLog.find(x => x.id === id);
  if (!r) return { ok: false, reason: 'Request not found.' };
  if (!canDecideTransfer(r)) return { ok: false, reason: 'You cannot reject this request.' };
  r.decidedBy = ROLES[session.role].user;
  r.decidedAt = new Date();
  updateRequestStatus(id, 'rejected');
  return { ok: true, request: r };
}

// ============================================================================
// SPRINT 2 — extra equipment (Stretcher, BGM) and BGM quality-check tracking.
// These rows live in code for the demo (not in Supabase). They are added after
// the normal equipment load, but NOT in the "live fetch failed" fallback, so
// that fallback keeps its exact shape for tests/frontend.test.mjs.
// Wheelchairs already exist in the equipment list, so they are not added here.
// ============================================================================

// Every BGM must pass a quality check at least this often.
export const QC_WINDOW_HOURS = 24;

// checkedHoursAgo is turned into a real timestamp when loaded, so the demo
// always shows a mix of checked / overdue / never checked. null = never.
const EXTRA_EQUIPMENT = [
  { id: 'x-stretcher-card', name: 'Stretcher', type: 'equipment', unit: 'Cardiology', qty: 2, status: 'available', description: 'Patient transport stretcher.' },
  { id: 'x-stretcher-emer', name: 'Stretcher', type: 'equipment', unit: 'Emergency', qty: 6, status: 'available', description: 'Patient transport stretcher.' },
  { id: 'x-stretcher-onco', name: 'Stretcher', type: 'equipment', unit: 'Oncology', qty: 0, status: 'out', description: 'Patient transport stretcher.' },

  { id: 'x-bgm-c01', name: 'Blood Glucose Monitor (BGM-C01)', type: 'equipment', unit: 'Cardiology', qty: 1, status: 'available', qcRequired: true, checkedHoursAgo: 3,  description: 'Blood glucose meter. Quality check required every 24 hours.' },
  { id: 'x-bgm-c02', name: 'Blood Glucose Monitor (BGM-C02)', type: 'equipment', unit: 'Cardiology', qty: 1, status: 'available', qcRequired: true, checkedHoursAgo: 30, description: 'Blood glucose meter. Quality check required every 24 hours.' },
  { id: 'x-bgm-e01', name: 'Blood Glucose Monitor (BGM-E01)', type: 'equipment', unit: 'Emergency',  qty: 1, status: 'available', qcRequired: true, checkedHoursAgo: 12, description: 'Blood glucose meter. Quality check required every 24 hours.' },
  { id: 'x-bgm-e02', name: 'Blood Glucose Monitor (BGM-E02)', type: 'equipment', unit: 'Emergency',  qty: 1, status: 'available', qcRequired: true, checkedHoursAgo: 26, description: 'Blood glucose meter. Quality check required every 24 hours.' },
  { id: 'x-bgm-e03', name: 'Blood Glucose Monitor (BGM-E03)', type: 'equipment', unit: 'Emergency',  qty: 1, status: 'available', qcRequired: true, checkedHoursAgo: null, description: 'Blood glucose meter. Quality check required every 24 hours.' },
  { id: 'x-bgm-o01', name: 'Blood Glucose Monitor (BGM-O01)', type: 'equipment', unit: 'Oncology',   qty: 1, status: 'available', qcRequired: true, checkedHoursAgo: 5,  description: 'Blood glucose meter. Quality check required every 24 hours.' },
];

// Appends the extra rows to the inventory (skips any id that already exists).
function addSprint2Equipment() {
  const now = Date.now();
  const rows = EXTRA_EQUIPMENT
    .filter(extra => !db.inventory.some(i => i.id === extra.id))
    .map(({ checkedHoursAgo, ...row }) => ({
      ...row,
      ...(row.qcRequired ? { lastQualityCheck: checkedHoursAgo == null ? null : now - checkedHoursAgo * 3600000 } : {}),
    }));
  db.inventory = [...db.inventory, ...rows];
}

// All items that need quality checks (the BGMs).
export const getQcItems = () => db.inventory.filter(i => i.qcRequired);

const hoursAgoText = h => (h < 1 ? 'under 1 h ago' : `${Math.floor(h)} h ago`);

// { ok, label }: ok is true when the last check was inside the 24-hour window.
export function qualityCheckState(item) {
  if (!item.lastQualityCheck) return { ok: false, label: 'Never checked' };
  const hours = (Date.now() - item.lastQualityCheck) / 3600000;
  return hours < QC_WINDOW_HOURS
    ? { ok: true, label: `Checked ${hoursAgoText(hours)}` }
    : { ok: false, label: `Overdue (checked ${hoursAgoText(hours)})` };
}

// Records a quality check right now, by the signed-in user. Needs equipment.qc.
export function recordQualityCheck(id) {
  if (can('equipment.qc') !== 'allow') return null;
  const item = db.inventory.find(i => i.id === id && i.qcRequired);
  if (!item) return null;
  item.lastQualityCheck = Date.now();
  item.qcBy = ROLES[session.role].user;
  return item;
}
