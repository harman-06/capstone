// SPRINT 3 (Mohammed Mirza): inventory intelligence + care readiness (M03/M04).
// NEW FILE: js/readiness.js
//
// Pure logic, no imports, so it cannot clash with other people's files.
// "Availability" is no longer just quantity. For each inventory row:
//
//   onHand      = qty recorded at the unit (includes everything below)
//   inUse       = being used right now
//   reserved    = held for an approved / allocated request
//   maintenance = out of service
//   inTransit   = leaving this unit, still counted in qty until Complete
//   available   = onHand - inUse - reserved - maintenance - inTransit
//   reserveLevel= units the unit must keep for its own patients
//   transferable= available - reserveLevel   ("safely transferable")
//
// Every field except qty is optional (live Supabase rows may not have them
// yet); missing values count as 0, so old rows behave as before.

export const QC_HOURS = 24;                       // same rule as QC_WINDOW_HOURS in data.js
export const CRITICAL_EQUIPMENT = ['Defibrillator', 'Ventilator', 'Patient Monitor', 'Infusion Pump'];

const n = v => Math.max(0, Math.floor(Number(v) || 0));

// Reserve to keep when a row has no reserveThreshold of its own.
export const defaultReserve = row => (row.qcRequired ? 0 : row.type === 'medicine' ? 10 : 1);

function explainOut({ onHand, inUse, reserved, maintenance, inTransit, qcHold }) {
  if (qcHold) return 'Quality check overdue';
  if (onHand === 0) return 'None on hand';
  const [label, count] = [['in use', inUse], ['reserved', reserved], ['in maintenance', maintenance], ['in transit', inTransit]]
    .sort((a, b) => b[1] - a[1])[0];
  return count >= onHand ? `All ${label}` : `All committed (mostly ${label})`;
}

// The full picture for one inventory row.
export function stockBreakdown(row, now = Date.now()) {
  const onHand = n(row.qty);
  const inUse = n(row.inUse), reserved = n(row.reserved), maintenance = n(row.maintenance), inTransit = n(row.inTransit);
  const reserveLevel = n(row.reserveThreshold ?? defaultReserve(row));
  // A blood glucose monitor past its 24 h quality check is not safe to use or hand over.
  const qcHold = Boolean(row.qcRequired) && !(row.lastQualityCheck && now - row.lastQualityCheck < QC_HOURS * 3600000);
  const free = Math.max(0, onHand - inUse - reserved - maintenance - inTransit);
  const available = qcHold ? 0 : free;
  const transferable = Math.max(0, available - reserveLevel);
  const base = { onHand, inUse, reserved, maintenance, inTransit, qcHold, available, reserveLevel, transferable };
  if (available === 0) return { ...base, status: 'out', reason: explainOut(base) };
  if (available <= reserveLevel) return { ...base, status: 'low', reason: `At reserve level (${reserveLevel})` };
  return { ...base, status: 'available', reason: '' };
}

// What a transfer would do, with exact before/after numbers for both units.
// Blocks moving more than is available; blocks dipping into the source unit's
// reserve unless { allowReserve: true } (the UI can ask the clerk to confirm).
export function transferPreview(source, destination, quantity, { allowReserve = false } = {}) {
  const q = Math.floor(Number(quantity));
  if (!(q >= 1)) return { ok: false, reason: 'Enter a quantity of 1 or more.' };
  const s = stockBreakdown(source), d = stockBreakdown(destination);
  if (q > s.available) return { ok: false, reason: `Only ${s.available} available in ${source.unit} right now (${s.onHand} on hand).` };
  const dipsIntoReserve = q > s.transferable;
  if (dipsIntoReserve && !allowReserve) {
    return { ok: false, needsReserveOverride: true,
      reason: `${source.unit} can safely share ${s.transferable}; moving ${q} would take it below its reserve of ${s.reserveLevel}.` };
  }
  const s2 = stockBreakdown({ ...source, qty: n(source.qty) - q });
  const d2 = stockBreakdown({ ...destination, qty: n(destination.qty) + q });
  const snap = b => ({ onHand: b.onHand, available: b.available, status: b.status });
  return { ok: true, quantity: q, dipsIntoReserve,
    source: { unit: source.unit, before: snap(s), after: snap(s2) },
    destination: { unit: destination.unit, before: snap(d), after: snap(d2) } };
}

export const LEVEL_LABEL = { ready: 'Ready', 'at-risk': 'At risk', 'not-ready': 'Not ready', 'no-data': 'No data' };
export const LEVEL_BADGE = { ready: 'available', 'at-risk': 'low', 'not-ready': 'out', 'no-data': 'low' };

// Care readiness of one unit, judged on its critical equipment.
//   not-ready: a critical item has nothing available
//   at-risk:   a critical item is at or below its reserve level
//   ready:     every critical item is above its reserve level
export function unitReadiness(rows, unit) {
  const items = rows
    .filter(r => r.unit === unit && CRITICAL_EQUIPMENT.includes(r.name))
    .map(r => ({ row: r, ...stockBreakdown(r) }));
  const issues = items.filter(i => i.status !== 'available').map(i => `${i.row.name}: ${i.reason}`);
  const level = !items.length ? 'no-data'
    : items.some(i => i.status === 'out') ? 'not-ready'
    : items.some(i => i.status === 'low') ? 'at-risk' : 'ready';
  return { unit, level, issues, items };
}

