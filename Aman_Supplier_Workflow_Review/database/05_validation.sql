-- Run after 04. Read results below. Test writes are rolled back on success.
BEGIN;
DO $$ BEGIN
 IF (SELECT count(*) FROM locations)<>10 THEN RAISE EXCEPTION 'Expected 10 demo locations'; END IF;
 IF (SELECT count(*) FROM equipment_assets)<>9 THEN RAISE EXCEPTION 'Expected 9 demo assets'; END IF;
 IF (SELECT count(*) FROM frontend_units_v)<>3 THEN RAISE EXCEPTION 'Expected 3 units'; END IF;
 IF (SELECT count(*) FROM frontend_equipment_inventory_v)<>18 THEN RAISE EXCEPTION 'Expected 18 category/unit combinations'; END IF;
 IF (SELECT qty FROM frontend_equipment_inventory_v WHERE unit='Cardiology' AND name='Infusion Pump')<>4 THEN
  RAISE EXCEPTION 'Expected 4 available Cardiology pumps'; END IF;
 IF (SELECT status FROM frontend_equipment_inventory_v WHERE unit='Oncology' AND name='Ventilator')<>'low' THEN
  RAISE EXCEPTION 'Expected low Oncology ventilator'; END IF;
 IF EXISTS(SELECT 1 FROM frontend_equipment_inventory_v GROUP BY id HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate frontend IDs'; END IF;
 IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename IN (
  'locations','roles','users','user_role_assignments','equipment_categories','equipment_models','equipment_assets',
  'inventory_thresholds','approval_policies','transfer_requests','asset_reservations','transfer_events','maintenance_records',
  'notifications','audit_logs') AND NOT rowsecurity) THEN RAISE EXCEPTION 'RLS missing'; END IF;
 IF has_function_privilege('authenticated','nh_approve_transfer(uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'Browser may execute workflow'; END IF;
 IF has_table_privilege('anon','equipment_assets','SELECT') OR has_table_privilege('authenticated','equipment_assets','UPDATE') THEN
  RAISE EXCEPTION 'Unexpected browser privilege'; END IF;
END $$;
SELECT 'PASS: seed counts, stock states, unique IDs, RLS, grants' AS result;

-- Test complete request -> approve -> transit -> complete and reject unsafe transitions.
DO $$ DECLARE a uuid; nurse uuid; approver uuid; src uuid; dst uuid; tr uuid; second_tr uuid;
BEGIN
 SELECT asset_id INTO STRICT a FROM equipment_assets WHERE asset_tag='NX-VEN-ER-001';
 SELECT user_id INTO STRICT nurse FROM users WHERE email='eli.brown@example.test';
 SELECT user_id INTO STRICT approver FROM users WHERE email='nadia.ali@example.test';
 SELECT location_id INTO STRICT src FROM locations WHERE code='ER';
 SELECT location_id INTO STRICT dst FROM locations WHERE code='CARD';
 -- Give test approver a source-scoped role; this change is rolled back.
 INSERT INTO user_role_assignments(user_id,role_id,scope_location_id)
 SELECT approver,role_id,src FROM roles WHERE role_key='chargeNurse' ON CONFLICT DO NOTHING;
 tr:=nh_request_transfer(a,dst,nurse,'Rollback-only workflow test');
 second_tr:=nh_request_transfer(a,dst,nurse,'Competing request');
 BEGIN
  PERFORM nh_approve_transfer(tr,nurse);
  RAISE EXCEPTION 'TEST FAILED: self approval succeeded';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM nh_start_transfer(tr,approver);
  RAISE EXCEPTION 'TEST FAILED: transit before approval succeeded';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
 END;
 PERFORM nh_approve_transfer(tr,approver,'Authorized source charge nurse');
 BEGIN
  PERFORM nh_approve_transfer(second_tr,approver);
  RAISE EXCEPTION 'TEST FAILED: double allocation succeeded';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
 END;
 IF (SELECT count(*) FROM asset_reservations WHERE asset_id=a AND released_at IS NULL)<>1 THEN
  RAISE EXCEPTION 'Expected exactly one active reservation'; END IF;
 PERFORM nh_start_transfer(tr,approver);
 PERFORM nh_complete_transfer(tr,approver);
 IF (SELECT transfer_status FROM transfer_requests WHERE transfer_id=tr)<>'completed' OR
  (SELECT current_location_id FROM equipment_assets WHERE asset_id=a)<>dst OR
  EXISTS(SELECT 1 FROM asset_reservations WHERE transfer_id=tr AND released_at IS NULL) OR
  (SELECT count(*) FROM transfer_events WHERE transfer_id=tr)<>5 OR
  (SELECT count(*) FROM audit_logs WHERE entity_id=tr)<>5 THEN RAISE EXCEPTION 'Completion invariant failed'; END IF;
 PERFORM nh_reject_transfer(second_tr,approver,'Competing request no longer valid');
END $$;
SELECT 'PASS: self approval denied, ordering enforced, double allocation denied, completion and audit' AS result;
SELECT * FROM frontend_equipment_inventory_v ORDER BY unit,name;
SELECT * FROM frontend_units_v ORDER BY floor,name;
ROLLBACK;
-- Returns the original seeded database; no permanent test transfers or assignments.
