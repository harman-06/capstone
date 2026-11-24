-- Read-only verification after applying 07 and 08 in the intended hosted project.
SELECT version,applied_at FROM public.nh_schema_migrations ORDER BY version;
SELECT n.nspname AS schema_name,p.proname AS function_name,p.prosecdef AS security_definer,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anonymous_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','nexora_private') AND p.proname LIKE 'nh_api_%'
ORDER BY n.nspname,p.proname;
-- Expect every public wrapper to be invoker, anon false, authenticated true.
SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled,
 has_table_privilege('authenticated',c.oid,'SELECT') AS direct_authenticated_read,
 has_table_privilege('authenticated',c.oid,'INSERT') AS direct_authenticated_insert
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('nh_schema_migrations','nh_suppliers',
 'nh_supplier_memberships','nh_supply_enquiries','nh_supply_events') ORDER BY c.relname;
-- Expect RLS true and direct authenticated access false for every new table.
SELECT count(*) AS active_hospital_profiles,
 count(*) FILTER(WHERE auth_subject IS NOT NULL) AS mapped_auth_profiles
FROM public.users WHERE is_active;
-- Counts only: do not export profile credentials or unrelated personal records.
