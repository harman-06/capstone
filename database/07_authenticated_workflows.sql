BEGIN;
CREATE SCHEMA IF NOT EXISTS nexora_private;
REVOKE ALL ON SCHEMA nexora_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA nexora_private TO authenticated;
-- Additive upgrade for an existing Lean v3 installation. Never rerun 00_schema.sql.
-- Browser functions derive the actor from auth.uid(), never from demo role names.
CREATE TABLE IF NOT EXISTS public.nh_schema_migrations (
 version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.nh_schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nh_schema_migrations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION nexora_private.nh_current_actor() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid;
BEGIN
 SELECT user_id INTO actor FROM public.users WHERE auth_subject=auth.uid() AND is_active;
 IF actor IS NULL THEN RAISE EXCEPTION 'An active hospital profile is required' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_actor_can_request(p_actor uuid,p_department uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.locations WHERE location_id=p_department AND location_type='department' AND is_active)
 AND (public.nh_has_scoped_role(p_actor,p_department,'nurse') OR public.nh_has_scoped_role(p_actor,p_department,'doctor')
 OR public.nh_has_scoped_role(p_actor,p_department,'chargeNurse') OR public.nh_has_scoped_role(p_actor,p_department,'operations'));
$$;

CREATE OR REPLACE FUNCTION nexora_private.nh_actor_can_approve(p_actor uuid,p_transfer uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.transfer_requests tr
 JOIN public.equipment_assets a ON a.asset_id=tr.asset_id
 JOIN public.equipment_models m USING(model_id)
 JOIN public.approval_policies p ON p.source_department_id=tr.from_department_id AND p.is_active
 JOIN public.roles r ON r.role_id=p.required_role_id
 JOIN public.locations src ON src.location_id=tr.from_department_id AND src.is_active
 WHERE tr.transfer_id=p_transfer AND tr.requested_by<>p_actor
 AND (p.category_id IS NULL OR p.category_id=m.category_id)
 AND public.nh_has_scoped_role(p_actor,tr.from_department_id,r.role_key));
$$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_hospital_context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); result jsonb;
BEGIN
 SELECT jsonb_build_object('user_id',u.user_id,'display_name',u.display_name,
 'department_id',d.location_id,'unit',d.name,'unit_code',d.code)
 INTO result FROM public.users u LEFT JOIN public.locations d ON d.location_id=u.home_department_id
 AND d.location_type='department' AND d.is_active WHERE u.user_id=actor;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_request_equipment(p_source_inventory_id text,p_reason text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); destination uuid; asset uuid; source uuid; category uuid; match text[];
