import { workspace, loadWorkspace } from './workspace.js';
import { isConfigured, isSignedIn, signIn, signOut, onAuthChange } from './api.js';
import { reloadEquipment, getDataSource } from './data.js';
export function mountDatabaseControls(refresh) {
  const panel = document.getElementById('database-controls');
  const status = document.getElementById('database-status');
  const form = document.getElementById('database-signin');
  const logout = document.getElementById('database-signout');
  const reload = document.getElementById('database-refresh');
  const message = document.getElementById('database-auth-message');
  function syncVisibility() {
    const signedIn = isSignedIn() && Boolean(workspace);
    document.querySelectorAll('[data-auth-required]').forEach(el => el.hidden = !signedIn);
    document.body.classList.toggle('signed-out', !signedIn);
    form.hidden = signedIn;
    logout.hidden = !signedIn;
    reload.hidden = !signedIn;
    document.getElementById('signin-heading').hidden = signedIn;
    document.getElementById('signin-intro').hidden = signedIn;
  }
  onAuthChange(syncVisibility);
  syncVisibility();
  status.textContent = 'Sign in to continue.';
  if (!isConfigured()) { form.hidden = true; status.textContent = 'Sign-in is unavailable. Please contact your administrator.'; return; }
  let busy = false;
  async function run(action) {
    if (busy) return;
    busy = true;
    panel.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      await action();
      syncVisibility();
      if (isSignedIn()) {
        await loadWorkspace();
        if (workspace.kind === 'staff' && !workspace.roles.includes('admin')) await reloadEquipment();
      }
      status.textContent = workspace ? `${workspace.name} · ${workspace.unit} · Updated ${new Date().toLocaleTimeString()}` : 'Sign in to continue.';
      refresh();
    } catch (error) { message.textContent = error.message; }
    finally { syncVisibility(); busy = false; panel.querySelectorAll('button').forEach(b => b.disabled = false); }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const password = form.elements.password.value;
    form.elements.password.value = '';
    await run(async () => {
      await signIn(form.elements.email.value.trim(), password);
      message.textContent = '';
    });
  });
  logout.addEventListener('click', () => run(async () => {
    const signingOut = signOut(); syncVisibility(); await signingOut; message.textContent = 'Signed out';
  }));
  reload.addEventListener('click', () => run(async () => {}));
}
