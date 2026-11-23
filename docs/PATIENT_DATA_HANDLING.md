# Synthetic patient demo and account handling

The My Visit frontend and migration are deployed. The 23 November 2026 check found no hosted synthetic visit assignments.

## What the proof of concept stores

My Visit shows one fictional appointment per dedicated demo patient: a display name, appointment time, clinic, and preparation checklist. The visit is linked to the Supabase Auth account UUID. Its database record includes an expiry date. No real patient identifiers, contact details, charts, health numbers, diagnoses, uploads or messages belong in this demonstration.

GitHub Pages serves the frontend. The identified Nexora Supabase project is in US East. Auth and the visit record belong in Supabase, with no patient records or credentials in the repository, public assets, analytics or console output. Confirm the environment’s actual backup and log retention in the Supabase dashboard before provisioning. Backup expiry follows the project settings separately from row deletion.

## Access and expiry

The demo uses dedicated accounts with no staff or supplier membership. The visit table is private, with row-level security and no client table grants. One authenticated function derives the owner from the session, returns only the visit time, clinic and checklist, and denies expired or mismatched accounts. Test with two synthetic patients and separate staff and supplier identities.

The proposed demo cleanup date is 30 days after final grading, subject to the course requirements. The project owner records the approved date, sets `expires_at` when assigning visits and uses a trusted admin process to remove confirmed demo identities and their visits at cleanup. Expiry blocks app access. It does not by itself delete stored rows, backups or logs. Record completion and confirm backup and log expiry separately.

### Provision the demo after review

1. Create or invite two test users in the Supabase Auth dashboard using addresses controlled by the team. Set individual credentials privately. Do not link these identities to staff or supplier memberships.
2. In a trusted SQL session, add one row to `nexora_private.nh_demo_patient_visits` per Auth UUID. Use fictional display names, appointment times later than today, fictional clinics and a generic preparation checklist. Set the agreed expiry after both appointment dates. The app treats records past expiry as unavailable.
3. Sign in separately as each patient. Verify each sees the assigned visit only, and verify that Inventory, Requests and Supply enquiries are unavailable. Confirm staff and supplier accounts still open their normal workspaces.

## Account inventory and cleanup

The read-only review found five scoped identities: an IT administrator, a coordinator, a nurse and two supplier accounts. The second supplier is needed for an organization-isolation test. Three other Auth accounts are linked to active staff profiles with no assigned role. Two have signed in previously. Review their ownership and audit references before changing access. An empty role alone does not prove that the account is safe to delete.

Keep individual accounts with documented owners and the minimum necessary roles. Use approved, recognizable email labels for demo accounts, and private account invitations or password-reset flows for credentials. Use unique passwords. Rotate shared demo credentials after confirming the team’s access and avoid posting passwords in chats or source files. Disable an agreed unused account and verify access first. Delete only after confirming ownership, retention and audit dependencies.

## Before any real patient data

This is an OIPC-informed demo design. An Alberta healthcare custodian would need to determine applicable requirements, review hosting and external processing agreements, approve retention and incident procedures, and assess privacy impacts before a real rollout. See the [OIPC privacy impact assessment guidance](https://oipc.ab.ca/privacy-impact-assessments/), the [OIPC guidance on processing outside Alberta](https://oipc.ab.ca/resource/privacy-impact-assessments-frequently-asked-questions/) and [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups).
