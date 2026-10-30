import { onAuthChange } from './api.js';
// NEW FILE (Harman): one generic modal dialog, reused by the Inventory item
// "administer" flow (prerequisite check + emergency override) and by
// "Book a new appointment" on the Patient Profile and Appointments pages.
// Keeping a single implementation here avoids duplicating open/close/backdrop
// markup in every feature that needs a popup.

let host;
onAuthChange(() => { if (host) host.innerHTML = ''; });
function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.id = 'modal-host';
  document.body.appendChild(host);
  return host;
}


/**
 * opts:
 *   title        — modal heading
 *   bodyHtml     — inner HTML of the form (inputs/labels/etc.)
 *   submitLabel  — text for the confirm button (default "Confirm")
 *   onMount(form)   — optional, runs right after the modal is inserted
 *   onSubmit(form)  — runs when Confirm is clicked; return false to keep the
 *                     modal open (e.g. validation failed or a follow-up
 *                     modal was opened instead)
 * Returns { close } so a caller can close it programmatically if needed.
 */
export function openModal({ title, bodyHtml, submitLabel = 'Confirm', onMount, onSubmit }) {
  const el = ensureHost();
  el.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <h2 id="modal-title">${title}</h2>
          <button type="button" class="modal-close" aria-label="Close">×</button>
        </div>
        <form class="modal-body">${bodyHtml}</form>
        <div class="modal-foot">
          <button type="button" class="modal-cancel">Cancel</button>
          <button type="button" class="modal-submit">${submitLabel}</button>
        </div>
      </div>
    </div>`;

  const form = el.querySelector('form.modal-body');
  let busy = false;
  const close = () => { if (!busy && el.querySelector('form.modal-body') === form) el.innerHTML = ''; };

  el.querySelector('.modal-close').onclick = close;
  el.querySelector('.modal-cancel').onclick = close;
  // Click on the dimmed backdrop (not the modal card itself) also closes it
  el.querySelector('.modal-backdrop').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) close();
  });
  const submit = el.querySelector('.modal-submit');
  submit.onclick = async () => {
    if (busy || form.reportValidity?.() === false) return;
    busy = true; submit.disabled = true;
    try {
      const result = await onSubmit?.(form);
      busy = false;
      if (result !== false) close();
    } catch (error) {
      // A failed database save stays open. No success entry or demo fallback is created.
      let message = form.querySelector('[data-save-error]');
      if (!message) { message = document.createElement('p'); message.dataset.saveError = ''; message.setAttribute('role','alert'); form.appendChild(message); }
      message.textContent = error.message;
    } finally { busy = false; submit.disabled = false; }
  };

  onMount?.(form);
  form.querySelector('input,select,textarea')?.focus();
  return { close };
}
