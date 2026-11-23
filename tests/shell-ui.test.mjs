import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = { NEXORA_CONFIG: { supabaseUrl: 'https://demo.supabase.co', supabasePublishableKey: 'sb_publishable_test' } };
let workspaceReply = { kind: 'staff', name: 'Eli Brown', unit: 'Cardiology', roles: ['nurse'] };
globalThis.fetch = async url => {
  const u = String(url);
  if (u.startsWith('data/')) return { ok: true, json: async () => JSON.parse(await readFile(new URL(`../${u}`, import.meta.url), 'utf8')) };
  if (u.includes('/auth/v1/token')) return { ok: true, json: async () => ({ access_token: 'test', refresh_token: 'test', expires_in: 3600 }) };
  if (u.includes('nh_api_workspace')) return { ok: true, json: async () => workspaceReply };
  return { ok: true, json: async () => [] };
};

const { timeGreeting, displayName, greeting } = await import('../js/greeting.js');
const { session } = await import('../js/roles.js');
const data = await import('../js/data.js');
const { getBellItems, markAllSeen, unreadCount } = await import('../js/notifications.js');
const api = await import('../js/api.js');
const ws = await import('../js/workspace.js');
await data.loadData();

test('greeting follows the time of day and the account name', () => {
  assert.equal(timeGreeting(new Date(2026, 0, 1, 9)), 'Good morning');
  assert.equal(timeGreeting(new Date(2026, 0, 1, 13)), 'Good afternoon');
  assert.equal(timeGreeting(new Date(2026, 0, 1, 20)), 'Good evening');
  assert.equal(displayName('Dr. Smith'), 'Dr. Smith');
  assert.equal(displayName('Eli Brown'), 'Eli');
  assert.equal(displayName('', 'Nurse'), 'Nurse');
  assert.equal(greeting('Eli Brown', 'Nurse', new Date(2026, 0, 1, 8)), 'Good morning, Eli');
});

test('profile validation rejects bad values and parses allergies', () => {
  const bad = data.validateProfile({ phone: 'abc', email: 'not-an-email', heightCm: '900', weightKg: '1' });
  assert.equal(bad.ok, false);
  for (const key of ['phone', 'email', 'heightCm', 'weightKg']) assert.ok(bad.errors[key], key);
  const good = data.validateProfile({ phone: '(403) 555-0100', email: 'a@b.co', heightCm: '170', weightKg: '70', allergies: ' Penicillin, Latex ,, ' });
  assert.equal(good.ok, true);
  assert.deepEqual(good.value.allergies, ['Penicillin', 'Latex']);
});

test('only the patient can edit their own profile, and other accounts see the change', () => {
  const form = { phone: '(403) 555-0100', email: 'new@example.test', address: '1 Test St', heightCm: '176', weightKg: '80', allergies: 'Penicillin, Latex', emergencyName: 'Sam', emergencyPhone: '(403) 555-0101', emergencyRelationship: 'Spouse' };
  Object.assign(session, { role: 'nurse', unit: 'Cardiology', patientId: null });
  assert.equal(data.updatePatientProfile('p1', form).ok, false, 'staff cannot use the patient edit');
  Object.assign(session, { role: 'patient', patientId: 'p1' });
  assert.equal(data.updatePatientProfile('p2', form).ok, false, 'a patient cannot edit someone else');
  assert.equal(data.updatePatientProfile('p1', { ...form, email: 'bad' }).ok, false);
  assert.equal(data.updatePatientProfile('p1', form).ok, true);

  Object.assign(session, { role: 'doctor', patientId: null });
  const seen = data.getPatient('p1');
  assert.equal(seen.contact.phone, '(403) 555-0100');
  assert.deepEqual(seen.allergies, ['Penicillin', 'Latex']);
  assert.equal(seen.profileUpdatedBy, 'patient');
  assert.ok(getBellItems().some(i => /updated their profile/.test(i.text)), 'staff are notified');
  Object.assign(session, { role: 'patient', patientId: 'p2' });
  assert.deepEqual(data.getPatients().map(p => p.id), ['p2'], 'a patient only ever sees their own record');
});

test('notifications are shown only to the right audience and clear when read', () => {
  data.addEvent({ audience: 'approvers', severity: 'warn', text: 'Approval requested: test action' });
  const has = role => { Object.assign(session, { role, unit: 'Cardiology', patientId: 'p1' }); return getBellItems().some(i => /Approval requested: test action/.test(i.text)); };
  assert.equal(has('nurse'), false);
  assert.equal(has('patient'), false);
  assert.equal(has('chargeNurse'), true);
  assert.equal(has('doctor'), true);
  assert.ok(unreadCount() > 0);
  markAllSeen();
  assert.equal(unreadCount(), 0);
});

test('navigation matches the account type and keeps icon-only labels', async () => {
  const sidebar = { innerHTML: '' };
  let tabbar;
  globalThis.document = { getElementById: id => id === 'sidebar' ? sidebar : null, createElement: () => ({ setAttribute() {}, addEventListener() {}, innerHTML: '' }), body: { appendChild(el) { tabbar = el; } } };
  const { renderNav } = await import('../js/nav.js');
  await api.signIn('user@example.test', 'test-only');

  workspaceReply = { kind: 'patient', name: 'Rohan Khan', patientId: 'p1' };
  await ws.loadWorkspace();
  assert.equal(session.role, 'patient');
  assert.equal(session.patientId, 'p1');
  assert.deepEqual(ws.workspace.roles, []);
  renderNav('/my-health');
  assert.ok(sidebar.innerHTML.includes('My Visit'));
  for (const label of ['Dashboard', 'Appointments', 'Inventory', 'Patients', 'Supply enquiries']) assert.ok(!sidebar.innerHTML.includes(label), `patient must not see ${label}`);
  assert.match(sidebar.innerHTML, /class="nav-label"/);
  assert.match(sidebar.innerHTML, /title="My Visit"/);

  workspaceReply = { kind: 'staff', name: 'Eli Brown', unit: 'Cardiology', roles: ['nurse'] };
  await ws.loadWorkspace();
  assert.equal(session.role, 'nurse');
  renderNav('/patients');
  for (const label of ['Dashboard', 'Appointments', 'Patients', 'Inventory', 'Requests', 'Supply enquiries']) assert.ok(sidebar.innerHTML.includes(label), label);
  assert.ok(!sidebar.innerHTML.includes('My Health'));
  assert.ok(tabbar.innerHTML.includes('More'));
});
