BEGIN;
-- Only provisioned active members may read equipment data. No anonymous reads.
CREATE OR REPLACE FUNCTION nh_is_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.users WHERE auth_subject=(SELECT auth.uid()) AND is_active);
$$;
REVOKE ALL ON FUNCTION nh_is_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nh_is_member() TO authenticated;

DO $$ DECLARE n text; f record; BEGIN
 FOREACH n IN ARRAY ARRAY['locations','roles','users','user_role_assignments','equipment_categories','equipment_models',
 'equipment_assets','inventory_thresholds','approval_policies','transfer_requests','asset_reservations','transfer_events',
 'maintenance_records','notifications','audit_logs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated',n);
 END LOOP;
 -- PostgreSQL functions are executable by PUBLIC by default; close all Nexora functions first.
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'nh_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION nh_is_member(),nh_department_for_location(uuid) TO authenticated;

GRANT SELECT ON locations,equipment_categories,equipment_models,equipment_assets,inventory_thresholds TO authenticated;
CREATE POLICY member_read ON locations FOR SELECT TO authenticated USING ((SELECT nh_is_member()));
CREATE POLICY member_read ON equipment_categories FOR SELECT TO authenticated USING ((SELECT nh_is_member()));
CREATE POLICY member_read ON equipment_models FOR SELECT TO authenticated USING ((SELECT nh_is_member()));
CREATE POLICY member_read ON equipment_assets FOR SELECT TO authenticated USING ((SELECT nh_is_member()));
CREATE POLICY member_read ON inventory_thresholds FOR SELECT TO authenticated USING ((SELECT nh_is_member()));
GRANT SELECT ON users,notifications TO authenticated;
CREATE POLICY read_own ON users FOR SELECT TO authenticated USING (auth_subject=(SELECT auth.uid()) AND is_active);
CREATE POLICY read_own ON notifications FOR SELECT TO authenticated USING (
 user_id IN (SELECT user_id FROM users WHERE auth_subject=(SELECT auth.uid()) AND is_active));

REVOKE ALL ON frontend_equipment_inventory_v,frontend_units_v,equipment_asset_detail_v,pending_transfer_v FROM anon,authenticated;
GRANT SELECT ON frontend_equipment_inventory_v,frontend_units_v TO authenticated;
-- Detailed assets and transfers are SQL-editor only at this stage.
-- Workflow functions remain SECURITY INVOKER with no browser EXECUTE or direct write grants.
COMMIT;
