// NEW FILE (Harman): one generic modal dialog, reused by the Inventory item
// "administer" flow (prerequisite check + emergency override) and by
// "Book a new appointment" on the Patient Profile and Appointments pages.
// Keeping a single implementation here avoids duplicating open/close/backdrop
// markup in every feature that needs a popup.

let host;
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
  const close = () => { el.innerHTML = ''; };

  el.querySelector('.modal-close').onclick = close;
  el.querySelector('.modal-cancel').onclick = close;
  // Click on the dimmed backdrop (not the modal card itself) also closes it
  el.querySelector('.modal-backdrop').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) close();
  });
  el.querySelector('.modal-submit').onclick = () => {
    const result = onSubmit?.(form);
    if (result !== false) close();   // onSubmit returning false means "stay open"
  };

  onMount?.(form);
  form.querySelector('input,select,textarea')?.focus();
  return { close };
}
