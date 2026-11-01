BEGIN;
DO $$ DECLARE subject uuid; hospital uuid; BEGIN
 SELECT id INTO subject FROM auth.users WHERE email='it.admin@nexora.example' AND email_confirmed_at IS NOT NULL;
 IF subject IS NULL THEN RAISE EXCEPTION 'Confirmed IT account required'; END IF;
 SELECT location_id INTO STRICT hospital FROM public.locations WHERE code='NDH' AND location_type='hospital' AND is_active;
 IF EXISTS(SELECT 1 FROM public.users WHERE email='it.admin@nexora.example' AND auth_subject IS DISTINCT FROM subject) THEN RAISE EXCEPTION 'Conflicting IT identity'; END IF;
 INSERT INTO public.users(auth_subject,email,display_name) VALUES(subject,'it.admin@nexora.example','Nexora IT Administrator') ON CONFLICT(email) DO NOTHING;
 INSERT INTO public.user_role_assignments(user_id,role_id,scope_location_id) SELECT u.user_id,r.role_id,hospital FROM public.users u CROSS JOIN public.roles r WHERE u.auth_subject=subject AND r.role_key='admin' ON CONFLICT DO NOTHING;
 -- Coordinator needs Cardiology review scope for the existing nurse's supply enquiries.
 INSERT INTO public.user_role_assignments(user_id,role_id,scope_location_id) SELECT u.user_id,r.role_id,l.location_id FROM public.users u CROSS JOIN public.roles r CROSS JOIN public.locations l WHERE u.email='coordinator.demo@nexora.example' AND u.is_active AND r.role_key='chargeNurse' AND l.code='CARD' AND l.parent_location_id=hospital ON CONFLICT DO NOTHING;
END $$;
COMMIT;
