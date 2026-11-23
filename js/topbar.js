// Top bar behaviour: notification bell, account menu, toast messages, and the
// physician-approval dialog. The account menu's Refresh / Sign out items press the
// existing buttons in auth-ui.js, so sign-in logic stays in one place.
import { workspace } from './workspace.js';
import { ROLES, session } from './roles.js';
import { getBellItems, unreadCount, markAllSeen } from './notifications.js';
import { addEvent, onEventAdded } from './data.js';
import { onAuthChange } from './api.js';
import { openModal } from './modal.js';
import { getPrefs } from './prefs.js';
import { toast } from './toast.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAIRS = [['bell-btn', 'bell-menu'], ['account-btn', 'account-menu']];

export const initials = name => String(name ?? '').trim().split(/\s+/)
  .filter(w => w && !/^(dr|prof)\.?$/i.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

export const roleText = () => {
  if (!workspace) return '';
  const label = workspace.roles?.includes('admin') ? 'IT administrator' : ROLES[session.role]?.label ?? '';
  return workspace.kind === 'staff' && workspace.unit && !workspace.roles.includes('admin') ? `${label} · ${workspace.unit}` : label;
};

export function closeMenus(exceptMenuId) {
  for (const [buttonId, menuId] of PAIRS) {
    const menu = $(menuId);
    if (!menu || menuId === exceptMenuId || menu.hidden) continue;
    menu.hidden = true;
    $(buttonId)?.setAttribute('aria-expanded', 'false');
  }
}

function toggle(buttonId, menuId) {
  const menu = $(menuId);
  const open = menu.hidden;
  closeMenus(menuId);
  menu.hidden = !open;
  $(buttonId).setAttribute('aria-expanded', String(open));
  return open;
}

function renderBell() {
  const list = $('bell-list');
  if (!list) return;
  const items = getBellItems();
  list.innerHTML = items.length
    ? items.map(i => `<a class="notif${i.unread ? ' unread' : ''}" href="${esc(i.target)}"><span class="notif-dot sev-${esc(i.severity)}" aria-hidden="true"></span><span class="notif-body"><strong>${esc(i.text)}</strong>${i.detail ? `<small>${esc(i.detail)}</small>` : ''}</span></a>`).join('')
    : '<p class="muted empty">You are all caught up.</p>';
}

function updateBadge() {
  const badge = $('bell-count');
  if (!badge) return;
  const n = unreadCount();
  const dotOnly = !getPrefs().showBellCount;
  badge.hidden = n === 0;
  badge.classList.toggle('dot', dotOnly);
  badge.textContent = dotOnly ? '' : n > 9 ? '9+' : String(n);
  $('bell-btn').setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
}

// Called after every page render and after account changes.
export function refreshTopbar() {
  if (!workspace || !$('account-btn')) return;
  $('account-avatar').textContent = initials(workspace.name);
  $('user-name').textContent = workspace.name ?? '';
  $('user-role').textContent = roleText();
  $('menu-name').textContent = workspace.name ?? '';
  $('menu-role').textContent = roleText();
  $('menu-refresh').hidden = !(workspace.kind === 'staff' && !workspace.roles.includes('admin'));
  const patientDemo = workspace.kind === 'patient';
  for (const id of ['bell-btn', 'menu-account-link', 'menu-settings-link']) {
    const item = $(id);
    if (item) item.hidden = patientDemo;
  }
  if (!patientDemo) { renderBell(); updateBadge(); }
}

function watch(id, callback) {
  const el = $(id);
  if (!el) return;
  new MutationObserver(() => callback(el.textContent.trim())).observe(el, { childList: true, characterData: true, subtree: true });
}

let mounted = false;
export function mountTopbar() {
  if (mounted) return;
  mounted = true;
  let refreshRequested = false;
  const signedOut = () => document.body.classList.contains('signed-out');

  $('bell-btn').addEventListener('click', () => {
    if (toggle('bell-btn', 'bell-menu')) { renderBell(); markAllSeen(); updateBadge(); }
  });
  $('account-btn').addEventListener('click', () => toggle('account-btn', 'account-menu'));
  for (const id of ['bell-menu', 'account-menu']) $(id).addEventListener('click', e => { if (e.target.closest('a')) closeMenus(); });
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) closeMenus(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = PAIRS.find(([, menuId]) => !$(menuId).hidden);
    closeMenus();
    if (open) $(open[0]).focus();
  });
  onAuthChange(() => closeMenus());

  // Refresh / Sign out press the original buttons that auth-ui.js already handles.
  $('menu-refresh').addEventListener('click', () => { closeMenus(); refreshRequested = true; toast('Refreshing equipment…'); $('database-refresh').click(); });
  $('menu-signout').addEventListener('click', () => { closeMenus(); $('database-signout').click(); });

  // Messages that used to sit in the status bar now appear as toasts.
  watch('database-status', () => { if (refreshRequested && !signedOut()) { refreshRequested = false; toast('Equipment updated.'); } });
  watch('database-auth-message', text => { if (text && !signedOut()) { refreshRequested = false; toast(text, { error: true }); } });

  onEventAdded(() => { if (workspace) { renderBell(); updateBadge(); } });

  // roles.js asks for this when a nurse tries something that needs a physician.
  const ACTIONS = { 'meds.administerControlled': 'administer this medication' };
  document.addEventListener('nexora:approval-needed', e => {
    const what = ACTIONS[e.detail?.cap] ?? 'complete this action';
    openModal({
      title: 'Physician approval required',
      submitLabel: 'Request approval',
      bodyHtml: `<p>A physician must approve this before you can ${esc(what)}. Send an approval request to the care team?</p>`,
      onSubmit() {
        addEvent({ audience: 'approvers', severity: 'warn', text: `Approval requested: ${what}`, detail: `${workspace?.name ?? 'A colleague'} · ${roleText()}`, target: '#/dashboard' });
        toast('Approval request sent.');
      },
    });
  });
}
