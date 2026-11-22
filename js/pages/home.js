// Dashboard entry point. Patients get their own home page; everyone else gets the
// operations dashboard (operations.js).
import { workspace } from '../workspace.js';
import { ROLES, session } from '../roles.js';
import { getAppointments, getPatients } from '../data.js';
import { greeting } from '../greeting.js';
import { operations } from './operations.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function home(el, ctx) {
  return workspace?.kind === 'patient' ? patientHome(el) : operations(el, ctx);
}

function patientHome(el) {
  const patient = getPatients()[0];
  const appointments = getAppointments();
  const next = appointments[0];
  const meds = patient?.medicationSchedule ?? [];
  const allergies = patient?.allergies ?? [];
  const conditions = patient?.diagnoses ?? [];
  el.innerHTML = `<p class="eyebrow">${esc(ROLES[session.role].label)}</p>
    <h1>${esc(greeting(workspace.name, 'there'))}</h1>
    <p class="muted">${next ? `Your next appointment is ${esc(next.when)} · ${esc(next.type)}.` : 'You have no upcoming appointments.'}</p>
    <div class="ops-actions"><a class="ops-link" href="#/appointments">Appointments →</a><a class="ops-link" href="#/my-health">My health profile →</a></div>
    <div class="home-grid">
      <section class="card"><h2>Upcoming appointments</h2>
        ${appointments.slice(0, 4).map(a => `<a class="row" href="#/appointments"><b>${esc(a.when)}</b><span>${esc(a.type)}</span></a>`).join('') || '<p class="muted">Nothing scheduled.</p>'}
      </section>
      <section class="card"><h2>Medication schedule</h2>
        ${meds.map(m => `<div class="row"><b>${esc(m.time)}</b><span>${esc(m.med)} — ${esc(m.route)}</span></div>`).join('') || '<p class="muted">No medications scheduled.</p>'}
      </section>
      <section class="card"><h2>Health summary</h2>
        <dl class="item-facts">
          <div><dt>Allergies</dt><dd>${esc(allergies.join(', ') || 'None recorded')}</dd></div>
          <div><dt>Conditions</dt><dd>${esc(conditions.join(', ') || 'None recorded')}</dd></div>
        </dl>
        <a class="more" href="#/my-health">View full profile</a>
      </section>
    </div>`;
}
