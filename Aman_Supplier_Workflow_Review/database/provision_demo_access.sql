-- Trusted administrator script for Nexora project olbvwbytgfnxizxzssok.
-- Run AFTER privately creating and confirming the four Supabase Auth demo users.
-- Creates no passwords, does not edit auth.users, and never removes existing access.
-- These reserved .example addresses are local demo identities, not email inboxes.
BEGIN;
DO $$
DECLARE expected record; subject uuid; department uuid; existing public.users%ROWTYPE; hospital uuid; organisation uuid;
BEGIN
 SELECT location_id INTO STRICT hospital FROM public.locations WHERE code='NDH' AND location_type='hospital' AND is_active;
 -- Fail the whole transaction rather than partially provisioning or reusing a conflicting identity.
 FOR expected IN SELECT * FROM (VALUES
 ('nurse.demo@nexora.example','Nexora Demo Nurse','CARD','nurse'),
 ('coordinator.demo@nexora.example','Nexora Demo Coordinator','ER','chargeNurse'),
 ('supplier.a@nexora.example','Nexora Demo Supplier A',NULL,NULL),
 ('supplier.b@nexora.example','Nexora Demo Supplier B',NULL,NULL)
 ) x(email,label,department_code,role_key)
 LOOP
  SELECT id INTO subject FROM auth.users WHERE lower(email)=expected.email AND email_confirmed_at IS NOT NULL;
  IF subject IS NULL THEN RAISE EXCEPTION 'Create and confirm Auth demo account % privately first; no mappings were changed',expected.email; END IF;
  IF expected.role_key IS NOT NULL THEN
   SELECT location_id INTO STRICT department FROM public.locations WHERE code=expected.department_code AND location_type='department' AND is_active AND parent_location_id=hospital;
   IF EXISTS(SELECT 1 FROM public.nh_supplier_memberships WHERE auth_subject=subject)
   THEN RAISE EXCEPTION 'Staff demo identity already has supplier membership; review manually'; END IF;
   SELECT * INTO existing FROM public.users WHERE email=expected.email;
   IF FOUND AND (existing.auth_subject IS DISTINCT FROM subject OR existing.home_department_id IS DISTINCT FROM department OR NOT existing.is_active)
   THEN RAISE EXCEPTION 'Existing profile conflicts with intended demo mapping for %; review manually',expected.email; END IF;
   IF EXISTS(SELECT 1 FROM public.users WHERE auth_subject=subject AND email IS DISTINCT FROM expected.email)
   THEN RAISE EXCEPTION 'Auth identity is already linked to another profile'; END IF;
   IF EXISTS(SELECT 1 FROM public.users u JOIN public.user_role_assignments a USING(user_id) JOIN public.roles r USING(role_id)
    WHERE u.auth_subject=subject AND (r.role_key<>expected.role_key OR (a.scope_location_id<>department AND NOT (expected.email='coordinator.demo@nexora.example' AND a.scope_location_id IN (SELECT location_id FROM public.locations WHERE code='CARD' AND parent_location_id=hospital AND is_active)))))
   THEN RAISE EXCEPTION 'Demo staff account has additional roles; review rather than silently changing access'; END IF;
   INSERT INTO public.users(auth_subject,email,display_name,home_department_id)
   VALUES(subject,expected.email,expected.label,department) ON CONFLICT(email) DO NOTHING;
   INSERT INTO public.user_role_assignments(user_id,role_id,scope_location_id)
   SELECT u.user_id,r.role_id,department FROM public.users u JOIN public.roles r ON r.role_key=expected.role_key
   WHERE u.auth_subject=subject ON CONFLICT DO NOTHING;
  ELSE
   IF EXISTS(SELECT 1 FROM public.users WHERE auth_subject=subject OR email=expected.email)
   THEN RAISE EXCEPTION 'Supplier demo identity must not have hospital membership'; END IF;
   INSERT INTO public.nh_suppliers(hospital_id,name) VALUES(hospital,expected.label) ON CONFLICT(hospital_id,name) DO NOTHING;
   SELECT supplier_id INTO STRICT organisation FROM public.nh_suppliers WHERE hospital_id=hospital AND name=expected.label AND is_active;
   IF EXISTS(SELECT 1 FROM public.nh_supplier_memberships WHERE auth_subject=subject AND (supplier_id<>organisation OR NOT is_active))
   THEN RAISE EXCEPTION 'Supplier identity already has a conflicting membership; review manually'; END IF;
   INSERT INTO public.nh_supplier_memberships(auth_subject,supplier_id) VALUES(subject,organisation) ON CONFLICT DO NOTHING;
  END IF;
 END LOOP;
 -- Coordinator covers the nurse's Cardiology unit as well as Emergency.
 INSERT INTO public.user_role_assignments(user_id,role_id,scope_location_id)
 SELECT u.user_id,r.role_id,l.location_id FROM public.users u JOIN public.roles r ON r.role_key='chargeNurse' JOIN public.locations l ON l.code='CARD' AND l.parent_location_id=hospital AND l.is_active WHERE u.email='coordinator.demo@nexora.example' ON CONFLICT DO NOTHING;
 ASSERT (SELECT count(*) FROM public.users u JOIN public.user_role_assignments a USING(user_id) WHERE u.email IN ('nurse.demo@nexora.example','coordinator.demo@nexora.example'))=3,'Expected exactly three scoped demo staff assignments';
 ASSERT (SELECT count(*) FROM public.nh_supplier_memberships m JOIN auth.users u ON u.id=m.auth_subject WHERE u.email IN ('supplier.a@nexora.example','supplier.b@nexora.example') AND m.is_active)=2,'Expected two isolated supplier memberships';
END $$;
COMMIT;
SELECT 'Demo access configured: nurse/Cardiology, coordinator/Emergency and Cardiology, separate suppliers A/B. Existing personal accounts unchanged.' AS result;
