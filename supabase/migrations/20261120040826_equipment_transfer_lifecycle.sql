
-- Extend the reviewed allocation workflow without changing its ranking or reserve policy.
BEGIN;

ALTER TABLE public.nh_allocation_requests ADD COLUMN IF NOT EXISTS requested_needed_by timestamptz;

ALTER TABLE public.transfer_events DROP CONSTRAINT IF EXISTS transfer_events_event_type_check;
ALTER TABLE public.transfer_events ADD CONSTRAINT transfer_events_event_type_check CHECK (
 event_type IN ('requested','approved','rejected','reserved','dispatched','in_transit','received','completed','cancelled')
);

CREATE OR REPLACE FUNCTION nexora_private.nh_api_equipment_sources(p_category_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); dest uuid; result jsonb;
BEGIN
 SELECT home_department_id INTO dest FROM public.users WHERE user_id=actor;
 IF NOT nexora_private.nh_actor_can_request(actor,dest) THEN
  RAISE EXCEPTION 'An active department staff role is required' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('destination',d.name,'sources',coalesce((
  SELECT jsonb_agg(jsonb_build_object('id','EQ-'||s.location_id||'-'||p_category_id,
    'unit',s.name,'quantity',coalesce(i.qty,0)) ORDER BY s.name,s.location_id)
  FROM public.locations s
  LEFT JOIN public.frontend_equipment_inventory_v i ON i.id='EQ-'||s.location_id||'-'||p_category_id
  WHERE s.parent_location_id=h.location_id AND s.is_active
   AND s.location_type='department' AND s.location_id<>dest
   AND (i.id IS NOT NULL OR EXISTS(SELECT 1 FROM public.approval_policies p
    WHERE p.source_department_id=s.location_id AND p.is_active
     AND (p.category_id IS NULL OR p.category_id=p_category_id)))
 ),'[]'::jsonb))
 INTO result FROM public.locations d JOIN public.locations h ON h.location_id=d.parent_location_id
 WHERE d.location_id=dest AND h.is_active AND h.location_type='hospital'
 AND EXISTS(SELECT 1 FROM public.equipment_categories WHERE category_id=p_category_id);
 IF result IS NULL THEN RAISE EXCEPTION 'Choose an equipment category in an active hospital' USING ERRCODE='22023'; END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_submit_equipment_need(
 p_source_inventory_id text,p_operation_id uuid,p_reason text,p_needed_by timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); need_id uuid; original_due timestamptz; replay boolean;
BEGIN
 IF p_operation_id IS NULL OR p_needed_by IS NULL OR NOT isfinite(p_needed_by)
  OR length(coalesce(trim(p_reason),'')) NOT BETWEEN 1 AND 2000 THEN
  RAISE EXCEPTION 'Enter an operational reason and required-by time' USING ERRCODE='22023';
 END IF;
 -- Serialize this key across source pools before using the existing queue writer.
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_operation_id::text,0));
 SELECT EXISTS(SELECT 1 FROM public.nh_allocation_requests WHERE requested_by=actor AND operation_id=p_operation_id) INTO replay;
 IF NOT replay AND p_needed_by<=statement_timestamp() THEN
  RAISE EXCEPTION 'Required-by time must be in the future' USING ERRCODE='22023';
 END IF;
 need_id:=nexora_private.nh_api_enqueue_equipment(p_source_inventory_id,p_operation_id,trim(p_reason));
 SELECT requested_needed_by INTO original_due FROM public.nh_allocation_requests WHERE request_id=need_id FOR UPDATE;
 IF original_due IS NULL AND NOT replay THEN
  UPDATE public.nh_allocation_requests SET requested_needed_by=p_needed_by,needed_by=p_needed_by
  WHERE request_id=need_id AND verified_at IS NULL AND status='queued';
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation ID already belongs to an existing request' USING ERRCODE='22023'; END IF;
 ELSIF original_due IS DISTINCT FROM p_needed_by THEN
  RAISE EXCEPTION 'Operation ID already used with a different required-by time' USING ERRCODE='22023';
 END IF;
 RETURN need_id;
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_can_handle_transfer_unit(p_actor uuid,p_unit uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.locations d JOIN public.locations h ON h.location_id=d.parent_location_id
  WHERE d.location_id=p_unit AND d.location_type='department' AND d.is_active
   AND h.location_type='hospital' AND h.is_active)
 AND (public.nh_has_scoped_role(p_actor,p_unit,'operations')
   OR public.nh_has_scoped_role(p_actor,p_unit,'chargeNurse'));
