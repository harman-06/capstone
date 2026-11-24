BEGIN;
-- Add a hospital-required date to the existing supplier enquiry workflow.
ALTER TABLE public.nh_supply_enquiries
  ADD COLUMN IF NOT EXISTS required_by_date date;

-- Add a four-argument overload while retaining the original three-argument RPC.
-- This avoids breaking existing clients and avoids dropping functions with dependencies.
CREATE OR REPLACE FUNCTION nexora_private.nh_api_create_supply_enquiry(
 p_category_id uuid, p_quantity integer, p_reason text,
 p_required_by_date date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); department uuid; result uuid;
BEGIN
 SELECT home_department_id INTO department FROM public.users WHERE user_id=actor;
 IF NOT nexora_private.nh_actor_can_request(actor,department) THEN
  RAISE EXCEPTION 'A department-scoped staff role is required' USING ERRCODE='42501'; END IF;
 IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 1000
  OR length(coalesce(p_reason,''))>2000 OR (p_required_by_date IS NOT NULL AND p_required_by_date<current_date) THEN
  RAISE EXCEPTION 'Enter a valid quantity, reason and required-by date'; END IF;
 INSERT INTO public.nh_supply_enquiries(category_id,department_id,requested_by,requested_quantity,request_reason,required_by_date)
 VALUES(p_category_id,department,actor,p_quantity,p_reason,p_required_by_date) RETURNING enquiry_id INTO result;
 INSERT INTO public.nh_supply_events(enquiry_id,actor_auth_subject,event_type)
 VALUES(result,auth.uid(),'requested');
 INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id)
 VALUES(actor,'supply.requested','supply_enquiry',result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION nexora_private.nh_api_create_supply_enquiry(uuid,integer,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION nexora_private.nh_api_create_supply_enquiry(uuid,integer,text,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.nh_api_create_supply_enquiry(
 p_category_id uuid, p_quantity integer, p_reason text,
 p_required_by_date date
) RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT nexora_private.nh_api_create_supply_enquiry(p_category_id,p_quantity,p_reason,p_required_by_date);
$$;
REVOKE ALL ON FUNCTION public.nh_api_create_supply_enquiry(uuid,integer,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_create_supply_enquiry(uuid,integer,text,date) TO authenticated;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_list_supply_enquiries() RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
 SELECT user_id INTO actor FROM public.users WHERE auth_subject=auth.uid() AND is_active;
 RETURN QUERY SELECT jsonb_build_object(
  'enquiry_id',e.enquiry_id,'category_id',c.category_id,'item',c.name,
  'requesting_unit',d.name,'requested_quantity',e.requested_quantity,'required_by_date',e.required_by_date,
  'status',e.status,'supplier_id',e.supplier_id,'supplier_name',s.name,
  'availability',e.availability,'available_quantity',e.available_quantity,
  'estimated_delivery_date',e.estimated_delivery_date,'created_at',e.created_at,'updated_at',e.updated_at,
  'request_reason',CASE WHEN e.requested_by=actor OR nexora_private.nh_actor_can_source(actor,e.department_id) THEN e.request_reason ELSE NULL END,
  'can_send',e.status='requested' AND e.requested_by<>actor AND nexora_private.nh_actor_can_source(actor,e.department_id),
  'can_respond',e.status IN ('sent','responded') AND EXISTS(
    SELECT 1 FROM public.nh_supplier_memberships m
    WHERE m.supplier_id=e.supplier_id AND m.auth_subject=auth.uid() AND m.is_active)
 )
 FROM public.nh_supply_enquiries e
 JOIN public.equipment_categories c USING(category_id)
 JOIN public.locations d ON d.location_id=e.department_id
 JOIN public.locations h ON h.location_id=d.parent_location_id
 LEFT JOIN public.nh_suppliers s USING(supplier_id)
 WHERE (actor IS NOT NULL AND (e.requested_by=actor OR nexora_private.nh_actor_can_source(actor,e.department_id)))
 OR (e.status IN ('sent','responded') AND s.is_active AND s.hospital_id=h.location_id AND d.is_active AND h.is_active
  AND EXISTS(SELECT 1 FROM public.nh_supplier_memberships m
   WHERE m.supplier_id=e.supplier_id AND m.auth_subject=auth.uid() AND m.is_active))
 ORDER BY e.created_at DESC,e.enquiry_id;
END $$;
REVOKE ALL ON FUNCTION nexora_private.nh_api_list_supply_enquiries() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION nexora_private.nh_api_list_supply_enquiries() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
