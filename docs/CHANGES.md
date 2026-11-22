# Lean v3 corrections
- All 15 public tables have row-level security and explicit browser grants.
- Anonymous access is denied. Active public.users membership is required for inventory reads.
- Views run as the caller; private views are not granted to browsers.
- Workflow function execution is revoked from PUBLIC/anon/authenticated. Trusted SQL-only functions validate active scoped actors, approval policies, source/availability and transition order.
- Asset row locks plus a partial unique index protect reservations; validation checks competing requests. True concurrent-session stress tests have not been run.
- Added request/cancel functions and audit records for every transfer event.
- Inventory IDs include department and full category UUID, avoiding collisions across units.
- Zero-stock combinations are based on configured thresholds; missing asset categories now appear as out.
- NULL category approval policies deduplicate on repeated seed execution.
- Hierarchy trigger rejects invalid parents/cycles.
- Correct publishable-key headers and actual staff sign-in; tokens remain in memory and are never printed or stored in config.
- Configured connection errors clear equipment instead of silently falling back. Unconfigured demo mode remains explicit; medicine demo inventory is preserved.
- Removed duplicated role-switcher element ID.
- Database schema setup refuses existing tables. No DROP, TRUNCATE, reset, or deletion migration is included.

## Interface update (Nov 2026)
- Dashboard copy now reads as a product: time-of-day greeting by name, role and department above it, quick links, no tutorial cards.
- Top bar: notification bell and account menu (View account, Settings, Refresh equipment, Sign out). The old connection status bar is removed once signed in; messages appear as toasts.
- Patients, patient profile (notes, booking) and Appointments pages are back, with field-level masking for roles that cannot see sensitive details.
- Patient accounts: own home page and profile, with editable contact details, measurements, allergies and emergency contact. Changes are visible to staff accounts for the page session only (in memory) until patient data moves into the database.
- Sidebar collapses to an icon rail on desktop and hides on phones; clicking outside it collapses it again.
- Shared files touched: js/main.js, js/nav.js, js/roles.js, js/workspace.js (accepts kind "patient"), js/data.js (additions at the end plus one line in scoped()), js/pages/operations.js (copy), js/pages/inventory-item.js (alert popups replaced by toasts).
- Database follow-up: the workspace function must return { kind: 'patient', name, patientId } for patient accounts, and patient edits, notes and appointments need tables with row-level security.
