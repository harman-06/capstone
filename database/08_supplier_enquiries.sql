BEGIN;
-- Sprint 3 backend contract. Enquiries do not purchase, dispatch or receive assets.
CREATE TABLE IF NOT EXISTS public.nh_suppliers (
 supplier_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 hospital_id uuid NOT NULL REFERENCES public.locations(location_id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160), is_active boolean NOT NULL DEFAULT true,
 UNIQUE(hospital_id,name)
);
CREATE TABLE IF NOT EXISTS public.nh_supplier_memberships (
 auth_subject uuid NOT NULL, supplier_id uuid NOT NULL REFERENCES public.nh_suppliers(supplier_id) ON DELETE RESTRICT,
 is_active boolean NOT NULL DEFAULT true, PRIMARY KEY(auth_subject,supplier_id)
);
CREATE TABLE IF NOT EXISTS public.nh_supply_enquiries (
 enquiry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 category_id uuid NOT NULL REFERENCES public.equipment_categories(category_id),
 department_id uuid NOT NULL REFERENCES public.locations(location_id),
 requested_by uuid NOT NULL REFERENCES public.users(user_id),
 requested_quantity integer NOT NULL CHECK(requested_quantity BETWEEN 1 AND 1000),
 request_reason text CHECK(length(request_reason)<=2000),
 supplier_id uuid REFERENCES public.nh_suppliers(supplier_id),
 sent_by uuid REFERENCES public.users(user_id),
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','sent','responded')),
 availability text CHECK(availability IN ('available','unavailable','partial')),
 available_quantity integer CHECK(available_quantity BETWEEN 0 AND 1000),
 estimated_delivery_date date,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(sent_by IS NULL OR sent_by<>requested_by),
 CHECK((status='requested' AND supplier_id IS NULL AND sent_by IS NULL)
  OR (status IN ('sent','responded') AND supplier_id IS NOT NULL AND sent_by IS NOT NULL)),
 CHECK((status<>'responded' AND availability IS NULL AND available_quantity IS NULL AND estimated_delivery_date IS NULL)
  OR (status='responded' AND availability IS NOT NULL AND available_quantity IS NOT NULL
   AND ((availability='unavailable' AND available_quantity=0 AND estimated_delivery_date IS NULL)
    OR (availability='partial' AND available_quantity>0 AND available_quantity<requested_quantity)
    OR (availability='available' AND available_quantity>=requested_quantity))))
);
CREATE INDEX IF NOT EXISTS nh_supply_enquiry_supplier ON public.nh_supply_enquiries(supplier_id,status,created_at);
CREATE INDEX IF NOT EXISTS nh_supply_enquiry_requester ON public.nh_supply_enquiries(requested_by,created_at);
CREATE INDEX IF NOT EXISTS nh_supplier_memberships_supplier ON public.nh_supplier_memberships(supplier_id);
CREATE INDEX IF NOT EXISTS nh_supply_enquiry_department ON public.nh_supply_enquiries(department_id);
CREATE INDEX IF NOT EXISTS nh_supply_enquiry_category ON public.nh_supply_enquiries(category_id);
CREATE INDEX IF NOT EXISTS nh_supply_enquiry_approver ON public.nh_supply_enquiries(sent_by);
CREATE TABLE IF NOT EXISTS public.nh_supply_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 enquiry_id uuid NOT NULL REFERENCES public.nh_supply_enquiries(enquiry_id),
 actor_auth_subject uuid NOT NULL, event_type text NOT NULL CHECK(event_type IN ('requested','sent','responded')),
 event_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nh_supply_events_enquiry ON public.nh_supply_events(enquiry_id,event_at);
ALTER TABLE public.nh_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nh_supplier_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nh_supply_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nh_supply_events ENABLE ROW LEVEL SECURITY;
-- No direct table access: narrowly scoped functions below check both identity and organization.
REVOKE ALL ON public.nh_suppliers,public.nh_supplier_memberships,public.nh_supply_enquiries,public.nh_supply_events FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.nh_supply_events_event_id_seq FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION nexora_private.nh_actor_can_source(p_actor uuid,p_department uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.locations d JOIN public.locations h ON h.location_id=d.parent_location_id
  WHERE d.location_id=p_department AND d.location_type='department' AND d.is_active
  AND h.location_type='hospital' AND h.is_active)
 AND (public.nh_has_scoped_role(p_actor,p_department,'chargeNurse') OR public.nh_has_scoped_role(p_actor,p_department,'operations'));
