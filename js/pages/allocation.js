import { fetchAllocationQueue, reviewAllocation, configureAllocationPool, allocateNext, cancelAllocation } from '../api.js';
import { openModal } from '../modal.js';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const priorityName = n => ({1:'Routine',2:'Time-sensitive',3:'Urgent — staff verified'}[n] || 'Routine');
export async function renderAllocationQueue(host) {
  if (!host) return;
  const route = globalThis.location?.hash;
  host.innerHTML = '<p role="status">Loading allocation queue…</p>';
  try {
    const rows = await fetchAllocationQueue();
    if (host.isConnected === false || globalThis.location?.hash !== route) return;
    const pools = [...new Map(rows.filter(r => r.can_coordinate && r.status === 'queued').map(r => [`${r.source_id}/${r.category_id}`,r])).values()];
    host.innerHTML = `<h2>Equipment allocation queue</h2>
      <p>One reusable asset per request. A coordinator reviews priority before allocation. Equal-priority requests balance recent unit allocations and waiting time. This is a prototype policy, not automated clinical triage.</p>
      <p>Checked ${escapeHtml(new Date().toLocaleTimeString())}. <button type="button" data-queue-refresh>Refresh queue</button></p>
      <p role="status" data-queue-message></p>
      ${pools.map((p,i)=>`<div class="card"><h3>${escapeHtml(p.source_unit)} · ${escapeHtml(p.item)}</h3>
        <p>${p.pool_enabled ? `Enabled · retain at least ${p.minimum_retained} available assets in the source unit.` : 'Allocation paused until an authorized coordinator confirms the source reserve.'}</p>
        <button type="button" data-pool-config="${i}">Set source reserve</button>
        <button type="button" data-allocate="${i}" ${p.pool_enabled ? '' : 'disabled'}>Allocate next eligible request</button></div>`).join('')}
      ${rows.length ? `<table><thead><tr><th>Item / source</th><th>Destination</th><th>Priority</th><th>Queue / status</th><th>Action</th></tr></thead><tbody>${rows.map((r,i)=>`<tr>
        <td>${escapeHtml(r.item)}<br>${escapeHtml(r.source_unit)}</td><td>${escapeHtml(r.destination_unit)}</td>
        <td>${escapeHtml(priorityName(r.priority))}${r.reviewed ? '' : ' · awaiting review'}${r.needed_by ? `<br>Needed ${escapeHtml(new Date(r.needed_by).toLocaleString())}` : ''}</td>
        <td>${escapeHtml(r.status)}${r.allocation_explanation ? `<br>${escapeHtml(r.allocation_explanation)}` : ''}${r.queue_position ? `<br>Position ${r.queue_position} · ${r.recent_allocations} allocations to unit in 24h` : r.status==='queued' && r.reviewed ? '<br>Eligibility needs recheck' : ''}<br>Requested ${escapeHtml(new Date(r.created_at).toLocaleString())}</td>
        <td>${r.can_review ? `<button type="button" data-review="${i}">Review priority</button>` : ''}${r.can_cancel ? `<button type="button" data-cancel="${i}">Cancel queued request</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p>No visible allocation requests. Use Request in live Inventory; zero-stock requests can wait here.</p>'}
      <p>Queue position can change when verified priorities or stock change. Already reserved assets are not automatically reassigned. Showing up to 200 visible requests; older history requires a future paginated view.</p>`;
    host.querySelector('[data-queue-refresh]').onclick = () => renderAllocationQueue(host);
    const message = text => { const node=host.querySelector('[data-queue-message]'); if(node) node.textContent=text; };
    async function run(button, action, success) {
      if(button.disabled) return;
      button.disabled=true;
      try {
        const result=await action();
        if(host.isConnected===false || globalThis.location?.hash!==route) return;
        await renderAllocationQueue(host);
        message(success(result));
      } catch(error) { message(error.message); }
      finally { button.disabled=false; }
    }
    host.querySelectorAll('[data-review]').forEach(button=>button.onclick=()=>{
      const r=rows[Number(button.dataset.review)];
      openModal({title:`Review ${escapeHtml(r.item)} request`,submitLabel:'Save reviewed priority',bodyHtml:`
        <p>Verify operational urgency under your hospital policy. Do not enter patient identifiers.</p>
        <label>Priority<select name="priority"><option value="1">Routine</option><option value="2">Time-sensitive</option><option value="3">Urgent — verified by staff</option></select></label>
        <label>Required by (optional, local time)<input type="datetime-local" name="neededBy"></label>
        <label>Review reason<textarea name="note" minlength="8" maxlength="2000" required></textarea></label>`,
        async onSubmit(form) {
          const due=form.neededBy.value ? new Date(form.neededBy.value).toISOString() : null;
          await reviewAllocation(r.id,Number(form.priority.value),due,form.note.value.trim());
          await renderAllocationQueue(host);
        }});
    });
    host.querySelectorAll('[data-pool-config]').forEach(button=>button.onclick=()=>{
      const p=pools[Number(button.dataset.poolConfig)];
      openModal({title:'Confirm source-unit reserve',submitLabel:'Save and enable allocation',bodyHtml:`
        <p>${escapeHtml(p.source_unit)} · ${escapeHtml(p.item)}. Retain this many available assets. Zero permits the last available asset to be reserved; use a reviewed local policy.</p>
        <label>Minimum retained<input name="minimum" type="number" min="0" max="1000" step="1" value="${p.minimum_retained}" required></label>`,
        async onSubmit(form) { await configureAllocationPool(p.source_id,p.category_id,Number(form.minimum.value)); await renderAllocationQueue(host); }});
    });
    host.querySelectorAll('[data-allocate]').forEach(button=>button.onclick=()=>{
      const p=pools[Number(button.dataset.allocate)];
      return run(button,()=>allocateNext(p.source_id,p.category_id),r=>({allocated:'Allocation saved. Asset reserved; dispatch and receipt are separate.',waiting_for_stock:'Waiting for stock above the source reserve. No request was lost.',no_eligible_requests:'No reviewed eligible requests. Review priorities and account scopes.',configuration_required:'Confirm the source reserve before allocating.'}[r.outcome] || 'Refresh the queue to verify the result.'));
    });
    host.querySelectorAll('[data-cancel]').forEach(button=>button.onclick=()=>run(button,()=>cancelAllocation(rows[Number(button.dataset.cancel)].id),()=> 'Queued request cancelled.'));
  } catch(error) {
    if(host.isConnected===false || globalThis.location?.hash!==route) return;
    host.innerHTML=`<p role="alert">${escapeHtml(error.message)}</p><button type="button" data-retry-queue>Retry queue load</button>`;
    host.querySelector('[data-retry-queue]').onclick=()=>renderAllocationQueue(host);
  }
}
