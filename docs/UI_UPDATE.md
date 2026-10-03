# Staff workspace interface update

The site now opens on a dedicated sign-in screen. Navigation and routed content remain hidden until Supabase Auth succeeds, and hide immediately when sign-out begins. Failed sign-in keeps the workspace closed. Sessions remain in memory and end when the page reloads.

The staff interface uses white cards, slate text, teal accents, consistent controls, navigation icons, active-page indicators and visible keyboard focus. The sign-in layout adapts to phones. Inventory supports item-name search combined with a unit filter, visible item counts and a clear empty state; existing Request links and role controls are preserved.

## Validation

- Isolated SQL schema, workflow, seed, RLS and validation checks passed.
- Five frontend tests passed, including failed-login visibility, immediate sign-out hiding, combined inventory filters, empty results and preserved Request navigation.
- Uploaded source files were compared with local Git blob hashes before merging.

## Current scope

The visual gate controls what the website displays. Static patient, appointment and medicine JSON remains publicly hosted synthetic demonstration data; this change does not make GitHub Pages files private. Supabase RLS protects real equipment reads. Preview roles affect the demonstration interface and never grant database permissions.

The Request page shows item details and explains that no request has been submitted. Online transfer submission remains unfinished; database workflow functions are restricted to trusted SQL execution.

New staff accounts require a Supabase Auth email and a matching active public.users profile. The requested test username has not been created by this UI update. No passwords or secret keys are stored in these source files.
