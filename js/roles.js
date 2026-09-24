// STEP 2: roles and permissions. New role = one new entry below.
const CLINICAL = ['appointments.view','patients.view','inventory.view','inventory.update','requests.view'];
const STAFF_DASH = ['greeting','schedule','notifications','patients'];

export const ROLES = {
  doctor:      { label:'Doctor', user:'Dr. Smith', scope:'all', dashboard:STAFF_DASH,
                 caps:[...CLINICAL,'patients.viewSensitive','meds.prescribe','transfers.request','transfers.approve'] },
  chargeNurse: { label:'Charge nurse', user:'Nadia Ali', scope:'unit', dashboard:STAFF_DASH,
                 caps:[...CLINICAL,'transfers.request','transfers.approve'],
                 approval:['meds.administerControlled'], masked:['patients.viewSensitive'] },
  nurse:       { label:'Nurse', user:'Eli Brown', scope:'unit', dashboard:STAFF_DASH,
                 caps:[...CLINICAL,'transfers.request'],
                 approval:['meds.administerControlled'], masked:['patients.viewSensitive'] },
  admin:       { label:'IT admin', user:'Sam Lee', scope:'none', dashboard:['greeting','notifications'],
                 caps:['inventory.view','users.manage'] },
  patient:     { label:'Patient', user:'Ron Simpson', scope:'self', patientId:'p1',
                 dashboard:['greeting','schedule','notifications','myHealth'],
                 caps:['appointments.view','profile.own','patients.viewSensitive'] },
};
// scope: all | unit | self | none  (resident, student, aide: add entries the same way)

export const session = { role:'doctor', unit:'Cardiology' };

// Returns 'allow' | 'approval' | 'mask' | 'deny'
export function can(cap) {
  const r = ROLES[session.role];
  if (r.caps.includes(cap)) return 'allow';
  if (r.approval?.includes(cap)) return 'approval';
  if (r.masked?.includes(cap)) return 'mask';
  return 'deny';
}

export function requestApproval(cap) {
  alert(`"${cap}" needs a doctor's approval. (Stub: the authorization popup goes here.)`);
}

// Runs on every rendered page. Elements declare what they need: <button data-cap="transfers.request">
export function applyPermissions(root = document) {
  root.querySelectorAll('[data-cap]').forEach(el => {
    const result = can(el.dataset.cap);
    if (result === 'deny') {
      if (el.dataset.fallback === 'text') {          // links become plain text
        const s = document.createElement('span');
        s.className = el.className; s.textContent = el.textContent; el.replaceWith(s);
      } else el.remove();
    } else if (result === 'approval') {
      el.classList.add('locked');
      el.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); requestApproval(el.dataset.cap); }, true);
    } else if (result === 'mask') {
      el.classList.add('masked'); el.textContent = '••••••';
    }
  });
}
