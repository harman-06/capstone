# Nexora Health

Nexora Health is a capstone prototype for hospital equipment readiness, internal transfers and external supplier enquiries. GitHub Pages serves the frontend. Supabase Auth and PostgreSQL provide account access, inventory and workflow state.

## Demo the prototype

- Open the [deployed site](https://harman-06.github.io/capstone/) and sign in with an assigned demo account. Obtain credentials privately from the project owner.
- Start in Inventory or Readiness. Live quantities, equipment states and configured source reserves come from Supabase.
- Open Requests to follow equipment needs through independent review, allocation, dispatch and receipt. Receipt moves the asset and releases the reservation.
- If no internal stock is available, start a supplier enquiry from the equipment request form. A separate authorized coordinator sends it, and the assigned supplier can respond with availability and an estimated delivery date.

See the [Sprint 3 release and verification guide](docs/SPRINT_3_RELEASE.md) for role-specific demo steps, database checks and current prototype limits. Patient, medicine and appointment examples are synthetic.

## Develop and test

Run `npm ci` and `npm test`. Run `npm run test:concurrency` against a [fresh disposable PostgreSQL database](tests/README.md) to exercise independent concurrent sessions. Serve the root with a local static HTTP server, for example `python -m http.server 3000`. The app has no build step.

- [Architecture](docs/ARCHITECTURE.md)
- [Allocation policy](docs/ALLOCATION.md)
- [Deployment and migration instructions](docs/DEPLOYMENT_RUNBOOK.md)
- [Historical project notes](docs/PROJECT_GUIDE.md)

The browser configuration contains the Supabase publishable key. Keep credentials and privileged keys out of the repository. Deploy additive migrations only after isolated testing and before frontend code that depends on them.
