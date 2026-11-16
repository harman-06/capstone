// "View account" and "Settings" pages, opened from the account menu in the top bar.
import { workspace } from '../workspace.js';
import { ROLES, session } from '../roles.js';
import { getPrefs, setPref } from '../prefs.js';
import { refreshTopbar, initials, roleText } from '../topbar.js';
import { toast } from '../toast.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signedInAt = new Date();   // when this page session started

// Plain-language names for the capabilities in roles.js.
const CAPABILITIES = {
  'appointments.view': 'View and book appointments',
  'patients.view': 'View patient records',
  'patients.viewSensitive': 'View sensitive patient details',
  'notes.add': 'Add patient notes',
  'inventory.view': 'View equipment and medicine inventory',
  'inventory.update': 'Update inventory',
  'requests.view': 'View equipment requests',
  'transfers.request': 'Request equipment from other units',
  'transfers.approve': 'Approve equipment transfers',
  'equipment.qc': 'Record equipment quality checks',
  'meds.prescribe': 'Prescribe medication',
  'profile.own': 'View and edit your own health profile',
  'users.manage': 'Monitor accounts',
};
const APPROVAL = { 'meds.administerControlled': 'Administer controlled medication (physician approval required)' };
const SCOPE = { all: 'All departments', unit: 'Your department', self: 'Your own records only', none: 'No patient records' };

export function account(el) {
  const role = ROLES[session.role];
  const kind = workspace.kind === 'patient' ? 'Patient' : workspace.kind === 'supplier' ? 'Supplier' : workspace.roles.includes('admin') ? 'Administrator' : 'Hospital staff';
  const abilities = [
    ...role.caps.filter(c => CAPABILITIES[c]).map(c => CAPABILITIES[c]),
    ...(role.approval ?? []).filter(c => APPROVAL[c]).map(c => APPROVAL[c]),
  ];
  const hidden = (role.masked ?? []).includes('patients.viewSensitive') ? ['Sensitive patient details are hidden for your role.'] : [];
  el.innerHTML = `<h1>Account</h1>
    <section class="card profile-card">
      <span class="avatar large" aria-hidden="true">${esc(initials(workspace.name))}</span>
      <div><h2>${esc(workspace.name)}</h2><p class="muted">${esc(roleText())}</p></div>
    </section>
    <section class="card"><h3>Details</h3>
      <dl class="item-facts">
        <div><dt>Name</dt><dd>${esc(workspace.name)}</dd></div>
        <div><dt>Account type</dt><dd>${esc(kind)}</dd></div>
        <div><dt>Role</dt><dd>${esc(role.label)}</dd></div>
        ${workspace.unit ? `<div><dt>Department</dt><dd>${esc(workspace.unit)}</dd></div>` : ''}
        <div><dt>Record access</dt><dd>${esc(SCOPE[role.scope] ?? '—')}</dd></div>
        <div><dt>Signed in since</dt><dd>${esc(signedInAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</dd></div>
      </dl>
    </section>
    <section class="card"><h3>What you can do</h3>
      ${abilities.length ? `<ul class="plain-list">${abilities.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : '<p class="muted">Your role has no additional permissions.</p>'}
      ${hidden.map(h => `<p class="muted">${esc(h)}</p>`).join('')}
    </section>
    ${workspace.kind === 'patient' ? '<p><a class="ops-link" href="#/my-health">Edit my health profile →</a></p>' : ''}`;
}

const OPTIONS = [
  ['reduceMotion', 'Reduce motion', 'Turn off page transitions and animations.'],
  ['compactTables', 'Compact tables', 'Use tighter spacing in tables and lists.'],
  ['startCollapsed', 'Start with the sidebar collapsed', 'Open each session with icons only.'],
  ['showBellCount', 'Show unread count on the bell', 'When off, the bell shows a dot instead of a number.'],
];

export function settings(el) {
  const prefs = getPrefs();
  el.innerHTML = `<h1>Settings</h1>
    <section class="card"><h3>Display</h3>
      ${OPTIONS.map(([key, label, hint]) => `<label class="setting"><input type="checkbox" data-pref="${key}" ${prefs[key] ? 'checked' : ''}><span><strong>${esc(label)}</strong><small>${esc(hint)}</small></span></label>`).join('')}
      <p class="muted">These settings are saved on this device only.</p>
    </section>`;
  el.querySelectorAll('[data-pref]').forEach(box => box.addEventListener('change', () => {
    setPref(box.dataset.pref, box.checked);
    refreshTopbar();
    toast('Settings saved.');
  }));
}
