BEGIN;
CREATE OR REPLACE FUNCTION nexora_private.nh_api_workspace() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('kind','staff','name',u.display_name,'unit',d.name,'roles',coalesce((SELECT jsonb_agg(DISTINCT r.role_key) FROM public.user_role_assignments a JOIN public.roles r USING(role_id) WHERE a.user_id=u.user_id),'[]'::jsonb)) INTO result
 FROM public.users u LEFT JOIN public.locations d ON d.location_id=u.home_department_id WHERE u.auth_subject=auth.uid() AND u.is_active;
 IF result IS NOT NULL THEN RETURN result; END IF;
 SELECT jsonb_build_object('kind','supplier','name',string_agg(s.name,', '),'unit','Supplier workspace','roles','[]'::jsonb) INTO result
 FROM public.nh_supplier_memberships m JOIN public.nh_suppliers s USING(supplier_id) WHERE m.auth_subject=auth.uid() AND m.is_active AND s.is_active HAVING count(*)>0;
 IF result IS NULL THEN RAISE EXCEPTION 'Account has no active workspace. Contact your administrator.' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION nexora_private.nh_api_workspace() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION nexora_private.nh_api_workspace() TO authenticated;
CREATE OR REPLACE FUNCTION public.nh_api_workspace() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT nexora_private.nh_api_workspace(); $$;
REVOKE ALL ON FUNCTION public.nh_api_workspace() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_workspace() TO authenticated;
COMMIT;
