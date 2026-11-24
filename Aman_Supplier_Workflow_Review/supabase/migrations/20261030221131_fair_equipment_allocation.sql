-- Additive equipment allocation MVP. No account grants, stock resets or clinical scoring.
BEGIN;
CREATE TABLE IF NOT EXISTS public.nh_allocation_pools (
 source_department_id uuid NOT NULL REFERENCES public.locations(location_id),
 category_id uuid NOT NULL REFERENCES public.equipment_categories(category_id),
 minimum_retained integer NOT NULL DEFAULT 0 CHECK(minimum_retained BETWEEN 0 AND 1000),
 enabled boolean NOT NULL DEFAULT false,
 PRIMARY KEY(source_department_id,category_id)
);
CREATE TABLE IF NOT EXISTS public.nh_allocation_requests (
 request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_department_id uuid NOT NULL,
 category_id uuid NOT NULL,
 destination_department_id uuid NOT NULL REFERENCES public.locations(location_id),
 requested_by uuid NOT NULL REFERENCES public.users(user_id),
 operation_id uuid NOT NULL,
 reason text CHECK(length(reason)<=2000),
 priority integer NOT NULL DEFAULT 1 CHECK(priority BETWEEN 1 AND 3),
 needed_by timestamptz,
 verified_by uuid REFERENCES public.users(user_id),
 verified_at timestamptz,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','allocated','cancelled')),
 transfer_id uuid UNIQUE REFERENCES public.transfer_requests(transfer_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(source_department_id,category_id) REFERENCES public.nh_allocation_pools,
 UNIQUE(requested_by,operation_id),
 CHECK(source_department_id<>destination_department_id),
 CHECK(verified_by IS NULL OR verified_by<>requested_by),
 CHECK((status='allocated' AND transfer_id IS NOT NULL) OR (status<>'allocated' AND transfer_id IS NULL))
);
-- A unit cannot jump the queue by submitting many identical outstanding demands.
CREATE UNIQUE INDEX IF NOT EXISTS nh_one_queued_demand_per_unit ON public.nh_allocation_requests
 (source_department_id,category_id,destination_department_id) WHERE status='queued';
CREATE INDEX IF NOT EXISTS nh_allocation_queue_scan ON public.nh_allocation_requests
 (source_department_id,category_id,status,priority,created_at);
CREATE INDEX IF NOT EXISTS nh_allocation_requester ON public.nh_allocation_requests(requested_by);
CREATE INDEX IF NOT EXISTS nh_allocation_destination ON public.nh_allocation_requests(destination_department_id);
CREATE INDEX IF NOT EXISTS nh_allocation_verifier ON public.nh_allocation_requests(verified_by);
CREATE TABLE IF NOT EXISTS public.nh_allocation_runs (
 actor_id uuid NOT NULL REFERENCES public.users(user_id), operation_id uuid NOT NULL,
 source_department_id uuid NOT NULL, category_id uuid NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(actor_id,operation_id),
 FOREIGN KEY(source_department_id,category_id) REFERENCES public.nh_allocation_pools
);
ALTER TABLE public.nh_allocation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nh_allocation_runs FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS public.nh_allocation_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 request_id uuid REFERENCES public.nh_allocation_requests(request_id),
 source_department_id uuid NOT NULL, category_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.users(user_id),
 action text NOT NULL CHECK(action IN ('queued','reviewed','allocated','cancelled','pool_configured')),
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 event_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(source_department_id,category_id) REFERENCES public.nh_allocation_pools
);
CREATE INDEX IF NOT EXISTS nh_allocation_events_request ON public.nh_allocation_events(request_id,event_at);
CREATE INDEX IF NOT EXISTS nh_allocation_events_pool ON public.nh_allocation_events(source_department_id,category_id);
CREATE INDEX IF NOT EXISTS nh_allocation_events_actor ON public.nh_allocation_events(actor_id);
ALTER TABLE public.nh_allocation_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nh_allocation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nh_allocation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nh_allocation_pools,public.nh_allocation_requests,public.nh_allocation_events FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.nh_allocation_events_event_id_seq FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION nexora_private.nh_can_allocate(p_actor uuid,p_source uuid,p_category uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.locations s JOIN public.locations h ON h.location_id=s.parent_location_id
 JOIN public.approval_policies p ON p.source_department_id=s.location_id AND p.is_active
 JOIN public.roles r ON r.role_id=p.required_role_id
 WHERE s.location_id=p_source AND s.location_type='department' AND s.is_active
 AND h.location_type='hospital' AND h.is_active
 AND (p.category_id IS NULL OR p.category_id=p_category)
 AND public.nh_has_scoped_role(p_actor,p_source,r.role_key));
