BEGIN;

-- Preserve existing RLS policy dependencies while retiring the public definer entry point.
DO $$
BEGIN
 IF to_regprocedure('public.nh_is_member()') IS NOT NULL THEN
  ALTER FUNCTION public.nh_is_member() SET SCHEMA nexora_private;
 END IF;
 IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
  REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
 END IF;
END $$;
ALTER FUNCTION nexora_private.nh_is_member() SET search_path='';
REVOKE ALL ON FUNCTION nexora_private.nh_is_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nexora_private.nh_is_member() TO authenticated;


CREATE OR REPLACE FUNCTION nexora_private.nh_inventory_hospital()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT h.location_id FROM public.users u
 JOIN public.locations d ON d.location_id=u.home_department_id
 JOIN public.locations h ON h.location_id=d.parent_location_id
 WHERE u.auth_subject=(SELECT auth.uid()) AND u.is_active AND h.is_active
  AND h.location_type='hospital' AND nexora_private.nh_actor_can_request(u.user_id,d.location_id);
$$;

CREATE OR REPLACE FUNCTION nexora_private.nh_inventory_locations()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH RECURSIVE scoped(location_id) AS (
  SELECT nexora_private.nh_inventory_hospital()
  UNION ALL
  SELECT l.location_id FROM public.locations l JOIN scoped s ON l.parent_location_id=s.location_id
  WHERE l.is_active
 ) SELECT location_id FROM scoped WHERE location_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION nexora_private.nh_inventory_hospital(),
 nexora_private.nh_inventory_locations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION nexora_private.nh_inventory_hospital(),
 nexora_private.nh_inventory_locations() TO authenticated;

ALTER POLICY member_read ON public.locations
 USING(location_id IN (SELECT nexora_private.nh_inventory_locations()));
ALTER POLICY member_read ON public.equipment_assets
 USING(current_location_id IN (SELECT nexora_private.nh_inventory_locations()));
ALTER POLICY member_read ON public.inventory_thresholds
 USING(department_id IN (SELECT nexora_private.nh_inventory_locations()));
ALTER POLICY member_read ON public.equipment_categories
 USING((SELECT nexora_private.nh_inventory_hospital()) IS NOT NULL);
ALTER POLICY member_read ON public.equipment_models
 USING((SELECT nexora_private.nh_inventory_hospital()) IS NOT NULL);


CREATE OR REPLACE FUNCTION nexora_private.nh_inventory_reserve_floors()
RETURNS TABLE(department_id uuid, category_id uuid, minimum_retained integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.source_department_id,p.category_id,p.minimum_retained
 FROM public.users u
 JOIN public.locations home ON home.location_id=u.home_department_id AND home.is_active
 JOIN public.locations source ON source.parent_location_id=home.parent_location_id AND source.is_active
 JOIN public.nh_allocation_pools p ON p.source_department_id=source.location_id AND p.enabled
 WHERE u.auth_subject=auth.uid() AND u.is_active
  AND nexora_private.nh_actor_can_request(u.user_id,home.location_id);
$$;
REVOKE ALL ON FUNCTION nexora_private.nh_inventory_reserve_floors() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION nexora_private.nh_inventory_reserve_floors() TO authenticated;

CREATE OR REPLACE VIEW public.frontend_equipment_inventory_v WITH (security_invoker=true) AS
WITH assets AS (
 SELECT public.nh_department_for_location(a.current_location_id) AS department_id,m.category_id,a.asset_status
 FROM public.equipment_assets a JOIN public.equipment_models m USING(model_id)
 WHERE a.asset_status NOT IN ('retired','lost')
), summary AS (
 SELECT department_id,category_id,
  count(*)::int AS on_hand,
  count(*) FILTER (WHERE asset_status='available')::int AS available_qty,
  count(*) FILTER (WHERE asset_status='in_use')::int AS in_use,
  count(*) FILTER (WHERE asset_status='reserved')::int AS reserved,
  count(*) FILTER (WHERE asset_status='maintenance')::int AS maintenance,
  count(*) FILTER (WHERE asset_status='in_transit')::int AS in_transit,
  count(*) FILTER (WHERE asset_status='unavailable')::int AS unavailable
 FROM assets GROUP BY department_id,category_id
), equipment_keys AS (
 SELECT department_id,category_id FROM summary
 UNION SELECT department_id,category_id FROM public.inventory_thresholds
)
SELECT 'EQ-'||k.department_id||'-'||k.category_id AS id,c.name,'equipment'::text AS type,d.name AS unit,
 coalesce(s.available_qty,0) AS qty,
 CASE WHEN coalesce(s.available_qty,0)=0 THEN 'out'
  WHEN s.available_qty<=greatest(coalesce(t.low_threshold,1),coalesce(f.minimum_retained,0)) THEN 'low'
  ELSE 'available' END AS status,
 coalesce(s.on_hand,0) AS on_hand,coalesce(s.in_use,0) AS in_use,coalesce(s.reserved,0) AS reserved,
 coalesce(s.maintenance,0) AS maintenance,coalesce(s.in_transit,0) AS in_transit,
 coalesce(s.unavailable,0) AS unavailable,f.minimum_retained AS reserve_level,
 CASE WHEN f.minimum_retained IS NOT NULL THEN greatest(coalesce(s.available_qty,0)-f.minimum_retained,0) END AS transferable
FROM equipment_keys k JOIN public.equipment_categories c USING(category_id)
JOIN public.locations d ON d.location_id=k.department_id
LEFT JOIN summary s USING(department_id,category_id)
LEFT JOIN public.inventory_thresholds t USING(department_id,category_id)
LEFT JOIN nexora_private.nh_inventory_reserve_floors() f USING(department_id,category_id);

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
    'unit',s.name,'quantity',coalesce(i.qty,0),'transferable',i.transferable) ORDER BY s.name,s.location_id)
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

