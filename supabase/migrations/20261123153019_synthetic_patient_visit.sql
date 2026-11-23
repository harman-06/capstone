BEGIN;

CREATE TABLE IF NOT EXISTS nexora_private.nh_demo_patient_visits (
 auth_subject uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 100),
 starts_at timestamptz NOT NULL CHECK(isfinite(starts_at)),
 clinic text NOT NULL CHECK(length(trim(clinic)) BETWEEN 1 AND 120),
 checklist text[] NOT NULL DEFAULT '{}' CHECK(cardinality(checklist)<=8),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at>starts_at)
);
ALTER TABLE nexora_private.nh_demo_patient_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE nexora_private.nh_demo_patient_visits FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION nexora_private.nh_demo_patient_name()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT v.display_name FROM nexora_private.nh_demo_patient_visits v
 WHERE v.auth_subject=(SELECT auth.uid()) AND v.expires_at>statement_timestamp()
  AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.auth_subject=v.auth_subject AND u.is_active)
  AND NOT EXISTS(SELECT 1 FROM public.nh_supplier_memberships m
   JOIN public.nh_suppliers s USING(supplier_id)
   WHERE m.auth_subject=v.auth_subject AND m.is_active AND s.is_active);
$$;
REVOKE ALL ON FUNCTION nexora_private.nh_demo_patient_name() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_my_visit() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF nexora_private.nh_demo_patient_name() IS NULL THEN
  RAISE EXCEPTION 'An active patient demo account is required' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('starts_at',v.starts_at,'clinic',v.clinic,'checklist',v.checklist)
 INTO result FROM nexora_private.nh_demo_patient_visits v
 WHERE v.auth_subject=(SELECT auth.uid()) AND v.expires_at>statement_timestamp();
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.nh_api_my_visit() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT nexora_private.nh_api_my_visit();
$$;
REVOKE ALL ON FUNCTION public.nh_api_my_visit(),nexora_private.nh_api_my_visit() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_my_visit(),nexora_private.nh_api_my_visit() TO authenticated;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_workspace() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; patient_name text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
 patient_name:=nexora_private.nh_demo_patient_name();
 IF patient_name IS NOT NULL THEN
  RETURN jsonb_build_object('kind','patient','name',patient_name,'unit','Patient workspace','roles','[]'::jsonb);
 END IF;
 SELECT jsonb_build_object('kind','staff','name',u.display_name,'unit',d.name,'roles',coalesce((SELECT jsonb_agg(DISTINCT r.role_key) FROM public.user_role_assignments a JOIN public.roles r USING(role_id) WHERE a.user_id=u.user_id),'[]'::jsonb)) INTO result
 FROM public.users u LEFT JOIN public.locations d ON d.location_id=u.home_department_id WHERE u.auth_subject=auth.uid() AND u.is_active;
 IF result IS NOT NULL THEN RETURN result; END IF;
 SELECT jsonb_build_object('kind','supplier','name',string_agg(s.name,', '),'unit','Supplier workspace','roles','[]'::jsonb) INTO result
 FROM public.nh_supplier_memberships m JOIN public.nh_suppliers s USING(supplier_id) WHERE m.auth_subject=auth.uid() AND m.is_active AND s.is_active HAVING count(*)>0;
 IF result IS NULL THEN RAISE EXCEPTION 'Account has no active workspace. Contact your administrator.' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;

COMMIT;