$$;
CREATE OR REPLACE FUNCTION nexora_private.nh_queue_eligible(p_request uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.nh_allocation_requests q
 JOIN public.users u ON u.user_id=q.requested_by AND u.is_active AND u.home_department_id=q.destination_department_id
 JOIN public.locations d ON d.location_id=q.destination_department_id AND d.is_active
 JOIN public.locations s ON s.location_id=q.source_department_id AND s.is_active
 JOIN public.locations h ON h.location_id=s.parent_location_id AND h.is_active AND h.location_type='hospital'
 WHERE q.request_id=p_request AND d.parent_location_id=s.parent_location_id
 AND nexora_private.nh_actor_can_request(q.requested_by,q.destination_department_id)
 AND q.verified_by IS NOT NULL AND nexora_private.nh_can_allocate(q.verified_by,q.source_department_id,q.category_id));
$$;
-- Entire pool is serialized before ranking; no SKIP LOCKED priority bypass.
-- Fairness is equal-unit sharing for this prototype, not a clinical triage standard.
CREATE OR REPLACE FUNCTION nexora_private.nh_ranked_queue(p_source uuid,p_category uuid)
RETURNS TABLE(request_id uuid,queue_position bigint,recent_allocations bigint)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH candidates AS (
 SELECT q.*, (SELECT count(*) FROM public.transfer_requests t
 JOIN public.equipment_assets a ON a.asset_id=t.asset_id JOIN public.equipment_models m ON m.model_id=a.model_id
 WHERE t.from_department_id=p_source AND m.category_id=p_category AND t.to_department_id=q.destination_department_id
 AND t.transfer_status IN ('reserved','in_transit','completed') AND t.decided_at>=statement_timestamp()-interval '24 hours') AS served
 FROM public.nh_allocation_requests q WHERE q.source_department_id=p_source AND q.category_id=p_category
 AND q.status='queued' AND nexora_private.nh_queue_eligible(q.request_id)
 ) SELECT c.request_id,row_number() OVER(ORDER BY c.priority DESC,
 coalesce(c.needed_by<=statement_timestamp(),false) DESC,
 (c.created_at<=statement_timestamp()-interval '30 minutes') DESC,
 c.served ASC,c.needed_by ASC NULLS LAST,c.created_at ASC,c.request_id ASC),c.served FROM candidates c;
