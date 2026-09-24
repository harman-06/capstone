// STEP 4: dashboard widgets. Each returns an HTML string. Add one, then list it in a role's `dashboard`.
import { ROLES, session } from './roles.js';
import { getAppointments, getNotifications, getPatients } from './data.js';

const card = (title, body, href, link) =>
  `<section class="card"><h3>${title}</h3>${body}${href ? `<a class="more" href="${href}">${link}</a>` : ''}</section>`;
const expandable = (title, body) =>
  `<section class="card expandable"><button class="expand-toggle" aria-expanded="false">${title}<span class="chev">▾</span></button>
   <div class="expand-body"><div>${body}</div></div></section>`;

export const widgets = {
  greeting() {
    const h = new Date().getHours();
    const hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const now = new Date().toLocaleString('en-CA', { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
    return `<h1>${hello}, ${ROLES[session.role].user}</h1><p class="muted">${now}</p>`;
  },
  schedule() {
    const isPatient = session.role === 'patient';
    const rows = getAppointments().filter(a => isPatient || a.today).slice(0, 4)
      .map(a => `<a class="row" href="#/appointments"><b>${a.when}</b><span>${isPatient ? a.type : a.patientName + ' · ' + a.type}</span></a>`).join('');
    return card(isPatient ? 'Upcoming appointments' : "Today's schedule", rows || '<p class="muted">Nothing scheduled.</p>', '#/appointments', 'View all appointments');
  },
  notifications() {
    const rows = getNotifications().map(n => `<a class="row sev-${n.severity}" href="${n.target}">${n.icon} ${n.text}</a>`).join('');
    return card('Notifications', rows || '<p class="muted">You\'re all caught up.</p>');
  },
  patients() {
    const rows = getPatients().slice(0, 4).map(p => `<a class="row" href="#/patients/${p.id}">${p.name}<span class="muted">${p.unit}</span></a>`).join('');
    return expandable('Patients', rows + '<a class="more" href="#/patients">See more</a>');
  },
  myHealth() {
    const p = getPatients()[0];
    if (!p) return '';
    return expandable('My health profile',
      `<p><b>Allergies:</b> ${p.allergies.join(', ') || 'None'}</p><p><b>Diagnoses:</b> ${p.diagnoses.join(', ')}</p>
       <p><b>Medications:</b> ${p.meds.map(m => m.name).join(', ') || 'None'}</p><a class="more" href="#/my-health">View more</a>`);
  },
  
};
