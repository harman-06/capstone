import { fetchEquipmentSources, submitEquipmentNeed, submitSupplyEnquiry } from '../api.js';
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
    const shortage = !sources.some(source => (source.transferable ?? source.quantity) > 0);
    const options = sources.map(source => `<option value="${escapeHtml(source.id)}" ${source.id === item.id ? 'selected' : ''}>${escapeHtml(source.unit)} · ${escapeHtml(source.quantity)} available</option>`).join('');
    openModal({
      title: `Request ${escapeHtml(item.name)}`,
      submitLabel: 'Save request',
      bodyHtml: `
        <p>Destination <strong>${escapeHtml(destination)}</strong>. Each request is for one reusable asset. A source with zero available can queue the request.</p>
        <label>Source<select name="source" required>${shortage ? ' <option value="supplier">Ask a supplier</option>' : ''}${options}</select></label>
        ${shortage ? '<p>No internal stock can be transferred now. A coordinator must review a supplier enquiry before sending it.</p>' : ''}
        <label>Required by (local time)<input type="datetime-local" name="neededBy" required></label>
        <label>Operational reason (omit patient details)<textarea name="reason" maxlength="2000" required></textarea></label>`,
      async onSubmit(form) {
        const due = new Date(form.neededBy.value);
        const reason = form.reason.value.trim();
        if (!Number.isFinite(due.getTime()) || !reason) {
          throw new Error('Enter a required-by time and operational reason.');
        }
        const supplier = form.source.value === 'supplier';
        if (supplier) await submitSupplyEnquiry(category, 1, reason, due.toISOString());
        else await submitEquipmentNeed(form.source.value, reason, due.toISOString());
        if (active()) location.hash = supplier ? '#/supplies' : '#/requests';
      }
    });
  } catch (error) {
    if (active()) toast(error.message, { error: true });
  } finally {
    if (button) button.disabled = false;
  }
}