$$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_enqueue_equipment(p_source_inventory_id text,p_operation_id uuid,p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); dest uuid; src uuid; cat uuid; parts text[]; existing public.nh_allocation_requests%ROWTYPE; result uuid;
BEGIN
 parts:=regexp_match(p_source_inventory_id,'^EQ-([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$');
 IF parts IS NULL OR p_operation_id IS NULL OR length(coalesce(p_reason,''))>2000 THEN RAISE EXCEPTION 'Choose live equipment and a valid operation ID/reason' USING ERRCODE='22023'; END IF;
 src:=parts[1]::uuid; cat:=parts[2]::uuid;
 SELECT home_department_id INTO dest FROM public.users WHERE user_id=actor;
 IF NOT nexora_private.nh_actor_can_request(actor,dest) OR NOT EXISTS(
 SELECT 1 FROM public.locations s JOIN public.locations d ON d.location_id=dest
 JOIN public.locations h ON h.location_id=s.parent_location_id
 WHERE s.location_id=src AND s.location_type='department' AND s.is_active
 AND d.parent_location_id=s.parent_location_id AND h.is_active AND h.location_type='hospital' AND src<>dest)
 THEN RAISE EXCEPTION 'An active same-hospital department scope is required' USING ERRCODE='42501'; END IF;
 INSERT INTO public.nh_allocation_pools(source_department_id,category_id) VALUES(src,cat) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM public.nh_allocation_pools WHERE source_department_id=src AND category_id=cat FOR UPDATE;
 SELECT * INTO existing FROM public.nh_allocation_requests WHERE requested_by=actor AND operation_id=p_operation_id;
 IF FOUND THEN
 IF existing.source_department_id<>src OR existing.category_id<>cat OR existing.destination_department_id<>dest OR existing.reason IS DISTINCT FROM p_reason
 THEN RAISE EXCEPTION 'Operation ID already used for a different request' USING ERRCODE='22023'; END IF;
 RETURN existing.request_id; END IF;
 IF EXISTS(SELECT 1 FROM public.nh_allocation_requests WHERE source_department_id=src AND category_id=cat AND destination_department_id=dest AND status='queued')
 THEN RAISE EXCEPTION 'Your unit already has a queued request for this source and category' USING ERRCODE='23505'; END IF;
 INSERT INTO public.nh_allocation_requests(source_department_id,category_id,destination_department_id,requested_by,operation_id,reason)
 VALUES(src,cat,dest,actor,p_operation_id,p_reason) RETURNING request_id INTO result;
 INSERT INTO public.nh_allocation_events(request_id,source_department_id,category_id,actor_id,action)
 VALUES(result,src,cat,actor,'queued'); RETURN result;
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_review_allocation(p_request_id uuid,p_priority integer,p_needed_by timestamptz,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); q public.nh_allocation_requests%ROWTYPE;
BEGIN
 SELECT * INTO STRICT q FROM public.nh_allocation_requests WHERE request_id=p_request_id;
 IF q.requested_by=actor OR NOT nexora_private.nh_can_allocate(actor,q.source_department_id,q.category_id) THEN RAISE EXCEPTION 'A different authorized source coordinator must review' USING ERRCODE='42501'; END IF;
 IF p_priority IS NULL OR p_priority NOT BETWEEN 1 AND 3 OR p_note IS NULL OR length(trim(p_note)) NOT BETWEEN 8 AND 2000
 THEN RAISE EXCEPTION 'Choose priority 1–3 and a review reason of 8–2000 characters' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.nh_allocation_pools WHERE source_department_id=q.source_department_id AND category_id=q.category_id FOR UPDATE;
 SELECT * INTO STRICT q FROM public.nh_allocation_requests WHERE request_id=p_request_id FOR UPDATE;
 IF q.status<>'queued' THEN RAISE EXCEPTION 'Only queued requests can be reviewed'; END IF;
 INSERT INTO public.nh_allocation_events(request_id,source_department_id,category_id,actor_id,action,details)
 VALUES(q.request_id,q.source_department_id,q.category_id,actor,'reviewed',jsonb_build_object('old_priority',q.priority,'priority',p_priority,'old_needed_by',q.needed_by,'needed_by',p_needed_by,'note',p_note));
 UPDATE public.nh_allocation_requests SET priority=p_priority,needed_by=p_needed_by,verified_by=actor,verified_at=clock_timestamp() WHERE request_id=p_request_id;
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_configure_allocation(p_source uuid,p_category uuid,p_minimum_retained integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); old_min integer;
BEGIN
 IF NOT nexora_private.nh_can_allocate(actor,p_source,p_category) THEN RAISE EXCEPTION 'Source coordinator scope is required' USING ERRCODE='42501'; END IF;
 IF p_minimum_retained IS NULL OR p_minimum_retained NOT BETWEEN 0 AND 1000 THEN RAISE EXCEPTION 'Minimum retained must be 0–1000' USING ERRCODE='22023'; END IF;
 INSERT INTO public.nh_allocation_pools(source_department_id,category_id) VALUES(p_source,p_category) ON CONFLICT DO NOTHING;
 SELECT minimum_retained INTO old_min FROM public.nh_allocation_pools WHERE source_department_id=p_source AND category_id=p_category FOR UPDATE;
 UPDATE public.nh_allocation_pools SET minimum_retained=p_minimum_retained,enabled=true WHERE source_department_id=p_source AND category_id=p_category;
 INSERT INTO public.nh_allocation_events(source_department_id,category_id,actor_id,action,details)
 VALUES(p_source,p_category,actor,'pool_configured',jsonb_build_object('old_minimum',old_min,'minimum_retained',p_minimum_retained));
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_allocate_next(p_source uuid,p_category uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); pool public.nh_allocation_pools%ROWTYPE; q public.nh_allocation_requests%ROWTYPE;
 chosen uuid; available_count integer; transfer uuid; served bigint; previous public.nh_allocation_runs%ROWTYPE; outcome jsonb;
