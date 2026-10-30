# Nexora Health

> Allocation upgrade: [Equipment allocation MVP](docs/ALLOCATION.md) supersedes the earlier direct-request/approve browser flow on this branch. Requests now enter an independently reviewed queue; source reserve configuration and Allocate next create the reserved transfer. See that guide for the exact priority/fairness policy, API contract, migration and verification limits.

Nexora Health is a capstone web prototype for hospital equipment visibility, controlled requests and supplier availability coordination. GitHub Pages hosts the interface; Supabase provides Auth and PostgreSQL for the connected equipment workflows. Patient, medicine and appointment examples remain synthetic.

## Start here

| Your question | Read |
| --- | --- |
| What did Farhan implement, why is release pending, and what happens next? | [Project guide](docs/PROJECT_GUIDE.md) |
| What can teammates call from their screens? | [Workflow API and handover](docs/FARHAN_WORKFLOWS.md) |
| What was actually verified on the hosted project? | [Dated status](docs/STATUS.md) |
| How do I install or upgrade safely? | [Deployment runbook](docs/DEPLOYMENT_RUNBOOK.md) |

## Current implementation and readiness

On the workflow branch, equipment demand enters a saved queue. Independent coordinators review priority and allocate the next eligible request under a source reserve and equal-unit sharing policy; successful allocation creates a reserved transfer. Requests and transfers reload from the database. A separate supplier backend supports hospital-only enquiries, reviewed sending and isolated supplier responses. Supplier screens and automatic refresh remain team integration work.

Migrations 07 and 08 were applied to the existing Nexora Health project on 30 October 2026. Local and hosted transactional tests passed. [PR #4](https://github.com/harman-06/capstone/pull/4) holds the website integration for review; this documentation does not claim it is merged or deployed to Pages. At verification, the three active Auth-linked profiles had no role assignments and supplier memberships were empty. Review those mappings before real-account acceptance and release.

Approval reserves an asset; it does not mark it delivered. Supplier availability does not increase hospital stock. The UI demo role picker is a preview and does not grant database permissions.

## Develop and test

Run `npm ci` then `npm test`. Tests use an isolated local database. GitHub Pages serves `index.html` directly; no frontend build is required. `js/` contains the interface and adapter, `database/` the SQL, `data/` synthetic samples, and `tests/` validation.

For the existing project, use reviewed additive migrations; never reset the database or rerun `00_schema.sql`. The applied upgrade order is `07_authenticated_workflows.sql`, `08_supplier_enquiries.sql`, then the two timestamped allocation migrations under `supabase/migrations/`. Use `09_workflow_health.sql` for read-only checks. Fresh installation details are in the runbook.

Keep passwords, database connection strings and secret/service-role keys out of the browser and repository. `js/config.js` contains only the public project URL and browser-safe key.
