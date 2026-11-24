import { fetchRequestHistory } from '../api.js';
import { openModal } from '../modal.js';

const equipmentStages = {
  requested:'Request submitted', reviewed:'Priority reviewed', allocated:'Equipment allocated',
  reserved:'Equipment reserved', dispatched:'Dispatched', in_transit:'In transit',
  received:'Received', completed:'Completed', cancelled:'Cancelled', rejected:'Rejected'
};
const supplierStages = {
  requested:'Enquiry created', sent:'Sent to supplier', responded:'Supplier response saved'
};

export function openRequestHistory(kind, requestId) {
  openModal({
    title: kind === 'supplier' ? 'Supplier enquiry history' : 'Equipment request history',
    submitLabel: 'Close',
    bodyHtml: '<p role="status" data-history-status>Loading history…</p><ol data-history-events></ol>',
    async onMount(form) {
      const status = form.querySelector('[data-history-status]');
      const list = form.querySelector('[data-history-events]');
      const labels = kind === 'supplier' ? supplierStages : equipmentStages;
      try {
        const events = await fetchRequestHistory(kind, requestId);
        if (!form.isConnected) return;
        status.textContent = events.length ? '' : 'No history has been recorded yet.';
        for (const event of events) {
          const item = document.createElement('li');
          const date = new Date(event.at);
          item.textContent = [
            labels[event.stage] ?? 'Status updated',
            event.tagVerified ? 'Equipment tag matched' : '',
            Number.isFinite(date.getTime()) ? date.toLocaleString() : ''
          ].filter(Boolean).join(' · ');
          list.append(item);
        }
      } catch (error) {
        if (!form.isConnected) return;
        status.setAttribute('role','alert');
        status.textContent = error.message;
      }
    }
  });
}
