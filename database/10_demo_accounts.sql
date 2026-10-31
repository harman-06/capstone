BEGIN;
-- Link the seeded profiles (they already carry roles and unit scope)
UPDATE public.users SET auth_subject='dc3ebd77-86ad-42df-abdc-2212b4667491' WHERE email='nadia.ali@example.test' AND auth_subject IS NULL;
UPDATE public.users SET auth_subject='791232ba-6883-42dd-8a13-53a18b8effea'        WHERE email='eli.brown@example.test'  AND auth_subject IS NULL;
UPDATE public.users SET auth_subject='a6f609c4-bca4-4a3b-9e33-e18a15b99a08'        WHERE email='sam.lee@example.test'    AND auth_subject IS NULL;

-- Emergency charge nurse, scoped to the Emergency department only
INSERT INTO public.users(auth_subject,email,display_name,home_department_id)
SELECT '<ER_UUID>','er.charge@example.test','ER Test Charge Nurse',location_id FROM public.locations WHERE code='ER';
INSERT INTO public.user_role_assignments(user_id,role_id,scope_location_id)
SELECT u.user_id,r.role_id,d.location_id FROM public.users u,public.roles r,public.locations d
WHERE u.email='er.charge@example.test' AND r.role_key='chargeNurse' AND d.code='ER';

-- Two suppliers under the hospital, one membership each
INSERT INTO public.nh_suppliers(hospital_id,name)
SELECT location_id,'Demo Supplier A' FROM public.locations WHERE code='NDH' ON CONFLICT DO NOTHING;
INSERT INTO public.nh_suppliers(hospital_id,name)
SELECT location_id,'Demo Supplier B' FROM public.locations WHERE code='NDH' ON CONFLICT DO NOTHING;
INSERT INTO public.nh_supplier_memberships(auth_subject,supplier_id)
SELECT '<SUPPLIER_A_UUID>',supplier_id FROM public.nh_suppliers WHERE name='Demo Supplier A' ON CONFLICT DO NOTHING;
INSERT INTO public.nh_supplier_memberships(auth_subject,supplier_id)
SELECT '<SUPPLIER_B_UUID>',supplier_id FROM public.nh_suppliers WHERE name='Demo Supplier B' ON CONFLICT DO NOTHING;
COMMIT;
