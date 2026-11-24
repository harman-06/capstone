BEGIN;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_verify_transfer_asset(
 p_transfer_id uuid,p_action text,p_asset_tag text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 actor uuid:=nexora_private.nh_current_actor();
 tr public.transfer_requests%ROWTYPE;
 actual_tag text;
 next_status text;
 handoff_event text;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('dispatch','receive')
  OR p_asset_tag IS NULL OR p_asset_tag !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' THEN
  RAISE EXCEPTION 'Choose a transfer action and enter a valid equipment tag' USING ERRCODE='22023';
 END IF;

 SELECT * INTO tr FROM public.transfer_requests WHERE transfer_id=p_transfer_id FOR UPDATE;
 IF NOT FOUND OR NOT nexora_private.nh_can_handle_transfer_unit(actor,
  CASE WHEN p_action='dispatch' THEN tr.from_department_id ELSE tr.to_department_id END) THEN
  RAISE EXCEPTION 'This account cannot perform this handoff' USING ERRCODE='42501';
 END IF;
 SELECT asset_tag INTO actual_tag FROM public.equipment_assets WHERE asset_id=tr.asset_id FOR KEY SHARE;
 IF actual_tag IS DISTINCT FROM p_asset_tag THEN
  RAISE EXCEPTION 'This equipment tag does not match the transfer' USING ERRCODE='22023';
 END IF;

 next_status:=nexora_private.nh_api_move_transfer(p_transfer_id,p_action);
 IF next_status<>tr.transfer_status THEN
  handoff_event:=CASE WHEN p_action='dispatch' THEN 'dispatched' ELSE 'received' END;
  UPDATE public.transfer_events SET note='equipment_tag_verified'
  WHERE event_id=(
   SELECT event_id FROM public.transfer_events
   WHERE transfer_id=p_transfer_id AND event_type=handoff_event ORDER BY event_id DESC LIMIT 1
  );
 END IF;
 RETURN next_status;
END $$;

CREATE OR REPLACE FUNCTION public.nh_api_verify_transfer_asset(
 p_transfer_id uuid,p_action text,p_asset_tag text)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT nexora_private.nh_api_verify_transfer_asset(p_transfer_id,p_action,p_asset_tag);
$$;
REVOKE ALL ON FUNCTION public.nh_api_verify_transfer_asset(uuid,text,text),
 nexora_private.nh_api_verify_transfer_asset(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_verify_transfer_asset(uuid,text,text),
 nexora_private.nh_api_verify_transfer_asset(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_list_transfers() RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor();
BEGIN
 RETURN QUERY SELECT jsonb_build_object('id',tr.transfer_id,'type','transfer','persisted',true,
 'createdAt',coalesce(q.created_at,tr.requested_at),'status',tr.transfer_status,'item',c.name,'quantity',1,
 'sourceItemId','EQ-'||src.location_id||'-'||c.category_id,
 'sourceUnit',src.name,'requestingUnit',dst.name,'requestedBy',u.display_name,
 'canDecide',tr.transfer_status='requested' AND nexora_private.nh_actor_can_approve(actor,tr.transfer_id),
 'canDispatch',tr.transfer_status='reserved' AND access.source_operator,
 'canReceive',tr.transfer_status='in_transit' AND access.destination_operator,
 'assetTag',CASE WHEN (tr.transfer_status='reserved' AND access.source_operator) OR (tr.transfer_status='in_transit' AND access.destination_operator) THEN a.asset_tag END,
 'decidedBy',approver.display_name,'decidedAt',tr.decided_at,
 'timeline',coalesce(history.events,'[]'::jsonb))
 FROM public.transfer_requests tr JOIN public.equipment_assets a USING(asset_id)
 JOIN public.equipment_models m USING(model_id) JOIN public.equipment_categories c USING(category_id)
 JOIN public.locations src ON src.location_id=tr.from_department_id
 JOIN public.locations dst ON dst.location_id=tr.to_department_id
 JOIN public.users u ON u.user_id=tr.requested_by LEFT JOIN public.users approver ON approver.user_id=tr.approved_by
 LEFT JOIN public.nh_allocation_requests q ON q.transfer_id=tr.transfer_id
 CROSS JOIN LATERAL (SELECT nexora_private.nh_can_handle_transfer_unit(actor,tr.from_department_id) AS source_operator,
  nexora_private.nh_can_handle_transfer_unit(actor,tr.to_department_id) AS destination_operator) access
 LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object('stage',events.stage,'at',events.event_at,'tagVerified',events.tag_verified) ORDER BY events.phase,events.event_id) AS events
  FROM (
   SELECT 1 AS phase,e.event_id,e.event_at,CASE e.action WHEN 'queued' THEN 'requested' ELSE e.action END AS stage,false AS tag_verified
   FROM public.nh_allocation_events e WHERE e.request_id=q.request_id AND e.action IN ('queued','reviewed')
   UNION ALL
   SELECT 2,e.event_id,e.event_at,CASE WHEN q.request_id IS NOT NULL AND e.event_type='approved'
    THEN 'allocated' ELSE e.event_type END,
    coalesce(e.note='equipment_tag_verified',false) AND e.event_type IN ('dispatched','received')
   FROM public.transfer_events e WHERE e.transfer_id=tr.transfer_id
    AND (q.request_id IS NULL OR e.event_type<>'requested')
  ) events
 ) history ON true
 WHERE tr.requested_by=actor OR nexora_private.nh_actor_can_approve(actor,tr.transfer_id)
  OR access.source_operator OR access.destination_operator
 ORDER BY coalesce(q.created_at,tr.requested_at) DESC,tr.transfer_id;
END $$;

COMMIT;
