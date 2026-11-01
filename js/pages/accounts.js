import { fetchAccounts } from '../api.js';
import { workspace } from '../workspace.js';
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const findings=r=>[
 ...(!r.roles.length&&!r.suppliers.length?['No assigned access']:[]),
 ...(!r.active&&(r.roles.length||r.suppliers.length)?['Inactive account retains assignments']:[]),
 ...(r.roles.length&&r.suppliers.length?['Staff and supplier access — review separation']:[]),
 ...(!r.confirmed?['Email not confirmed']:[])
];
let generation=0;
export async function accounts(el){
 const current=workspace,version=++generation;
 const valid=()=>workspace===current&&el.isConnected&&version===generation;
 const started=performance.now();
 el.innerHTML='<h1>IT administration</h1><p role="status">Checking account service…</p>';
 try{
  const rows=await fetchAccounts();if(!valid())return;
  const latency=Math.round(performance.now()-started),checked=new Date().toLocaleString();
  const review=rows.flatMap(r=>findings(r).map(reason=>({email:r.email,reason})));
  el.innerHTML=`<p class="eyebrow">NEXORA HEALTH · IT ADMINISTRATION</p><h1>Administration overview</h1><p class="muted">Hospital account access and application service checks.</p>
  <nav class="inventory-tools" aria-label="Administration sections"><a class="ops-link" href="#admin-accounts" data-section="admin-accounts">Accounts & roles</a><a class="ops-link" href="#admin-review" data-section="admin-review">Access review</a><a class="ops-link" href="#admin-health" data-section="admin-health">System health</a><button data-refresh>Refresh checks</button></nav>
  <div class="ops-metrics"><div class="card"><span>Active accounts</span><strong>${rows.filter(r=>r.active).length}</strong></div><div class="card"><span>Inactive accounts</span><strong>${rows.filter(r=>!r.active).length}</strong></div><div class="card"><span>Accounts needing review</span><strong>${rows.filter(r=>findings(r).length).length}</strong></div></div>
  <section class="card" id="admin-accounts"><h2>Accounts & roles</h2><label>Search by name, email, role or scope<input data-search type="search" placeholder="Search accounts" autocomplete="off"></label><p data-count role="status"></p><div style="overflow-x:auto"><table><thead><tr><th>Account</th><th>Status</th><th>Assigned access</th><th>Last sign-in</th></tr></thead><tbody data-accounts></tbody></table></div><p class="muted">Read-only inspection. Last sign-in is not a complete sign-in history. Passwords and tokens are never returned.</p></section>
  <section class="card" id="admin-review"><h2>Access review</h2><p>Flags identify records to investigate; they do not automatically change access. Multiple department assignments are not treated as conflicts.</p>${review.length?`<div style="overflow-x:auto"><table><thead><tr><th>Account</th><th>Review finding</th></tr></thead><tbody>${review.map(r=>`<tr><td>${esc(r.email)}</td><td>${esc(r.reason)}</td></tr>`).join('')}</tbody></table></div>`:'<p>No findings in the accounts visible to this administrator.</p>'}<p class="muted">This report covers linked hospital accounts and suppliers. Unlinked Auth accounts are outside this report.</p></section>
  <section class="card" id="admin-health"><h2>System health</h2><table><tbody><tr><th>Account API / database query</th><td>Passed — authorized account query completed</td></tr><tr><th>Observed response time</th><td>${latency} ms (network and query combined)</td></tr><tr><th>Last successful check</th><td>${esc(checked)}</td></tr><tr><th>Accounts returned</th><td>${rows.length}</td></tr></tbody></table><p class="muted">Point-in-time check of this account service only. This does not measure overall uptime, other APIs, endpoint devices or security-agent health. Refresh to check again.</p></section>`;
  const tbody=el.querySelector('[data-accounts]'),count=el.querySelector('[data-count]');
  const render=()=>{const q=el.querySelector('[data-search]').value.trim().toLowerCase();const filtered=rows.filter(r=>[r.name,r.email,...r.roles.flatMap(x=>[x.role,x.scope]),...r.suppliers].join(' ').toLowerCase().includes(q));count.textContent=`${filtered.length} of ${rows.length} accounts`;tbody.innerHTML=filtered.length?filtered.map(r=>`<tr><td>${esc(r.name)}<br>${esc(r.email)}</td><td>${r.active?'Active':'Inactive'} · ${r.confirmed?'Confirmed':'Unconfirmed'}</td><td>${[...r.roles.map(x=>`${esc(x.role)} — ${esc(x.scope)}`),...r.suppliers.map(esc)].join('<br>')||'No assignments'}</td><td>${r.last_sign_in?esc(new Date(r.last_sign_in).toLocaleString()):'Not recorded'}</td></tr>`).join(''):'<tr><td colspan="4">No matching accounts.</td></tr>';};
  render();el.querySelector('[data-search]').oninput=render;
  el.querySelector('[data-refresh]').onclick=()=>accounts(el);
  el.querySelectorAll('[data-section]').forEach(a=>a.onclick=e=>{e.preventDefault();el.querySelector('#'+a.dataset.section).scrollIntoView({behavior:'smooth',block:'start'});});
 }catch(e){if(!valid())return;el.innerHTML=`<h1>IT administration</h1><div class="card"><h2>Account service check failed</h2><p role="alert">${esc(e.message)}</p><p>Account data and review findings are unavailable. A failed check can mean a connection, session or permission problem; it does not establish that the whole system is down.</p><button data-refresh>Retry check</button></div>`;el.querySelector('[data-refresh]').onclick=()=>accounts(el);}
}
