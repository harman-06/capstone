# Nexora Health: sprint 1 template
GitHub Pages: push, then Settings > Pages > deploy from branch.

Build order (files grouped by step):
1. Shell: index.html, css/style.css, js/main.js, js/router.js, js/nav.js
2. Permissions: js/roles.js (roles, can(), applyPermissions)
3. Data: js/data.js, data/*.json (fake data only)
4. Dashboard: js/widgets.js, js/pages/dashboard.js
5. Placeholder pages: js/pages/other.js
Use the "Demo role" dropdown to switch roles.



## Lean v3 Supabase integration

See docs/DEPLOYMENT_RUNBOOK.md for the beginner setup guide, docs/STATUS.md for what was verified live, and docs/CHANGES.md for the corrections. Equipment reads use real Supabase Auth and protected database views. UI demo roles remain previews; patient/medicine data remains synthetic JSON. Transfer requests in the website remain placeholders; database workflows are trusted SQL-only.

Run `npm install` then `npm test` for local isolated database and adapter tests. GitHub Pages serves index.html and needs no build. Never upload node_modules, .env files, secret keys, or database passwords. js/config.js contains only public browser values.
