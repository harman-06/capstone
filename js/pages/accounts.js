import { fetchAccounts } from '../api.js';
import { workspace } from '../workspace.js';
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function accounts(el){
 const current=workspace;
 el.innerHTML='<h1>Account monitoring</h1><p role="status">Loading accounts…</p>';
 try{const rows=await fetchAccounts();if(workspace!==current||!el.isConnected)return;
 el.innerHTML=`<h1>Account monitoring</h1><p class="muted">Read-only hospital account inspection. Passwords and tokens are never displayed. Last sign-in is not a complete sign-in audit log.</p><button data-refresh>Refresh accounts</button><div class="card"><table><thead><tr><th>Account</th><th>Status</th><th>Assigned access</th><th>Last sign-in</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}<br>${esc(r.email)}</td><td>${r.active?'Active':'Inactive'} · ${r.confirmed?'Confirmed':'Unconfirmed'}</td><td>${r.roles.map(x=>`${esc(x.role)} — ${esc(x.scope)}`).join('<br>')}${r.suppliers.map(esc).join('<br>')||''}</td><td>${r.last_sign_in?esc(new Date(r.last_sign_in).toLocaleString()):'Not recorded'}</td></tr>`).join('')}</tbody></table></div>`;
 el.querySelector('[data-refresh]').onclick=()=>accounts(el);
 }catch(e){if(workspace===current)el.innerHTML=`<h1>Account monitoring</h1><p role="alert">${esc(e.message)}</p>`;}
}
