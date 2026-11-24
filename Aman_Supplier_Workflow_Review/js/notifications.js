// Builds the list shown in the bell menu. Nothing here is stored: stock alerts and
// reminders are derived from current data, and activity comes from the event log in data.js.
import { ROLES, session, can } from './roles.js';
import { getInventory, getAppointments, getPatients, getEvents, myUnit } from './data.js';

const seen = new Set();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Who an event is for: approvers (can approve transfers), staff (can view patients),
// or one specific patient.
function visible(event) {
  const role = ROLES[session.role];
  const ownId = session.patientId ?? role.patientId;
  if (event.audience === 'approvers') return can('transfers.approve') === 'allow';
  if (event.audience === 'staff') return role.scope !== 'self' && can('patients.view') === 'allow';
  if (event.audience?.startsWith('patient:')) return role.scope === 'self' && event.audience === `patient:${ownId}`;
  return false;
}

export function getBellItems() {
  const role = ROLES[session.role];
  const items = getEvents().filter(visible).slice(0, 10).map(e => ({
    id: e.id, severity: e.severity, text: e.text, detail: e.detail, target: e.target ?? '#/dashboard',
  }));

  if (can('inventory.view') === 'allow') {
    const inventory = getInventory() ?? [];
    const where = role.scope === 'all' ? 'across the hospital' : `in ${myUnit()}`;
    for (const [type, one, many] of [['equipment', 'equipment item', 'equipment items'], ['medicine', 'medicine', 'medicines']]) {
      const rows = inventory.filter(i => i.type === type && (role.scope === 'all' || i.unit === myUnit()));
      const out = rows.filter(i => i.status === 'out').length;
      const low = rows.filter(i => i.status === 'low').length;
      if (out) items.push({ id: `stock-out-${type}-${out}-${where}`, severity: 'bad', text: `${plural(out, one, many)} out of stock ${where}`, target: `#/inventory?tab=${type}` });
      if (low) items.push({ id: `stock-low-${type}-${low}-${where}`, severity: 'warn', text: `${plural(low, one, many)} running low ${where}`, target: `#/inventory?tab=${type}` });
    }
  }

  if (role.scope === 'self') {
    const next = getAppointments()[0];
    if (next) items.push({ id: `appt-${next.id}`, severity: 'info', text: `Upcoming appointment: ${next.type}`, detail: next.when, target: '#/appointments' });
    for (const m of (getPatients()[0]?.medicationSchedule ?? []).slice(0, 3)) {
      items.push({ id: `med-${m.med}-${m.time}`, severity: 'info', text: `Medication due at ${m.time}: ${m.med}`, detail: m.route, target: '#/my-health' });
    }
  } else if (can('appointments.view') === 'allow') {
    const today = getAppointments().filter(a => a.today).length;
    if (today) items.push({ id: `today-${today}`, severity: 'info', text: `${plural(today, 'appointment')} scheduled today`, target: '#/appointments' });
  }

  return items.map(i => ({ ...i, unread: !seen.has(i.id) }));
}

export const unreadCount = () => getBellItems().filter(i => i.unread).length;
export const markAllSeen = () => getBellItems().forEach(i => seen.add(i.id));
