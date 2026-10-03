import { ROLES, session, can } from './roles.js';
import { isConfigured, fetchInventory, fetchUnits } from './api.js';
const db = {};
let source = 'Loading';
export const getDataSource = () => source;
async function json(name) {
  const response = await fetch(`data/${name}.json`);
  if (!response.ok) throw new Error(`Could not load ${name} demo data`);
  return response.json();
}
export async function loadData() {
  [db.patients, db.appointments, db.notifications] = await Promise.all([
    json('patients'), json('appointments'), json('notifications')
  ]);
  await reloadEquipment();
}
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
