// STEP 3: data layer. Pages never read JSON directly, only these getters.
// Later, swap fetch('data/x.json') for calls to the Azure API without touching pages.
import { ROLES, session, can } from './roles.js';
const db = {};
export async function loadData() {
  for (const f of ['patients','appointments','inventory','notifications'])
    db[f] = await (await fetch(`data/${f}.json`)).json();
}
function scoped(list) {
  const r = ROLES[session.role];
  if (r.scope === 'all')  return list;
  if (r.scope === 'self') return list.filter(x => (x.patientId ?? x.id) === r.patientId);
  if (r.scope === 'unit') return list.filter(x => x.unit === session.unit);
  return [];
}
export const getPatients = () => scoped(db.patients);
export const getPatient = id => getPatients().find(p => p.id === id);
export const getAppointments = patientId => scoped(db.appointments).filter(a => !patientId || a.patientId === patientId);
export const getInventory = () => db.inventory;                        // hospital-wide on purpose
export const getNotifications = () => db.notifications.filter(n => can(n.cap) === 'allow');
