import { fetchWorkspace, onAuthChange } from './api.js';
import { session } from './roles.js';
export let workspace = null;
onAuthChange(() => { workspace = null; });
export async function loadWorkspace() {
 const context = await fetchWorkspace();
 if (!context || !['staff','supplier'].includes(context.kind)) throw new Error('No workspace is assigned to this account.');
 workspace = context;
 session.role = context.kind === 'supplier' ? 'supplier' : context.roles.includes('chargeNurse') || context.roles.includes('operations') ? 'chargeNurse' : context.roles.includes('nurse') ? 'nurse' : 'staff';
 session.unit = context.unit;
 return context;
}