ALTER TABLE public.nh_supply_enquiries ADD COLUMN IF NOT EXISTS needed_by timestamptz;
ALTER TABLE public.nh_supply_enquiries ADD COLUMN IF NOT EXISTS operation_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS nh_supply_enquiry_operation ON public.nh_supply_enquiries(requested_by,operation_id)
 WHERE operation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_submit_supply_enquiry(
 p_category_id uuid,p_quantity integer,p_reason text,p_needed_by timestamptz,p_operation_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); previous public.nh_supply_enquiries%ROWTYPE;
 department uuid; enquiry uuid; reason text:=trim(p_reason);
BEGIN
 SELECT home_department_id INTO department FROM public.users WHERE user_id=actor;
 IF NOT nexora_private.nh_actor_can_request(actor,department) THEN
  RAISE EXCEPTION 'A department-scoped staff role is required' USING ERRCODE='42501';
 END IF;
 IF p_operation_id IS NULL OR p_needed_by IS NULL OR NOT isfinite(p_needed_by)
  OR length(coalesce(reason,'')) NOT BETWEEN 1 AND 2000 OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 1000 THEN
  RAISE EXCEPTION 'Enter equipment, quantity, required-by time and an operational reason' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('supply:'||actor||':'||p_operation_id,0));
 SELECT * INTO previous FROM public.nh_supply_enquiries WHERE requested_by=actor AND operation_id=p_operation_id;
 IF FOUND THEN
  IF previous.category_id IS DISTINCT FROM p_category_id OR previous.requested_quantity<>p_quantity
   OR previous.request_reason IS DISTINCT FROM reason OR previous.needed_by IS DISTINCT FROM p_needed_by
   OR previous.department_id IS DISTINCT FROM department THEN
   RAISE EXCEPTION 'Operation ID already used for another enquiry' USING ERRCODE='22023';
  END IF;
  RETURN previous.enquiry_id;
 END IF;
 IF p_needed_by<=statement_timestamp() THEN
  RAISE EXCEPTION 'Required-by time must be in the future' USING ERRCODE='22023';
 END IF;
 enquiry:=nexora_private.nh_api_create_supply_enquiry(p_category_id,p_quantity,reason);
 UPDATE public.nh_supply_enquiries SET needed_by=p_needed_by,operation_id=p_operation_id WHERE enquiry_id=enquiry;
 RETURN enquiry;
END $$;
CREATE OR REPLACE FUNCTION public.nh_api_submit_supply_enquiry(
 p_category_id uuid,p_quantity integer,p_reason text,p_needed_by timestamptz,p_operation_id uuid)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT nexora_private.nh_api_submit_supply_enquiry(p_category_id,p_quantity,p_reason,p_needed_by,p_operation_id);
$$;
REVOKE ALL ON FUNCTION public.nh_api_submit_supply_enquiry(uuid,integer,text,timestamptz,uuid),
 nexora_private.nh_api_submit_supply_enquiry(uuid,integer,text,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_submit_supply_enquiry(uuid,integer,text,timestamptz,uuid),
 nexora_private.nh_api_submit_supply_enquiry(uuid,integer,text,timestamptz,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_list_supply_enquiries() RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
 SELECT user_id INTO actor FROM public.users WHERE auth_subject=auth.uid() AND is_active;
 RETURN QUERY SELECT jsonb_build_object('enquiry_id',e.enquiry_id,'category_id',c.category_id,'item',c.name,
 'requesting_unit',d.name,'requested_quantity',e.requested_quantity,'status',e.status,
 'supplier_id',e.supplier_id,'supplier_name',s.name,'availability',e.availability,
 'available_quantity',e.available_quantity,'estimated_delivery_date',e.estimated_delivery_date,
 'needed_by',e.needed_by,'created_at',e.created_at,'updated_at',e.updated_at,
 'request_reason',CASE WHEN e.requested_by=actor OR nexora_private.nh_actor_can_source(actor,e.department_id) THEN e.request_reason ELSE NULL END,
 'can_send',e.status='requested' AND e.requested_by<>actor AND nexora_private.nh_actor_can_source(actor,e.department_id),
 'can_respond',e.status IN ('sent','responded') AND EXISTS(SELECT 1 FROM public.nh_supplier_memberships m
  WHERE m.supplier_id=e.supplier_id AND m.auth_subject=auth.uid() AND m.is_active))
 FROM public.nh_supply_enquiries e JOIN public.equipment_categories c USING(category_id)
 JOIN public.locations d ON d.location_id=e.department_id
 JOIN public.locations h ON h.location_id=d.parent_location_id
 LEFT JOIN public.nh_suppliers s USING(supplier_id)
 WHERE (actor IS NOT NULL AND (e.requested_by=actor OR nexora_private.nh_actor_can_source(actor,e.department_id)))
 OR (e.status IN ('sent','responded') AND s.is_active AND s.hospital_id=h.location_id AND d.is_active AND h.is_active
  AND EXISTS(SELECT 1 FROM public.nh_supplier_memberships m
   WHERE m.supplier_id=e.supplier_id AND m.auth_subject=auth.uid() AND m.is_active))
 ORDER BY e.created_at DESC,e.enquiry_id;
END $$;

COMMIT;
