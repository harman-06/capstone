import { fetchWorkspace, onAuthChange } from './api.js';
import { session } from './roles.js';
export let workspace = null;
onAuthChange(() => { workspace = null; });
export async function loadWorkspace() {
 const context = await fetchWorkspace();
 if (!context || !['staff','supplier','patient'].includes(context.kind)) throw new Error('No workspace is assigned to this account.');
 workspace = { ...context, roles: context.roles ?? [] };
 const roles = workspace.roles;
 session.role = context.kind === 'patient' ? 'patient' : context.kind === 'supplier' ? 'supplier' : roles.includes('admin') ? 'admin' : roles.includes('doctor') ? 'doctor' : roles.includes('chargeNurse') || roles.includes('operations') ? 'chargeNurse' : roles.includes('nurse') ? 'nurse' : 'staff';
 session.unit = context.unit;
 session.patientId = context.kind === 'patient' ? context.patientId ?? null : null;
 return context;
}