BEGIN
 IF NOT nexora_private.nh_can_allocate(actor,p_source,p_category) THEN RAISE EXCEPTION 'Source coordinator scope is required' USING ERRCODE='42501'; END IF;
 IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Operation ID is required' USING ERRCODE='22023'; END IF;
 SELECT * INTO pool FROM public.nh_allocation_pools WHERE source_department_id=p_source AND category_id=p_category FOR UPDATE;
 IF NOT FOUND OR NOT pool.enabled THEN RETURN jsonb_build_object('outcome','configuration_required'); END IF;
 SELECT * INTO previous FROM public.nh_allocation_runs WHERE actor_id=actor AND operation_id=p_operation_id;
 IF FOUND THEN
 IF previous.source_department_id<>p_source OR previous.category_id<>p_category THEN RAISE EXCEPTION 'Operation ID used for another pool' USING ERRCODE='22023'; END IF;
 RETURN previous.result; END IF;
 SELECT r.request_id,r.recent_allocations INTO chosen,served FROM nexora_private.nh_ranked_queue(p_source,p_category) r ORDER BY r.queue_position LIMIT 1;
 IF chosen IS NULL THEN RETURN jsonb_build_object('outcome','no_eligible_requests'); END IF;
 SELECT * INTO STRICT q FROM public.nh_allocation_requests WHERE request_id=chosen FOR UPDATE;
 IF q.requested_by=actor THEN RAISE EXCEPTION 'The next request is yours; another coordinator must allocate it' USING ERRCODE='42501'; END IF;
 -- Lock available assets in a stable order before checking the retained floor.
 PERFORM a.asset_id FROM public.equipment_assets a JOIN public.equipment_models m ON m.model_id=a.model_id
 WHERE m.category_id=p_category AND public.nh_department_for_location(a.current_location_id)=p_source
 AND a.asset_status='available' ORDER BY a.asset_id FOR UPDATE OF a;
 SELECT count(*), (array_agg(a.asset_id ORDER BY a.asset_tag,a.asset_id))[1] INTO available_count,chosen
 FROM public.equipment_assets a JOIN public.equipment_models m ON m.model_id=a.model_id
 WHERE m.category_id=p_category AND public.nh_department_for_location(a.current_location_id)=p_source
 AND a.asset_status='available' AND NOT EXISTS(SELECT 1 FROM public.asset_reservations r WHERE r.asset_id=a.asset_id AND r.released_at IS NULL);
 IF available_count<=pool.minimum_retained THEN RETURN jsonb_build_object('outcome','waiting_for_stock','available',available_count,'minimum_retained',pool.minimum_retained); END IF;
 transfer:=public.nh_request_transfer(chosen,q.destination_department_id,q.requested_by,q.reason);
 PERFORM public.nh_approve_transfer(transfer,actor,'Allocation policy v1: reviewed priority, overdue, age, equal-unit 24h share, deadline, FIFO');
 UPDATE public.nh_allocation_requests SET status='allocated',transfer_id=transfer WHERE request_id=q.request_id;
 INSERT INTO public.nh_allocation_events(request_id,source_department_id,category_id,actor_id,action,details)
 VALUES(q.request_id,p_source,p_category,actor,'allocated',jsonb_build_object('policy','equal_unit_v1','priority',q.priority,'previous_24h_allocations',served,'asset_id',chosen,'transfer_id',transfer,'minimum_retained',pool.minimum_retained));
 outcome:=jsonb_build_object('outcome','allocated','request_id',q.request_id,'transfer_id',transfer);
 INSERT INTO public.nh_allocation_runs(actor_id,operation_id,source_department_id,category_id,result) VALUES(actor,p_operation_id,p_source,p_category,outcome);
 RETURN outcome;
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_cancel_allocation(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); q public.nh_allocation_requests%ROWTYPE;
BEGIN
 SELECT * INTO STRICT q FROM public.nh_allocation_requests WHERE request_id=p_request_id;
 IF q.requested_by<>actor THEN RAISE EXCEPTION 'Only the requester can cancel this queued demand' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.nh_allocation_pools WHERE source_department_id=q.source_department_id AND category_id=q.category_id FOR UPDATE;
 SELECT * INTO STRICT q FROM public.nh_allocation_requests WHERE request_id=p_request_id FOR UPDATE;
 IF q.status='cancelled' THEN RETURN; END IF;
 IF q.status<>'queued' THEN RAISE EXCEPTION 'Allocated transfers require the separate transfer cancellation process'; END IF;
 UPDATE public.nh_allocation_requests SET status='cancelled' WHERE request_id=q.request_id;
 INSERT INTO public.nh_allocation_events(request_id,source_department_id,category_id,actor_id,action)
 VALUES(q.request_id,q.source_department_id,q.category_id,actor,'cancelled');
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
 'needed_by',q.needed_by,'created_at',q.created_at,'reviewed',q.verified_by IS NOT NULL,
 'eligible',nexora_private.nh_queue_eligible(q.request_id),'queue_position',ranking.queue_position,
 'recent_allocations',ranking.recent_allocations,'pool_enabled',p.enabled,'minimum_retained',p.minimum_retained,
 'allocation_explanation',CASE WHEN q.status='allocated' THEN 'Reserved using reviewed priority, overdue need, waiting age, equal-unit 24h sharing, deadline and FIFO. Physical movement is separate.' ELSE NULL END,
 'transfer_id',q.transfer_id,'can_coordinate',nexora_private.nh_can_allocate(actor,q.source_department_id,q.category_id),
 'can_review',q.status='queued' AND q.requested_by<>actor AND nexora_private.nh_can_allocate(actor,q.source_department_id,q.category_id),
 'can_cancel',q.status='queued' AND q.requested_by=actor)
 FROM public.nh_allocation_requests q JOIN public.nh_allocation_pools p USING(source_department_id,category_id)
 JOIN public.locations s ON s.location_id=q.source_department_id JOIN public.locations d ON d.location_id=q.destination_department_id
 JOIN public.equipment_categories c ON c.category_id=q.category_id
 LEFT JOIN ranked ranking ON ranking.request_id=q.request_id AND q.status='queued'
 WHERE q.requested_by=actor OR nexora_private.nh_can_allocate(actor,q.source_department_id,q.category_id)
 ORDER BY q.created_at DESC,q.request_id LIMIT 200;