$$;
REVOKE ALL ON FUNCTION nexora_private.nh_can_handle_transfer_unit(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_move_transfer(p_transfer_id uuid,p_action text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); tr public.transfer_requests%ROWTYPE;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('dispatch','receive') THEN
  RAISE EXCEPTION 'Choose dispatch or receive' USING ERRCODE='22023';
 END IF;
 SELECT * INTO tr FROM public.transfer_requests WHERE transfer_id=p_transfer_id FOR UPDATE;
 IF NOT FOUND OR NOT nexora_private.nh_can_handle_transfer_unit(actor,
  CASE WHEN p_action='dispatch' THEN tr.from_department_id ELSE tr.to_department_id END) THEN
  RAISE EXCEPTION 'This account cannot perform this transfer action' USING ERRCODE='42501';
 END IF;
 IF p_action='dispatch' THEN
  IF tr.transfer_status IN ('in_transit','completed') THEN RETURN tr.transfer_status; END IF;
  IF tr.transfer_status<>'reserved' THEN RAISE EXCEPTION 'Only reserved transfers can be dispatched'; END IF;
  PERFORM public.nh_log_transfer_event(p_transfer_id,'dispatched',actor,NULL);
  PERFORM public.nh_start_transfer(p_transfer_id,actor);
  RETURN 'in_transit';
 END IF;
 IF tr.transfer_status='completed' THEN RETURN tr.transfer_status; END IF;
 IF tr.transfer_status<>'in_transit' THEN RAISE EXCEPTION 'Only in-transit transfers can be received'; END IF;
 PERFORM public.nh_log_transfer_event(p_transfer_id,'received',actor,NULL);
 PERFORM public.nh_complete_transfer(p_transfer_id,actor);
 RETURN 'completed';
END $$;

CREATE OR REPLACE FUNCTION public.nh_api_equipment_sources(p_category_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT nexora_private.nh_api_equipment_sources(p_category_id);
$$;
CREATE OR REPLACE FUNCTION public.nh_api_submit_equipment_need(
 p_source_inventory_id text,p_operation_id uuid,p_reason text,p_needed_by timestamptz)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT nexora_private.nh_api_submit_equipment_need(p_source_inventory_id,p_operation_id,p_reason,p_needed_by);
$$;
CREATE OR REPLACE FUNCTION public.nh_api_move_transfer(p_transfer_id uuid,p_action text)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT nexora_private.nh_api_move_transfer(p_transfer_id,p_action);
$$;

REVOKE ALL ON FUNCTION
 public.nh_api_equipment_sources(uuid),public.nh_api_submit_equipment_need(text,uuid,text,timestamptz),
 public.nh_api_move_transfer(uuid,text),nexora_private.nh_api_equipment_sources(uuid),
 nexora_private.nh_api_submit_equipment_need(text,uuid,text,timestamptz),
 nexora_private.nh_api_move_transfer(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
 public.nh_api_equipment_sources(uuid),public.nh_api_submit_equipment_need(text,uuid,text,timestamptz),
 public.nh_api_move_transfer(uuid,text),nexora_private.nh_api_equipment_sources(uuid),
 nexora_private.nh_api_submit_equipment_need(text,uuid,text,timestamptz),
 nexora_private.nh_api_move_transfer(uuid,text) TO authenticated;

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
  SELECT jsonb_agg(jsonb_build_object('stage',events.stage,'at',events.event_at) ORDER BY events.phase,events.event_id) AS events
  FROM (
   SELECT 1 AS phase,e.event_id,e.event_at,CASE e.action WHEN 'queued' THEN 'requested' ELSE e.action END AS stage
   FROM public.nh_allocation_events e WHERE e.request_id=q.request_id AND e.action IN ('queued','reviewed')
   UNION ALL
   SELECT 2,e.event_id,e.event_at,CASE WHEN q.request_id IS NOT NULL AND e.event_type='approved'
    THEN 'allocated' ELSE e.event_type END
   FROM public.transfer_events e WHERE e.transfer_id=tr.transfer_id
    AND (q.request_id IS NULL OR e.event_type<>'requested')
  ) events
 ) history ON true
 WHERE tr.requested_by=actor OR nexora_private.nh_actor_can_approve(actor,tr.transfer_id)
  OR access.source_operator OR access.destination_operator
 ORDER BY coalesce(q.created_at,tr.requested_at) DESC,tr.transfer_id;
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_list_allocation_queue()
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor();
BEGIN
 RETURN QUERY WITH visible_pools AS MATERIALIZED (
 SELECT DISTINCT q.source_department_id,q.category_id FROM public.nh_allocation_requests q
 WHERE q.requested_by=actor OR nexora_private.nh_can_allocate(actor,q.source_department_id,q.category_id)
 ), ranked AS MATERIALIZED (
 SELECT r.* FROM visible_pools p CROSS JOIN LATERAL nexora_private.nh_ranked_queue(p.source_department_id,p.category_id) r
 ) SELECT jsonb_build_object('id',q.request_id,'source_id',q.source_department_id,'category_id',q.category_id,
 'source_unit',s.name,'destination_unit',d.name,'item',c.name,'status',q.status,'priority',q.priority,
 'reason',q.reason,'requested_needed_by',q.requested_needed_by,'needed_by',q.needed_by,'created_at',q.created_at,'reviewed',q.verified_by IS NOT NULL,
 'eligible',nexora_private.nh_queue_eligible(q.request_id),'queue_position',ranking.queue_position,
 'recent_allocations',ranking.recent_allocations,'pool_enabled',p.enabled,'minimum_retained',p.minimum_retained,
 'allocation_explanation',CASE WHEN q.status='allocated' THEN 'Reserved using reviewed priority, overdue need, waiting age, equal-unit 24h sharing, deadline and FIFO. Physical movement is separate.' ELSE NULL END,
 'transfer_id',q.transfer_id,'transfer_status',t.transfer_status,'can_coordinate',nexora_private.nh_can_allocate(actor,q.source_department_id,q.category_id),
 'can_review',q.status='queued' AND q.requested_by<>actor AND nexora_private.nh_can_allocate(actor,q.source_department_id,q.category_id),
 'can_cancel',q.status='queued' AND q.requested_by=actor)
 FROM public.nh_allocation_requests q JOIN public.nh_allocation_pools p USING(source_department_id,category_id)
 JOIN public.locations s ON s.location_id=q.source_department_id JOIN public.locations d ON d.location_id=q.destination_department_id
 JOIN public.equipment_categories c ON c.category_id=q.category_id
 LEFT JOIN public.transfer_requests t ON t.transfer_id=q.transfer_id
 LEFT JOIN ranked ranking ON ranking.request_id=q.request_id AND q.status='queued'
 WHERE q.requested_by=actor OR nexora_private.nh_can_allocate(actor,q.source_department_id,q.category_id)
 ORDER BY q.created_at DESC,q.request_id LIMIT 200;
END $$;

COMMIT;