$$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_list_suppliers() RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); department uuid;
BEGIN
 SELECT home_department_id INTO department FROM public.users WHERE user_id=actor;
 IF NOT nexora_private.nh_actor_can_request(actor,department) THEN
  RAISE EXCEPTION 'Hospital staff scope is required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT jsonb_build_object('supplier_id',s.supplier_id,'name',s.name)
 FROM public.nh_suppliers s JOIN public.locations d ON d.location_id=department
 WHERE s.hospital_id=d.parent_location_id AND s.is_active ORDER BY s.name;
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_create_supply_enquiry(p_category_id uuid,p_quantity integer,p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); department uuid; result uuid;
BEGIN
 SELECT home_department_id INTO department FROM public.users WHERE user_id=actor;
 IF NOT nexora_private.nh_actor_can_request(actor,department) THEN
  RAISE EXCEPTION 'A department-scoped staff role is required' USING ERRCODE='42501'; END IF;
 IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 1000 OR length(coalesce(p_reason,''))>2000 THEN
  RAISE EXCEPTION 'Enter a whole quantity from 1 to 1000 and a reason up to 2000 characters'; END IF;
 INSERT INTO public.nh_supply_enquiries(category_id,department_id,requested_by,requested_quantity,request_reason)
 VALUES(p_category_id,department,actor,p_quantity,p_reason) RETURNING enquiry_id INTO result;
 INSERT INTO public.nh_supply_events(enquiry_id,actor_auth_subject,event_type) VALUES(result,auth.uid(),'requested');
 INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id)
 VALUES(actor,'supply.requested','supply_enquiry',result);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_send_supply_enquiry(p_enquiry_id uuid,p_supplier_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=nexora_private.nh_current_actor(); e public.nh_supply_enquiries%ROWTYPE;
BEGIN
 SELECT * INTO e FROM public.nh_supply_enquiries WHERE enquiry_id=p_enquiry_id FOR UPDATE;
 IF NOT FOUND OR e.requested_by=actor OR NOT nexora_private.nh_actor_can_source(actor,e.department_id) THEN
  RAISE EXCEPTION 'This account cannot authorize this enquiry' USING ERRCODE='42501'; END IF;
 IF e.status<>'requested' THEN RAISE EXCEPTION 'Only a new enquiry may be sent'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.nh_suppliers s JOIN public.locations d ON d.location_id=e.department_id
  WHERE s.supplier_id=p_supplier_id AND s.hospital_id=d.parent_location_id AND s.is_active) THEN
  RAISE EXCEPTION 'Choose an active supplier assigned to this hospital'; END IF;
 UPDATE public.nh_supply_enquiries SET supplier_id=p_supplier_id,sent_by=actor,status='sent',updated_at=now()
 WHERE enquiry_id=p_enquiry_id;
 INSERT INTO public.nh_supply_events(enquiry_id,actor_auth_subject,event_type) VALUES(p_enquiry_id,auth.uid(),'sent');
 INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id)
 VALUES(actor,'supply.sent','supply_enquiry',p_enquiry_id);
END $$;