BEGIN
 IF length(coalesce(p_reason,''))>2000 THEN RAISE EXCEPTION 'Reason is too long'; END IF;
 match:=regexp_match(p_source_inventory_id,'^EQ-([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$');
 IF match IS NULL THEN RAISE EXCEPTION 'Choose database equipment, not a demo item'; END IF;
 source:=match[1]::uuid; category:=match[2]::uuid;
 SELECT home_department_id INTO destination FROM public.users WHERE user_id=actor;
 IF NOT nexora_private.nh_actor_can_request(actor,destination) THEN
  RAISE EXCEPTION 'A department-scoped staff role is required' USING ERRCODE='42501'; END IF;
 -- Do not permit cross-hospital transfer through a shared category ID.
 IF NOT EXISTS(SELECT 1 FROM public.locations s JOIN public.locations d ON d.location_id=destination
  JOIN public.locations h ON h.location_id=s.parent_location_id AND h.location_type='hospital' AND h.is_active
  WHERE s.location_id=source AND s.location_type='department' AND s.is_active
  AND s.parent_location_id=d.parent_location_id AND source<>destination) THEN
  RAISE EXCEPTION 'Choose equipment in another active unit of your hospital'; END IF;
 SELECT a.asset_id INTO asset FROM public.equipment_assets a JOIN public.equipment_models m USING(model_id)
 WHERE m.category_id=category AND public.nh_department_for_location(a.current_location_id)=source
 AND a.asset_status='available'
 AND NOT EXISTS(SELECT 1 FROM public.asset_reservations r WHERE r.asset_id=a.asset_id AND r.released_at IS NULL)
 ORDER BY a.asset_tag LIMIT 1 FOR UPDATE OF a;
 IF asset IS NULL THEN RAISE EXCEPTION 'No available asset remains in that unit'; END IF;
 -- The prototype requests one reusable asset per row. Approval reserves; it does not move stock.
 RETURN public.nh_request_transfer(asset,destination,actor,p_reason);
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_decide_transfer(p_transfer_id uuid,p_approve boolean,p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor();
BEGIN
 IF p_approve IS NULL THEN RAISE EXCEPTION 'Choose approve or reject'; END IF;
 IF length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'Decision note is too long'; END IF;
 IF NOT nexora_private.nh_actor_can_approve(actor,p_transfer_id) THEN
  RAISE EXCEPTION 'This account cannot decide this request' USING ERRCODE='42501'; END IF;
 IF p_approve THEN PERFORM public.nh_approve_transfer(p_transfer_id,actor,p_note);
 ELSE PERFORM public.nh_reject_transfer(p_transfer_id,actor,p_note); END IF;
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_list_transfers() RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor();
BEGIN
 RETURN QUERY SELECT jsonb_build_object('id',tr.transfer_id,'type','transfer','persisted',true,
 'createdAt',tr.requested_at,'status',tr.transfer_status,'item',c.name,'quantity',1,
 'sourceItemId','EQ-'||src.location_id::text||'-'||c.category_id::text,
 'sourceUnit',src.name,'requestingUnit',dst.name,'requestedBy',u.display_name,
 'canDecide',tr.transfer_status='requested' AND nexora_private.nh_actor_can_approve(actor,tr.transfer_id),
 'decidedBy',approver.display_name,'decidedAt',tr.decided_at)
 FROM public.transfer_requests tr JOIN public.equipment_assets a USING(asset_id)
 JOIN public.equipment_models m USING(model_id) JOIN public.equipment_categories c USING(category_id)
 JOIN public.locations src ON src.location_id=tr.from_department_id
 JOIN public.locations dst ON dst.location_id=tr.to_department_id
 JOIN public.users u ON u.user_id=tr.requested_by LEFT JOIN public.users approver ON approver.user_id=tr.approved_by
 WHERE tr.requested_by=actor OR nexora_private.nh_actor_can_approve(actor,tr.transfer_id)
 ORDER BY tr.requested_at DESC,tr.transfer_id;
END $$;

-- Helpers and legacy functions stay private. Only the actor-bound entry points are exposed.
REVOKE ALL ON FUNCTION nexora_private.nh_current_actor(),nexora_private.nh_actor_can_request(uuid,uuid),
 nexora_private.nh_actor_can_approve(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION nexora_private.nh_api_hospital_context(),nexora_private.nh_api_request_equipment(text,text),
 nexora_private.nh_api_decide_transfer(uuid,boolean,text),nexora_private.nh_api_list_transfers() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION nexora_private.nh_api_hospital_context(),nexora_private.nh_api_request_equipment(text,text),
 nexora_private.nh_api_decide_transfer(uuid,boolean,text),nexora_private.nh_api_list_transfers() TO authenticated;

-- Exposed entry points are SECURITY INVOKER; all authorization stays in private implementations.
CREATE OR REPLACE FUNCTION public.nh_api_hospital_context() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT nexora_private.nh_api_hospital_context();
$$;
REVOKE ALL ON FUNCTION public.nh_api_hospital_context() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_hospital_context() TO authenticated;
CREATE OR REPLACE FUNCTION public.nh_api_request_equipment(p_source_inventory_id text,p_reason text DEFAULT NULL) RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT nexora_private.nh_api_request_equipment(p_source_inventory_id,p_reason);
$$;
REVOKE ALL ON FUNCTION public.nh_api_request_equipment(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_request_equipment(text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.nh_api_decide_transfer(p_transfer_id uuid,p_approve boolean,p_note text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT nexora_private.nh_api_decide_transfer(p_transfer_id,p_approve,p_note);
$$;
REVOKE ALL ON FUNCTION public.nh_api_decide_transfer(uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_decide_transfer(uuid,boolean,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.nh_api_list_transfers() RETURNS SETOF jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT * FROM nexora_private.nh_api_list_transfers();
$$;
REVOKE ALL ON FUNCTION public.nh_api_list_transfers() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_list_transfers() TO authenticated;

INSERT INTO public.nh_schema_migrations(version) VALUES('07_authenticated_workflows') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
