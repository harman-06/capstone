// Units page: every hospital unit (number, name, floor) with the inventory it holds.
import { session } from '../roles.js';
import { getUnits, getInventory } from '../data.js';

const page = (title, body) => `<h1>${title}</h1>${body}`;

export function units(el) {
  const items = getInventory();
  const cards = getUnits().map(u => {
    const mine = items.filter(i => i.unit === u.name);
    const short = mine.filter(i => i.status !== 'available').length;
    const rows = mine.map(i => `<tr>
      <td><a href="#/inventory?tab=${i.type}&item=${i.id}">${i.name}</a></td>
      <td>${i.type}</td><td>${i.qty}</td>
      <td><span class="badge ${i.status}">${i.status}</span></td></tr>`).join('');
    return `<div class="card">
      <h3>${u.number} · ${u.name} <span class="muted">Floor ${u.floor}${u.name === session.unit ? ' · Your unit' : ''}</span></h3>
      <p class="muted">${mine.length} item(s)${short ? ` · ${short} low or out` : ''}</p>
      ${mine.length
        ? `<table><tr><th>Item</th><th>Type</th><th>Qty</th><th>Status</th></tr>${rows}</table>`
        : '<p class="muted">No inventory recorded.</p>'}
    </div>`;
  }).join('');
  el.innerHTML = page('Units', cards || '<p class="muted">No units found.</p>');
}
