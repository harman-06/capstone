-- OPTIONAL: run only after YOU create a frontend test user in Authentication > Users.
-- Replace both placeholders. This is NOT part of initial schema installation.
INSERT INTO public.users(auth_subject,email,display_name)
VALUES ('REPLACE_WITH_AUTH_USER_UUID'::uuid,'YOUR_TEST_EMAIL','Nexora Test Member');
