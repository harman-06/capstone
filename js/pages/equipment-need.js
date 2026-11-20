import { fetchEquipmentSources, submitEquipmentNeed } from '../api.js';
import { openModal } from '../modal.js';
import { toast } from '../toast.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
  char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export async function openEquipmentNeed(item, host, button) {
  const route = location.hash;
  const active = () => host.isConnected !== false && location.hash === route;
  if (button) button.disabled = true;
  try {
    const category = item.id.slice(-36);
    const {destination, sources} = await fetchEquipmentSources(category);
    if (!active()) return;
    if (!sources.length) throw new Error('No internal source units are configured for this equipment.');
    const options = sources.map(source => `<option value="${escapeHtml(source.id)}" ${source.id === item.id ? 'selected' : ''}>${escapeHtml(source.unit)} · ${escapeHtml(source.quantity)} available</option>`).join('');
    openModal({
      title: `Request ${escapeHtml(item.name)}`,
      submitLabel: 'Submit equipment request',
      bodyHtml: `
        <p>Destination <strong>${escapeHtml(destination)}</strong>. Each request is for one reusable asset. A source with zero available can queue the request.</p>
        <label>Source unit<select name="source" required>${options}</select></label>
        <label>Required by (local time)<input type="datetime-local" name="neededBy" required></label>
        <label>Operational reason (omit patient details)<textarea name="reason" maxlength="2000" required></textarea></label>`,
      async onSubmit(form) {
        const due = new Date(form.neededBy.value);
        const reason = form.reason.value.trim();
        if (!Number.isFinite(due.getTime()) || !reason) {
          throw new Error('Enter a required-by time and operational reason.');
        }
        await submitEquipmentNeed(form.source.value, reason, due.toISOString());
        if (active()) location.hash = '#/requests';
      }
    });
  } catch (error) {
    if (active()) toast(error.message, { error: true });
  } finally {
    if (button) button.disabled = false;
  }
}
