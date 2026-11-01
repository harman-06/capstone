BEGIN;
-- Only an active hospital-scoped IT admin can inspect account metadata.
-- Never return credentials, tokens, authentication identities or raw metadata.
CREATE OR REPLACE FUNCTION nexora_private.nh_api_account_monitor() RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE hospital uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
 SELECT l.location_id INTO hospital FROM public.users u JOIN public.user_role_assignments a USING(user_id)
 JOIN public.roles r USING(role_id) JOIN public.locations l ON l.location_id=a.scope_location_id
 WHERE u.auth_subject=auth.uid() AND u.is_active AND r.role_key='admin' AND l.location_type='hospital' AND l.is_active LIMIT 1;
 IF hospital IS NULL THEN RAISE EXCEPTION 'Hospital IT administrator access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT jsonb_build_object('email',au.email,'name',coalesce(u.display_name,'Supplier account'),
 'active',coalesce(u.is_active,EXISTS(SELECT 1 FROM public.nh_supplier_memberships m JOIN public.nh_suppliers s USING(supplier_id) WHERE m.auth_subject=au.id AND m.is_active AND s.is_active AND s.hospital_id=hospital)),
 'confirmed',au.email_confirmed_at IS NOT NULL,'last_sign_in',au.last_sign_in_at,
 'roles',coalesce((SELECT jsonb_agg(jsonb_build_object('role',r.display_name,'scope',l.name)) FROM public.user_role_assignments a JOIN public.roles r USING(role_id) JOIN public.locations l ON l.location_id=a.scope_location_id WHERE a.user_id=u.user_id AND (l.location_id=hospital OR l.parent_location_id=hospital)),'[]'::jsonb),
 'suppliers',coalesce((SELECT jsonb_agg(s.name) FROM public.nh_supplier_memberships m JOIN public.nh_suppliers s USING(supplier_id) WHERE m.auth_subject=au.id AND m.is_active AND s.hospital_id=hospital),'[]'::jsonb))
 FROM auth.users au LEFT JOIN public.users u ON u.auth_subject=au.id
 WHERE EXISTS(SELECT 1 FROM public.locations d WHERE d.location_id=u.home_department_id AND (d.location_id=hospital OR d.parent_location_id=hospital))
 OR EXISTS(SELECT 1 FROM public.user_role_assignments a WHERE a.user_id=u.user_id AND a.scope_location_id=hospital)
 OR EXISTS(SELECT 1 FROM public.nh_supplier_memberships m JOIN public.nh_suppliers s USING(supplier_id) WHERE m.auth_subject=au.id AND s.hospital_id=hospital)
 ORDER BY au.email;
END $$;
REVOKE ALL ON FUNCTION nexora_private.nh_api_account_monitor() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION nexora_private.nh_api_account_monitor() TO authenticated;
CREATE OR REPLACE FUNCTION public.nh_api_account_monitor() RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM nexora_private.nh_api_account_monitor(); $$;
REVOKE ALL ON FUNCTION public.nh_api_account_monitor() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_account_monitor() TO authenticated;
COMMIT;
