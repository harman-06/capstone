import { isConfigured, isSignedIn, signIn, signOut } from './api.js';
import { reloadEquipment, getDataSource } from './data.js';
export function mountDatabaseControls(refresh) {
  const panel = document.getElementById('database-controls');
  const status = document.getElementById('database-status');
  const form = document.getElementById('database-signin');
  const logout = document.getElementById('database-signout');
  const reload = document.getElementById('database-refresh');
  const message = document.getElementById('database-auth-message');
  function syncVisibility() {
    const signedIn = isSignedIn();
    document.querySelectorAll('[data-auth-required]').forEach(el => el.hidden = !signedIn);
    document.body.classList.toggle('signed-out', !signedIn);
    form.hidden = signedIn;
    logout.hidden = !signedIn;
    reload.hidden = !signedIn;
    document.getElementById('signin-heading').hidden = signedIn;
    document.getElementById('signin-intro').hidden = signedIn;
  }
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
      await reloadEquipment();
      status.textContent = getDataSource();
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
      message.textContent = 'Signed in. Session ends when this page reloads. Demo roles do not change database access.';
    });
  });
  logout.addEventListener('click', () => run(async () => {
    const signingOut = signOut(); syncVisibility(); await signingOut; message.textContent = 'Signed out';
  }));
  reload.addEventListener('click', () => run(async () => {}));
}
