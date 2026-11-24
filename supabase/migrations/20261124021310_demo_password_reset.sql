BEGIN;

CREATE TABLE nexora_private.nh_demo_password_reset_audit (
  reset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  target_id uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz
);
ALTER TABLE nexora_private.nh_demo_password_reset_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nexora_private.nh_demo_password_reset_audit FROM PUBLIC, anon, authenticated;

CREATE FUNCTION nexora_private.nh_begin_demo_password_reset(actor uuid, session_id uuid, factor uuid, target text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE hospital uuid; recipient uuid; operation uuid;
BEGIN
  SELECT l.location_id INTO hospital
  FROM public.users u JOIN public.user_role_assignments a USING (user_id)
  JOIN public.roles r USING (role_id)
  JOIN public.locations l ON l.location_id=a.scope_location_id
  JOIN auth.users au ON au.id=u.auth_subject
  WHERE u.auth_subject=actor AND au.email='it.admin@nexora.example' AND u.is_active
    AND r.role_key='admin' AND l.location_type='hospital' AND l.is_active AND l.code='NDH';

  IF hospital IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions s WHERE s.id=session_id AND s.user_id=actor AND s.aal='aal2' AND s.factor_id=factor
      AND EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.id=factor AND f.user_id=actor
        AND f.status='verified' AND f.factor_type='totp')
      AND (s.not_after IS NULL OR s.not_after>now())
  ) THEN RETURN NULL; END IF;

  SELECT au.id INTO recipient FROM auth.users au
  WHERE au.email=target AND au.id<>actor AND au.email_confirmed_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.users u JOIN public.user_role_assignments a USING (user_id)
      JOIN public.roles r USING (role_id)
      WHERE u.auth_subject=au.id AND r.role_key NOT IN ('nurse','chargeNurse')
    )
    AND CASE
      WHEN target='nurse.demo@nexora.example' THEN EXISTS (
        SELECT 1 FROM public.users u JOIN public.user_role_assignments a USING (user_id)
        JOIN public.roles r USING (role_id)
        JOIN public.locations l ON l.location_id=a.scope_location_id
        WHERE u.auth_subject=au.id AND u.is_active AND r.role_key='nurse'
          AND l.parent_location_id=hospital AND l.is_active
      )
      WHEN target='coordinator.demo@nexora.example' THEN EXISTS (
        SELECT 1 FROM public.users u JOIN public.user_role_assignments a USING (user_id)
        JOIN public.roles r USING (role_id)
        JOIN public.locations l ON l.location_id=a.scope_location_id
        WHERE u.auth_subject=au.id AND u.is_active AND r.role_key='chargeNurse'
          AND l.parent_location_id=hospital AND l.is_active
      )
      WHEN target IN ('supplier.a@nexora.example', 'supplier.b@nexora.example') THEN EXISTS (
        SELECT 1 FROM public.nh_supplier_memberships m JOIN public.nh_suppliers s USING (supplier_id)
        WHERE m.auth_subject=au.id AND m.is_active AND s.is_active AND s.hospital_id=hospital
      )
      WHEN target='patient.demo@nexora.example' THEN EXISTS (
        SELECT 1 FROM nexora_private.nh_demo_patient_visits v WHERE v.auth_subject=au.id AND v.expires_at>now()
      ) AND NOT EXISTS (
        SELECT 1 FROM public.users u WHERE u.auth_subject=au.id AND u.is_active
      ) AND NOT EXISTS (
        SELECT 1 FROM public.nh_supplier_memberships m WHERE m.auth_subject=au.id AND m.is_active
      )
      ELSE false
    END;
  IF recipient IS NULL THEN RETURN NULL; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(recipient::text, 0));
  IF EXISTS (
    SELECT 1 FROM nexora_private.nh_demo_password_reset_audit e
    WHERE e.target_id=recipient AND e.requested_at>clock_timestamp()-interval '2 minutes'
  ) THEN RETURN jsonb_build_object('busy',true); END IF;
  INSERT INTO nexora_private.nh_demo_password_reset_audit (actor_id,target_id)
    VALUES (actor,recipient) RETURNING reset_id INTO operation;
  RETURN jsonb_build_object('reset_id',operation,'target_id',recipient);
END $$;

CREATE FUNCTION nexora_private.nh_finish_demo_password_reset(operation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient uuid;
BEGIN
  UPDATE nexora_private.nh_demo_password_reset_audit
  SET completed_at=clock_timestamp()
  WHERE reset_id=operation AND completed_at IS NULL
  RETURNING target_id INTO recipient;
  IF recipient IS NULL THEN RETURN false; END IF;
  DELETE FROM auth.sessions WHERE user_id=recipient;
  RETURN true;
END $$;

CREATE FUNCTION public.nh_begin_demo_password_reset(actor uuid, session_id uuid, factor uuid, target text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT nexora_private.nh_begin_demo_password_reset(actor,session_id,factor,target)
$$;
CREATE FUNCTION public.nh_finish_demo_password_reset(operation uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT nexora_private.nh_finish_demo_password_reset(operation)
$$;

REVOKE ALL ON FUNCTION public.nh_begin_demo_password_reset(uuid,uuid,uuid,text),
  public.nh_finish_demo_password_reset(uuid), nexora_private.nh_begin_demo_password_reset(uuid,uuid,uuid,text),
  nexora_private.nh_finish_demo_password_reset(uuid) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA nexora_private TO service_role;
GRANT EXECUTE ON FUNCTION public.nh_begin_demo_password_reset(uuid,uuid,uuid,text),
  public.nh_finish_demo_password_reset(uuid), nexora_private.nh_begin_demo_password_reset(uuid,uuid,uuid,text),
  nexora_private.nh_finish_demo_password_reset(uuid) TO service_role;
COMMIT;
