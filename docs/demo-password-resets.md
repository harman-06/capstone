# Demo password resets

The IT administration page can replace the password for the confirmed, active synthetic nurse, coordinator, two suppliers and patient accounts. The reset cannot be used for the IT administrator or arbitrary accounts. The hospital assignment, active session and approved authenticator are checked server-side. The generated password is displayed once for private handoff. It remains valid until changed again.

## Enable on a demo project

1. Apply the migration and deploy the Supabase Edge Function named demo-reset-password. Keep NEXORA_DEMO_RESET_ENABLED unset while setting up the administrator. The function uses its Supabase-provided service key on the server and validates incoming user tokens with Supabase Auth.
2. Privately rotate the IT Admin's existing shared demo password to a unique password, revoke its old sessions and review its enrolled factors. In the demo site's public configuration, set demoPasswordReset to true. Sign in as the IT Admin and use **Set up authenticator** to add and verify a TOTP factor on the administrator's device if needed.
3. In the Supabase project, identify the approved verified TOTP factor for it.admin@nexora.example. Set its ID as the Edge Function setting NEXORA_DEMO_RESET_FACTOR_ID. Configure NEXORA_DEMO_RESET_ORIGIN if the demo uses a different origin from https://harman-06.github.io. Set NEXORA_DEMO_RESET_ENABLED to true only after these checks.
4. Use **Reset a demo password** on the IT administration page and verify with the approved device. On a disposable demo project, confirm that the old password fails, the new one works, other accounts are unaffected and a non-admin account cannot reset passwords.

TOTP setup keys, generated passwords and service credentials should be kept out of group messages, screenshots and Git. If an administrator changes devices, approve the replacement factor in the Edge Function settings before resuming resets.

## Audit and session behavior

The private nh_demo_password_reset_audit table records actor, target, request time and completion time without a password or token. The operator can review attempts with an empty completion time to investigate ambiguous outcomes. Attempts on the same target are throttled for two minutes. After a confirmed password change, the database removes the target's refreshable sessions. Already-issued access tokens can remain valid until they expire. If the change could not be confirmed, consult the Supabase project operator before retrying.

The review branch does not apply the migration, deploy the Edge Function or modify hosted accounts.
