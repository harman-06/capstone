# Nexora Health: sprint 1 template
Run locally (modules and fetch need a server): `python -m http.server 8000`, then open http://localhost:8000
GitHub Pages: push, then Settings > Pages > deploy from branch.

Build order (files grouped by step):
1. Shell: index.html, css/style.css, js/main.js, js/router.js, js/nav.js
2. Permissions: js/roles.js (roles, can(), applyPermissions)
3. Data: js/data.js, data/*.json (fake data only)
4. Dashboard: js/widgets.js, js/pages/dashboard.js
5. Placeholder pages: js/pages/other.js
Use the "Demo role" dropdown to switch roles.