CREATE OR REPLACE FUNCTION nexora_private.nh_api_respond_supply_enquiry(p_enquiry_id uuid,p_availability text,
 p_available_quantity integer,p_estimated_delivery_date date DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.nh_supply_enquiries%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.nh_supply_enquiries WHERE enquiry_id=p_enquiry_id FOR UPDATE;
 IF NOT FOUND OR e.status NOT IN ('sent','responded') OR NOT EXISTS(
  SELECT 1 FROM public.nh_supplier_memberships m JOIN public.nh_suppliers s USING(supplier_id)
  JOIN public.locations d ON d.location_id=e.department_id
  JOIN public.locations h ON h.location_id=d.parent_location_id
  WHERE m.auth_subject=auth.uid() AND m.supplier_id=e.supplier_id AND m.is_active AND s.is_active
  AND s.hospital_id=h.location_id AND d.is_active AND h.is_active) THEN
  RAISE EXCEPTION 'This account cannot respond to this enquiry' USING ERRCODE='42501'; END IF;
 IF p_availability IS NULL OR p_availability NOT IN ('available','unavailable','partial')
  OR p_available_quantity IS NULL OR p_available_quantity NOT BETWEEN 0 AND 1000
  OR (p_availability='available' AND p_available_quantity<e.requested_quantity)
  OR (p_availability='partial' AND (p_available_quantity=0 OR p_available_quantity>=e.requested_quantity))
  OR (p_availability='unavailable' AND (p_available_quantity<>0 OR p_estimated_delivery_date IS NOT NULL))
  OR p_estimated_delivery_date<current_date THEN RAISE EXCEPTION 'Invalid availability, quantity or delivery date'; END IF;
 -- Repeated identical saves are a no-op, not duplicate records/events.
 IF e.status='responded' AND e.availability=p_availability AND e.available_quantity=p_available_quantity
  AND e.estimated_delivery_date IS NOT DISTINCT FROM p_estimated_delivery_date THEN RETURN; END IF;
 UPDATE public.nh_supply_enquiries SET status='responded',availability=p_availability,
 available_quantity=p_available_quantity,estimated_delivery_date=p_estimated_delivery_date,updated_at=now()
 WHERE enquiry_id=p_enquiry_id;
 INSERT INTO public.nh_supply_events(enquiry_id,actor_auth_subject,event_type) VALUES(p_enquiry_id,auth.uid(),'responded');
 INSERT INTO public.audit_logs(action,entity_type,entity_id) VALUES('supply.responded','supply_enquiry',p_enquiry_id);
END $$;

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
 'created_at',e.created_at,'updated_at',e.updated_at,
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

REVOKE ALL ON FUNCTION nexora_private.nh_actor_can_source(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION nexora_private.nh_api_list_suppliers(),nexora_private.nh_api_create_supply_enquiry(uuid,integer,text),
 nexora_private.nh_api_send_supply_enquiry(uuid,uuid),nexora_private.nh_api_respond_supply_enquiry(uuid,text,integer,date),
 nexora_private.nh_api_list_supply_enquiries() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION nexora_private.nh_api_list_suppliers(),nexora_private.nh_api_create_supply_enquiry(uuid,integer,text),
 nexora_private.nh_api_send_supply_enquiry(uuid,uuid),nexora_private.nh_api_respond_supply_enquiry(uuid,text,integer,date),
 nexora_private.nh_api_list_supply_enquiries() TO authenticated;

-- Exposed entry points are SECURITY INVOKER; all authorization stays in private implementations.
CREATE OR REPLACE FUNCTION public.nh_api_list_suppliers() RETURNS SETOF jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT * FROM nexora_private.nh_api_list_suppliers();
$$;
REVOKE ALL ON FUNCTION public.nh_api_list_suppliers() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_list_suppliers() TO authenticated;
CREATE OR REPLACE FUNCTION public.nh_api_create_supply_enquiry(p_category_id uuid,p_quantity integer,p_reason text DEFAULT NULL) RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT nexora_private.nh_api_create_supply_enquiry(p_category_id,p_quantity,p_reason);
$$;
REVOKE ALL ON FUNCTION public.nh_api_create_supply_enquiry(uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_create_supply_enquiry(uuid,integer,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.nh_api_send_supply_enquiry(p_enquiry_id uuid,p_supplier_id uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT nexora_private.nh_api_send_supply_enquiry(p_enquiry_id,p_supplier_id);
$$;
REVOKE ALL ON FUNCTION public.nh_api_send_supply_enquiry(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_send_supply_enquiry(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.nh_api_respond_supply_enquiry(p_enquiry_id uuid,p_availability text,p_available_quantity integer,p_estimated_delivery_date date DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT nexora_private.nh_api_respond_supply_enquiry(p_enquiry_id,p_availability,p_available_quantity,p_estimated_delivery_date);
$$;
REVOKE ALL ON FUNCTION public.nh_api_respond_supply_enquiry(uuid,text,integer,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_respond_supply_enquiry(uuid,text,integer,date) TO authenticated;
CREATE OR REPLACE FUNCTION public.nh_api_list_supply_enquiries() RETURNS SETOF jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT * FROM nexora_private.nh_api_list_supply_enquiries();
$$;
REVOKE ALL ON FUNCTION public.nh_api_list_supply_enquiries() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nh_api_list_supply_enquiries() TO authenticated;

INSERT INTO public.nh_schema_migrations(version) VALUES('08_supplier_enquiries') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