// ---------------------------------------------------------------------------
// Realistic demo stock, keyed "Unit|Item name". Overlaid onto the loaded rows.
// In demo mode (no database) it also sets qty. With the live database it keeps
// the real qty and only fits the breakdown inside it.
// ---------------------------------------------------------------------------
const DEMO_STOCK = {
  'Cardiology|Defibrillator':      { qty: 3,  inUse: 1, reserved: 0, maintenance: 0, inTransit: 0, reserveThreshold: 1 },
  'Cardiology|Infusion Pump':      { qty: 12, inUse: 7, reserved: 1, maintenance: 1, inTransit: 0, reserveThreshold: 3 },
  'Cardiology|Patient Monitor':    { qty: 8,  inUse: 5, reserved: 0, maintenance: 1, inTransit: 0, reserveThreshold: 2 },
  'Cardiology|Portable Ultrasound':{ qty: 1,  inUse: 0, reserved: 0, maintenance: 1, inTransit: 0, reserveThreshold: 1 },
  'Cardiology|Ventilator':         { qty: 2,  inUse: 2, reserved: 0, maintenance: 0, inTransit: 0, reserveThreshold: 1 },
  'Cardiology|Wheelchair':         { qty: 10, inUse: 4, reserved: 0, maintenance: 0, inTransit: 0, reserveThreshold: 2 },
  'Cardiology|Stretcher':          { qty: 4,  inUse: 1, reserved: 0, maintenance: 0, inTransit: 0, reserveThreshold: 1 },

  'Emergency|Defibrillator':       { qty: 6,  inUse: 1, reserved: 1, maintenance: 0, inTransit: 1, reserveThreshold: 2 },
  'Emergency|Infusion Pump':       { qty: 10, inUse: 3, reserved: 2, maintenance: 0, inTransit: 0, reserveThreshold: 3 },
  'Emergency|Patient Monitor':     { qty: 9,  inUse: 6, reserved: 0, maintenance: 1, inTransit: 0, reserveThreshold: 3 },
  'Emergency|Portable Ultrasound': { qty: 3,  inUse: 1, reserved: 0, maintenance: 0, inTransit: 0, reserveThreshold: 1 },
  'Emergency|Ventilator':          { qty: 5,  inUse: 2, reserved: 1, maintenance: 1, inTransit: 0, reserveThreshold: 1 },
  'Emergency|Wheelchair':          { qty: 14, inUse: 5, reserved: 0, maintenance: 0, inTransit: 0, reserveThreshold: 3 },
  'Emergency|Stretcher':           { qty: 8,  inUse: 3, reserved: 0, maintenance: 0, inTransit: 0, reserveThreshold: 2 },

  'Oncology|Defibrillator':        { qty: 3,  inUse: 0, reserved: 0, maintenance: 0, inTransit: 1, reserveThreshold: 1 },
  'Oncology|Infusion Pump':        { qty: 18, inUse: 9, reserved: 2, maintenance: 1, inTransit: 0, reserveThreshold: 4 },
  'Oncology|Patient Monitor':      { qty: 7,  inUse: 3, reserved: 1, maintenance: 0, inTransit: 0, reserveThreshold: 2 },
  'Oncology|Portable Ultrasound':  { qty: 2,  inUse: 2, reserved: 0, maintenance: 0, inTransit: 0, reserveThreshold: 1 },
  'Oncology|Ventilator':           { qty: 2,  inUse: 0, reserved: 0, maintenance: 0, inTransit: 0, reserveThreshold: 1 },
  'Oncology|Wheelchair':           { qty: 8,  inUse: 3, reserved: 0, maintenance: 0, inTransit: 0, reserveThreshold: 2 },
  'Oncology|Stretcher':            { qty: 2,  inUse: 0, reserved: 0, maintenance: 1, inTransit: 0, reserveThreshold: 1 },
};

// Returns the rows with the demo breakdown applied and a status that reflects
// availability (not just quantity). Rows with no demo entry are left alone.
export function applyReadinessDemo(rows, { overrideQty = false } = {}) {
  return rows.map(row => {
    const demo = DEMO_STOCK[`${row.unit}|${row.name}`];
    if (!demo) return row;
    const { qty, ...rest } = demo;
    const merged = { ...row, ...rest };
    if (overrideQty) merged.qty = qty;
    else {
      let room = n(row.qty);                       // fit the breakdown inside the real qty
      for (const key of ['inTransit', 'maintenance', 'reserved', 'inUse']) {
        merged[key] = Math.min(n(rest[key]), room);
        room -= merged[key];
      }
    }
    merged.status = stockBreakdown(merged).status;
    return merged;
  });
}
