# Deployment status — 2026-10-03

Live Supabase project: Nexora Health (olbvwbytgfnxizxzssok).
Existing public schema was empty before installation.

Installed corrected files 00 through 04, then ran 05 validation on live PostgreSQL 17.
Live checks passed: 9 assets, 3 units, 18 inventory rows, all 15 tables with RLS.
Transfer tests passed and rolled back: no permanent test transfers or audit records.
Verified live authenticated role isolation using a transaction-local simulated Auth subject: unprovisioned reads return no rows; a temporary active member sees 3 units, 18 inventory rows, and only their own profile. Membership was rolled back.
Local npm test passed, including SQL execution, repeat seed, anonymous denial, direct write denial, workflow EXECUTE denial, token header correctness and explicit connection failure display.

A dedicated frontend Auth account was created and linked to an active database member. GitHub collaborator access was confirmed; the connected integration cannot write, so the authorized browser fallback is deploying the tested files on branch nexora-lean-v3. Real frontend login and Pages publication are the final deployment checks.

Do not rerun 00 on this project. Scripts in this package are for reproduction on a fresh database. For existing projects use reviewed migrations.

Frontend js/config.js now includes the project URL and browser-safe publishable key only. Secret/service-role keys and database passwords were not read or copied.

Live anonymous Data API access to frontend_units_v returned HTTP 401 (denied). Actual frontend-account login remains pending.