END $$;

-- Prevent old browser endpoints bypassing the queue after activation.
CREATE OR REPLACE FUNCTION nexora_private.nh_api_request_equipment(p_source_inventory_id text,p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'Use the equipment allocation queue; refresh the website' USING ERRCODE='0A000';
END $$;
CREATE OR REPLACE FUNCTION nexora_private.nh_api_decide_transfer(p_transfer_id uuid,p_approve boolean,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor();
BEGIN
 IF p_approve IS DISTINCT FROM false THEN RAISE EXCEPTION 'Approve equipment through the allocation queue' USING ERRCODE='0A000'; END IF;
 IF length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'Decision note is too long'; END IF;
 IF NOT nexora_private.nh_actor_can_approve(actor,p_transfer_id) THEN RAISE EXCEPTION 'This account cannot decide this request' USING ERRCODE='42501'; END IF;
 PERFORM public.nh_reject_transfer(p_transfer_id,actor,p_note);
END $$;

-- Explicit allowlist: no helpers callable by browsers, no public definer endpoints.
DO $$
DECLARE sig text; args text; rettype text; callargs text;
BEGIN
 REVOKE ALL ON FUNCTION nexora_private.nh_can_allocate(uuid,uuid,uuid),nexora_private.nh_queue_eligible(uuid),nexora_private.nh_ranked_queue(uuid,uuid) FROM PUBLIC,anon,authenticated;
 FOR sig,args,rettype,callargs IN SELECT * FROM (VALUES
 ('nh_api_enqueue_equipment','p_source_inventory_id text,p_operation_id uuid,p_reason text DEFAULT NULL','uuid','p_source_inventory_id,p_operation_id,p_reason'),
 ('nh_api_review_allocation','p_request_id uuid,p_priority integer,p_needed_by timestamptz,p_note text','void','p_request_id,p_priority,p_needed_by,p_note'),
 ('nh_api_configure_allocation','p_source uuid,p_category uuid,p_minimum_retained integer','void','p_source,p_category,p_minimum_retained'),
 ('nh_api_allocate_next','p_source uuid,p_category uuid,p_operation_id uuid','jsonb','p_source,p_category,p_operation_id'),
 ('nh_api_cancel_allocation','p_request_id uuid','void','p_request_id'),
 ('nh_api_list_allocation_queue','','SETOF jsonb','')) AS x(a,b,c,d)
 LOOP
 EXECUTE format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql SECURITY INVOKER SET search_path='''' AS $fn$ SELECT %s nexora_private.%I(%s); $fn$',sig,args,rettype,CASE WHEN rettype='SETOF jsonb' THEN '* FROM' ELSE '' END,sig,callargs);
 END LOOP;
 -- Revoke defaults and grant only these six entry points in both schemas.
 FOR sig IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','nexora_private') AND p.proname IN ('nh_api_enqueue_equipment','nh_api_review_allocation','nh_api_configure_allocation','nh_api_allocate_next','nh_api_cancel_allocation','nh_api_list_allocation_queue')
 LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||sig||' FROM PUBLIC,anon,authenticated'; EXECUTE 'GRANT EXECUTE ON FUNCTION '||sig||' TO authenticated'; END LOOP;
END $$;
INSERT INTO public.nh_schema_migrations(version) VALUES('20261030221131_fair_equipment_allocation') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
