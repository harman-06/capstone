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
export const getInventory = () => db.inventory;
export const getNotifications = () => db.notifications.filter(n => can(n.cap) === 'allow');
export const getUnits = () => db.units;
