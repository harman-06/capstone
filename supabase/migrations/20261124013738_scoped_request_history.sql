BEGIN;

-- Expose one scoped, minimal timeline on demand. The source event tables stay private.
CREATE OR REPLACE FUNCTION nexora_private.nh_api_request_history(p_kind text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 actor uuid;
 linked_transfer uuid;
 result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Sign in to view request history' USING ERRCODE='42501';
 END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('equipment','supplier') OR p_request_id IS NULL THEN
  RAISE EXCEPTION 'Choose a request to view its history' USING ERRCODE='22023';
 END IF;

 IF p_kind='equipment' THEN
  actor:=nexora_private.nh_current_actor();
  SELECT q.transfer_id INTO linked_transfer
  FROM public.nh_allocation_requests q
  LEFT JOIN public.transfer_requests t ON t.transfer_id=q.transfer_id
  WHERE q.request_id=p_request_id AND (
   q.requested_by=actor OR nexora_private.nh_can_allocate(actor,q.source_department_id,q.category_id)
   OR (t.transfer_id IS NOT NULL AND (
    nexora_private.nh_can_handle_transfer_unit(actor,t.from_department_id)
    OR nexora_private.nh_can_handle_transfer_unit(actor,t.to_department_id)
   ))
  );
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Request history is unavailable for this account' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('stage',e.stage,'at',e.event_at,'tagVerified',e.tag_verified)
   ORDER BY e.phase,e.event_id)
  INTO result
  FROM (
   SELECT 1 AS phase,a.event_id,a.event_at,
    CASE a.action WHEN 'queued' THEN 'requested' ELSE a.action END AS stage,false AS tag_verified
   FROM public.nh_allocation_events a
   WHERE a.request_id=p_request_id AND a.action IN ('queued','reviewed','cancelled')
   UNION ALL
   SELECT 2,t.event_id,t.event_at,
    CASE t.event_type WHEN 'approved' THEN 'allocated' ELSE t.event_type END,
    t.event_type IN ('dispatched','received') AND coalesce(t.note='equipment_tag_verified',false)
   FROM public.transfer_events t
   WHERE t.transfer_id=linked_transfer AND t.event_type<>'requested'
  ) e;
 ELSE
  SELECT u.user_id INTO actor FROM public.users u WHERE u.auth_subject=auth.uid() AND u.is_active;
  PERFORM 1 FROM public.nh_supply_enquiries e
  JOIN public.locations d ON d.location_id=e.department_id
  JOIN public.locations h ON h.location_id=d.parent_location_id
  LEFT JOIN public.nh_suppliers s USING(supplier_id)
  WHERE e.enquiry_id=p_request_id AND (
   (actor IS NOT NULL AND (e.requested_by=actor OR nexora_private.nh_actor_can_source(actor,e.department_id)))
   OR (e.status IN ('sent','responded') AND s.is_active AND s.hospital_id=h.location_id AND d.is_active AND h.is_active
    AND EXISTS(SELECT 1 FROM public.nh_supplier_memberships m
     WHERE m.supplier_id=e.supplier_id AND m.auth_subject=auth.uid() AND m.is_active))
  );
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Request history is unavailable for this account' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('stage',e.event_type,'at',e.event_at)
   ORDER BY e.event_id)
  INTO result
  FROM public.nh_supply_events e WHERE e.enquiry_id=p_request_id;
 END IF;

 RETURN coalesce(result,'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.nh_api_request_history(p_kind text,p_request_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT nexora_private.nh_api_request_history(p_kind,p_request_id);
$$;
REVOKE ALL ON FUNCTION public.nh_api_request_history(text,uuid),
 nexora_private.nh_api_request_history(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_request_history(text,uuid),
 nexora_private.nh_api_request_history(text,uuid) TO authenticated;

COMMIT;
