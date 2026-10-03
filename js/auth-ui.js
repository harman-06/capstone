import { isConfigured, signIn, signOut } from './api.js';
import { reloadEquipment, getDataSource } from './data.js';
export function mountDatabaseControls(refresh) {
  const panel = document.getElementById('database-controls');
  const status = document.getElementById('database-status');
  const form = document.getElementById('database-signin');
  const logout = document.getElementById('database-signout');
  const reload = document.getElementById('database-refresh');
  const message = document.getElementById('database-auth-message');
  status.textContent = getDataSource();
  if (!isConfigured()) { form.hidden = true; logout.hidden = true; reload.hidden = true; return; }
  let busy = false;
  async function run(action) {
    if (busy) return;
    busy = true;
    panel.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      await action();
      await reloadEquipment();
      status.textContent = getDataSource();
      refresh();
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; panel.querySelectorAll('button').forEach(b => b.disabled = false); }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const password = form.elements.password.value;
    form.elements.password.value = '';
    await run(async () => {
      await signIn(form.elements.email.value.trim(), password);
      form.hidden = true; logout.hidden = false;
      message.textContent = 'Signed in. Session ends when this page reloads. Demo roles do not change database access.';
    });
  });
  logout.addEventListener('click', () => run(async () => {
    await signOut(); form.hidden = false; logout.hidden = true; message.textContent = 'Signed out';
  }));
  reload.addEventListener('click', () => run(async () => {}));
}
