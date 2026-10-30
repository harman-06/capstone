BEGIN;
CREATE INDEX IF NOT EXISTS nh_allocation_pool_category ON public.nh_allocation_pools(category_id);
CREATE INDEX IF NOT EXISTS nh_allocation_runs_pool ON public.nh_allocation_runs(source_department_id,category_id);
CREATE INDEX IF NOT EXISTS nh_allocation_recent_sharing ON public.transfer_requests(from_department_id,to_department_id,decided_at DESC)
 INCLUDE(asset_id) WHERE transfer_status IN ('reserved','in_transit','completed');
-- Keep actionable backlog visible before completed history; preserve grants and security mode.
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
 ORDER BY (q.status='queued') DESC, CASE WHEN q.status='queued' THEN q.created_at END ASC,q.created_at DESC,q.request_id LIMIT 200;
END $$;

INSERT INTO public.nh_schema_migrations(version) VALUES('20261030222202_allocation_lookup_indexes') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
