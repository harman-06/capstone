import { fetchMyVisit } from '../api.js';
import { workspace } from '../workspace.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
  ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

export async function myVisit(el) {
  const account = workspace;
  el.innerHTML = '<h1>My Visit</h1><p role="status">Loading your demo visit…</p>';
  try {
    const visit = await fetchMyVisit();
    if (workspace !== account || !el.isConnected || location.hash !== '#/my-health') return;
    if (!visit) {
      el.innerHTML = '<h1>My Visit</h1><p>No demo visit is available.</p>';
      return;
    }
    const when = new Intl.DateTimeFormat('en-CA', {
      dateStyle:'long', timeStyle:'short', timeZone:'America/Edmonton'
    }).format(new Date(visit.starts_at));
    el.innerHTML = `<h1>My Visit</h1>
      <p class="muted">This visit is fictional and for demonstration only.</p>
      <section class="card"><h2>Appointment</h2><p>${escapeHtml(when)} (Edmonton time)</p>
        <p>${escapeHtml(visit.clinic)}</p>
        <h3>Preparation checklist</h3><ul>${visit.checklist.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`;
  } catch (error) {
    if (workspace !== account || !el.isConnected || location.hash !== '#/my-health') return;
    el.innerHTML = '<h1>My Visit</h1><p role="alert">Your demo visit could not be loaded.</p><button type="button" data-visit-retry>Retry</button>';
    el.querySelector('[data-visit-retry]').onclick = () => myVisit(el);
  }
}
