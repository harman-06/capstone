import { workspace } from '../workspace.js';
import { getInventory } from '../data.js';
import { fetchAllocationQueue, fetchSupplyEnquiries, fetchSuppliers, createSupplyEnquiry, sendSupplyEnquiry, respondSupplyEnquiry } from '../api.js';
import { openModal } from '../modal.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function operations(el) {
 const current=workspace;
 el.innerHTML='<h1>Operations overview</h1><p role="status">Loading your workspace…</p>';
 try {
  const supplier=current.kind==='supplier';
  const coordinator=current.roles.includes('chargeNurse');
  const rows=await (supplier?fetchSupplyEnquiries():fetchAllocationQueue());
  if(workspace!==current || !el.isConnected) return;
  const waiting=rows.filter(r=>supplier?r.status==='sent':r.status==='queued');
  el.innerHTML=`<p class="eyebrow">${esc(current.unit)}</p><h1>${supplier?'Supplier workspace':current.roles.includes('chargeNurse')?'Coordination centre':'Nurse workspace'}</h1><p class="muted">${supplier?'Review assigned enquiries and share availability.':coordinator?'Review priorities, allocate equipment and send approved supplier enquiries.':'Find equipment and track requests from your unit.'}</p>
  <div class="ops-metrics"><div class="card"><span>${supplier?'Awaiting response':'Waiting requests'}</span><strong>${waiting.length}</strong></div><div class="card"><span>${supplier?'Visible enquiries':'Visible requests'}</span><strong>${rows.length}</strong></div><div class="card"><span>${supplier?'Responded':'Awaiting priority review'}</span><strong>${rows.filter(r=>supplier?r.status==='responded':r.status==='queued'&&!r.reviewed).length}</strong></div></div>
  <div class="card"><h2>Your next action</h2><p>${supplier?'Open assigned enquiries to confirm available quantity and an estimated delivery date.': coordinator?'Open Requests to review priority and allocate. Open Supply enquiries to send another staff member’s shortage request to a supplier.':'Request equipment from another unit or create a shortage enquiry. A coordinator must review it before allocation or supplier contact.'}</p><a class="ops-link" href="#/${supplier?'supplies':'inventory'}">${supplier?'Review supply enquiries':'Find equipment'} →</a> ${supplier?'':'<a class="ops-link" href="#/requests">Track requests →</a>'}</div>
  <div class="card"><h2>How the workflow works</h2><p>Request → Independent review → Allocation → Transfer coordination</p><p class="muted">Availability is checked on refresh. Supplier responses are estimates, not received stock. This prototype uses synthetic data.</p></div>`;
 } catch(e) { if(workspace===current) el.innerHTML=`<h1>Operations overview</h1><p role="alert">${esc(e.message)}</p><a href="#/inventory">Open inventory</a>`; }
}
let supplyTimer;
let supplyGeneration=0;
export async function supplies(el) {
 clearTimeout(supplyTimer);
 const generation=++supplyGeneration;
 const route=location.hash;
 const valid=()=>generation===supplyGeneration && workspace===current && el.isConnected && location.hash===route;
 const schedule=()=>{ supplyTimer=setTimeout(()=>{
  if(!valid()) return;
  if(document.hidden || document.querySelector('.modal-backdrop')) {schedule();return;}
  supplies(el);
 },15000); };
 const current=workspace;
 el.innerHTML='<h1>Supply enquiries</h1><p role="status">Loading enquiries…</p>';
 try {
  const rows=await fetchSupplyEnquiries();
  if(!valid()) return;
  const supplier=current.kind==='supplier';
  el.innerHTML=`<h1>Supply enquiries</h1><p class="muted">${supplier?'Only enquiries assigned to your organisation appear here.':'Create a shortage enquiry. A different authorized coordinator must send it to a supplier.'}</p><div class="inventory-tools"><button data-refresh>Refresh enquiries</button>${supplier?'':'<button data-create>Create shortage enquiry</button>'}<span>Updated ${esc(new Date().toLocaleTimeString())}</span></div><p role="status" data-message></p><div class="card">${rows.length?`<table><thead><tr><th>Equipment / reference</th><th>Unit</th><th>Quantity</th><th>Status</th><th>Supplier response</th><th>Action</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${esc(r.item)}<br><small>${esc(r.enquiry_id)}</small></td><td>${esc(r.requesting_unit)}</td><td>${r.requested_quantity}</td><td><span class="badge">${esc(({requested:'Awaiting independent coordinator review',sent:'Sent to supplier',responded:'Supplier responded'})[r.status]||r.status)}</span></td><td>${esc(r.supplier_name||'Not sent')}<br>${esc(r.availability||'Awaiting response')}${r.available_quantity!=null?` · ${r.available_quantity}`:''}<br>${esc(r.estimated_delivery_date||'')}</td><td>${r.can_send?`<button data-send="${i}">Send to supplier</button>`:''}${r.can_respond?`<button data-respond="${i}">Update availability</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<h2>No enquiries to show</h2><p>New enquiries appear here when they are created or assigned to your organisation.</p>'}</div><p class="muted">Supplier responses do not reserve equipment or increase hospital stock. Updates every 15 seconds while this page is open.</p>`;
  el.querySelector('[data-refresh]').onclick=()=>supplies(el);
  schedule();
  el.querySelector('[data-create]')?.addEventListener('click',()=>{
   const categories=[...new Map(getInventory().filter(i=>i.type==='equipment').map(i=>[i.id.slice(-36),i])).entries()];
   if(!categories.length){el.querySelector('[data-message]').textContent='Load equipment inventory before creating an enquiry.';return;}
   openModal({title:'Create shortage enquiry',submitLabel:'Create enquiry',bodyHtml:`<label>Equipment<select name="category">${categories.map(([id,i])=>`<option value="${esc(id)}">${esc(i.name)}</option>`).join('')}</select></label><label>Quantity<input name="quantity" type="number" min="1" max="1000" value="1" required></label><label>Operational reason (no patient details)<textarea name="reason" maxlength="2000" required></textarea></label>`,async onSubmit(f){await createSupplyEnquiry(f.category.value,Number(f.quantity.value),f.reason.value.trim());await supplies(el);}});
  });
  el.querySelectorAll('[data-send]').forEach(b=>b.onclick=async()=>{
   b.disabled=true;
   try{const options=await fetchSuppliers();if(workspace!==current)return;openModal({title:'Send approved enquiry',submitLabel:'Send enquiry',bodyHtml:`<label>Supplier<select name="supplier" required>${options.map(s=>`<option value="${esc(s.supplier_id)}">${esc(s.name)}</option>`).join('')}</select></label>`,async onSubmit(f){await sendSupplyEnquiry(rows[Number(b.dataset.send)].enquiry_id,f.supplier.value);await supplies(el);}});}catch(e){el.querySelector('[data-message]').textContent=e.message;}finally{b.disabled=false;}
  });
  el.querySelectorAll('[data-respond]').forEach(b=>b.onclick=()=>openModal({title:'Confirm supplier availability',submitLabel:'Save response',bodyHtml:'<label>Availability<select name="availability"><option value="available">Available in full</option><option value="partial">Partially available</option><option value="unavailable">Unavailable</option></select></label><label>Available quantity<input name="quantity" type="number" min="0" max="100000" required></label><label>Estimated delivery date (optional)<input name="delivery" type="date"></label>',async onSubmit(f){await respondSupplyEnquiry(rows[Number(b.dataset.respond)].enquiry_id,f.availability.value,Number(f.quantity.value),f.delivery.value||null);await supplies(el);}}));
 } catch(e) {if(!valid())return; schedule();el.innerHTML=`<h1>Supply enquiries</h1><p role="alert">${esc(e.message)}</p><button data-retry>Retry</button>`;el.querySelector('[data-retry]')?.addEventListener('click',()=>supplies(el));}
}
