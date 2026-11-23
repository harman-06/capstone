// SPRINT 3 (Mohammed Mirza): Resource and care-readiness view.
// NEW FILE: js/pages/readiness.js   (save this file under that name)
// Route: #/readiness  (see sprint3_patches.md for the main.js line)
//
// Top: one card per unit saying Ready / At risk / Not ready, judged on its
// critical equipment, with the reasons. Bottom: the full stock breakdown
// (on hand, in use, reserved, maintenance, in transit, available now,
// reserve level, can share) so availability is more than a quantity.
import { getInventory, getQcItems, qualityCheckState } from '../data.js';
import { isConfigured } from '../api.js';
import { applyPermissions } from '../roles.js';
import { stockBreakdown, unitReadiness, LEVEL_LABEL, LEVEL_BADGE } from '../readiness.js';

const page = (title, body) => `<h1>${title}</h1>${body}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

export function readiness(el) {
  let unitFilter = '';
  const live = isConfigured();

  const draw = () => {
    const equipment = getInventory().filter(i => i.type === 'equipment');
    const units = [...new Set(equipment.map(i => i.unit))].sort();

    // Blood glucose monitors that missed their 24 h quality check.
    const overdueBgm = unit => getQcItems().filter(i => i.unit === unit && !qualityCheckState(i).ok).length;

    const cards = units.map(unit => {
      const result = unitReadiness(equipment, unit);
      const late = overdueBgm(unit);
      const issues = [...result.issues];
      if (late) issues.push(`${late} blood glucose monitor${late === 1 ? '' : 's'} overdue for quality check`);
      const level = result.level === 'ready' && late ? 'at-risk' : result.level;
      return `<div class="card">
        <h3>${escapeHtml(unit)} <span class="badge ${LEVEL_BADGE[level]}">${LEVEL_LABEL[level]}</span></h3>
        ${issues.length
          ? issues.map(text => `<div class="row"><span>${escapeHtml(text)}</span></div>`).join('')
          : '<p class="muted">All tracked critical equipment is above its low-stock threshold.</p>'}
      </div>`;
    }).join('');

    const rows = equipment
      .filter(i => !unitFilter || i.unit === unitFilter)
      .sort((a, b) => a.unit.localeCompare(b.unit) || a.name.localeCompare(b.name))
      .map(i => {
        const b = stockBreakdown(i);
        return `<tr>
          <td><a href="#/inventory/${escapeHtml(i.id)}">${escapeHtml(i.name)}</a></td>
          <td>${escapeHtml(i.unit)}</td>
          ${[b.onHand,b.inUse,b.reserved,b.maintenance,b.inTransit,b.unavailable].map(value=>`<td>${value ?? '—'}</td>`).join('')}
          <td><b>${b.available}</b></td>
          <td>${b.reserveLevel ?? '—'}</td><td>${b.transferable ?? '—'}</td>
          <td><span class="badge ${b.status}">${escapeHtml(b.status)}</span>${b.reason ? ` <span class="muted">${escapeHtml(b.reason)}</span>` : ''}</td>
        </tr>`;
      }).join('');

    el.innerHTML = page('Resource and care readiness', `
      <div data-cap="inventory.view">
        <p class="muted">A unit is judged on its critical equipment: defibrillators, ventilators, patient monitors and infusion pumps.</p>
        ${cards}
        <h2>Stock breakdown</h2>
        <p><label>Unit <select id="readiness-unit"><option value="">All units</option>${units.map(u => `<option value="${escapeHtml(u)}" ${u === unitFilter ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}</select></label></p>
        <div class="card">
          <table>
            <thead><tr>
              <th scope="col">Item</th><th scope="col">Unit</th>
              <th scope="col">On hand</th><th scope="col">In use</th><th scope="col">Reserved</th><th scope="col">Maintenance</th><th scope="col">In transit</th><th scope="col">Unavailable</th>
              <th scope="col">Available now</th>
              <th scope="col">Reserve level</th><th scope="col">Can share</th>
              <th scope="col">Status</th>
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="12" class="muted">No equipment loaded.</td></tr>`}</tbody>
          </table>
        </div>
        ${live ? '<p class="muted">Stock counts come from Supabase. A dash means no source reserve has been configured for that item.</p>' : '<p class="muted">Demo stock shows how commitments and reserves affect availability.</p>'}
      </div>`);

    el.querySelector('#readiness-unit')?.addEventListener('change', e => { unitFilter = e.target.value; draw(); });
    applyPermissions(el);     // redraws skip the router, so re-apply the role rules
  };

  draw();
}
