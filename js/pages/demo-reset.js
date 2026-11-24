import {
  enrollAdminAuthenticator, listAdminAuthenticators, resetDemoPassword, verifyAdminAuthenticator
} from '../api.js';
import { openModal } from '../modal.js';

const targets = [
  ['nurse.demo@nexora.example', 'Nurse'],
  ['coordinator.demo@nexora.example', 'Coordinator'],
  ['supplier.a@nexora.example', 'Supplier A'],
  ['supplier.b@nexora.example', 'Supplier B'],
  ['patient.demo@nexora.example', 'Patient']
];

export function mountDemoReset(panel) {
  const status = panel.querySelector('[role="status"]');

  async function loadFactors(button, action) {
    button.disabled = true;
    status.textContent = '';
    try {
      const factors = await listAdminAuthenticators();
      if (panel.isConnected) await action(factors);
    } catch (error) {
      if (panel.isConnected) status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function verifyDialog(factors, setupSecret) {
    const reset = !setupSecret;
    openModal({
      title: reset ? 'Reset a demo password' : 'Set up your authenticator',
      submitLabel: reset ? 'Verify and reset' : 'Verify setup',
      bodyHtml: (reset
        ? '<label>Demo account<select data-target required><option value="">Select an account</option></select></label>'
          + '<label><input type="checkbox" required> I understand this replaces the selected account’s password.</label>'
        : '<p>Enter this setup key in your authenticator app as a time-based account. Keep the key private.</p><p><code data-secret></code></p>')
        + '<label data-factor-label>Authenticator<select data-factor required></select></label>'
        + '<label>Six-digit code<input data-code required inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code"></label>',
      onMount(form) {
        form.onsubmit = event => event.preventDefault();
        const select = form.querySelector('[data-factor]');
        for (const factor of factors) {
          select.add(new Option(factor.friendly_name || 'Authenticator', factor.id));
        }
        if (reset) {
          const target = form.querySelector('[data-target]');
          for (const [email, role] of targets) target.add(new Option(role + ' · ' + email, email));
        } else {
          form.querySelector('[data-factor-label]').hidden = true;
          form.querySelector('[data-secret]').textContent = setupSecret;
        }
      },
      async onSubmit(form) {
        const code = form.querySelector('[data-code]');
        await verifyAdminAuthenticator(form.querySelector('[data-factor]').value, code.value)
          .finally(() => { code.value = ''; });
        if (!form.isConnected) return;
        if (!reset) {
          status.textContent = 'Authenticator verified. The project operator must approve this factor before password resets are enabled.';
          return;
        }

        const target = form.querySelector('[data-target]').value;
        const password = await resetDemoPassword(target);
        if (!form.isConnected) return;
        openModal({
          title: 'Demo password changed',
          bodyHtml: '<p>Share the new password privately with the account holder. It disappears when you close this window.</p><p><code data-password></code></p>',
          submitLabel: 'Done',
          onMount(result) { result.querySelector('[data-password]').textContent = password; }
        });
      }
    });
  }

  const setup = panel.querySelector('[data-reset-setup]');
  setup.onclick = () => loadFactors(setup, async factors => {
    if (factors.length) {
      status.textContent = 'An authenticator is already registered. Select Reset a demo password to use it.';
      return;
    }
    const factor = await enrollAdminAuthenticator();
    if (!factor.id || !factor.totp?.secret) throw new Error('Authenticator setup is unavailable.');
    if (panel.isConnected) verifyDialog([factor], factor.totp.secret);
  });

  const reset = panel.querySelector('[data-reset-start]');
  reset.onclick = () => loadFactors(reset, factors => {
    if (factors.length) verifyDialog(factors);
    else status.textContent = 'Set up an authenticator before resetting a password.';
  });
}
