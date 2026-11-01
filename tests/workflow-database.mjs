import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
const file = name => readFile(new URL(`../database/${name}`, import.meta.url), 'utf8');
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
for (const name of ['00_schema.sql','01_workflow_functions.sql','02_views.sql','03_seed_demo.sql','04_rls.sql',
  '07_authenticated_workflows.sql','08_supplier_enquiries.sql']) await db.exec(await file(name));
const value = async sql => Object.values((await db.query(sql)).rows[0])[0];
const nurse='11111111-1111-4111-8111-111111111111';
const approver='22222222-2222-4222-8222-222222222222';
const supplier='33333333-3333-4333-8333-333333333333';
const unrelated='44444444-4444-4444-8444-444444444444';
const outsider='55555555-5555-4555-8555-555555555555';
await db.exec(`UPDATE users SET auth_subject='${nurse}' WHERE email='eli.brown@example.test';
UPDATE users SET auth_subject='${approver}' WHERE email='nadia.ali@example.test';
INSERT INTO user_role_assignments(user_id,role_id,scope_location_id)
SELECT u.user_id,r.role_id,l.location_id FROM users u,roles r,locations l
WHERE u.email='nadia.ali@example.test' AND r.role_key='chargeNurse' AND l.code='ER';`);
const source = await value("SELECT 'EQ-'||d.location_id::text||'-'||c.category_id::text FROM locations d,equipment_categories c WHERE d.code='ER' AND c.name='Ventilator'");
const category = await value("SELECT category_id FROM equipment_categories WHERE name='Ventilator'");
const supplierId = await value("INSERT INTO nh_suppliers(hospital_id,name) SELECT location_id,'Demo supplier' FROM locations WHERE code='NDH' RETURNING supplier_id");
const otherSupplier = await value("INSERT INTO nh_suppliers(hospital_id,name) SELECT location_id,'Unrelated supplier' FROM locations WHERE code='NDH' RETURNING supplier_id");
await db.exec(`INSERT INTO nh_supplier_memberships(auth_subject,supplier_id) VALUES('${supplier}','${supplierId}'),('${unrelated}','${otherSupplier}');`);
async function as(subject, fn, role='authenticated') {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${subject}',true);`);
  try { const result=await fn(); await db.exec('COMMIT'); return result; }
  catch(error) { await db.exec('ROLLBACK'); throw error; }
}
const denied = (subject,sql,pattern=/permission denied|profile|required|cannot|not available|unit|Only|Invalid|Choose|quantity/i,role) =>
  assert.rejects(as(subject,()=>db.exec(sql),role),pattern);
await denied('',`SELECT nh_api_request_equipment('${source}')`,/permission denied/,'anon');
await denied(outsider,`SELECT nh_api_request_equipment('${source}')`);
await denied(nurse,"SELECT nh_request_transfer(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),NULL)",/permission denied/);
await denied(nurse,"UPDATE equipment_assets SET asset_status='lost'",/permission denied/);
await denied(nurse,"SELECT nh_api_request_equipment('x-bgm-e01')");
const id = await as(nurse,()=>value(`SELECT nh_api_request_equipment('${source}','Synthetic request')`));
assert.equal(await value(`SELECT transfer_status FROM transfer_requests WHERE transfer_id='${id}'`),'requested');
assert.equal(await as(nurse,()=>value('SELECT count(*)::int FROM nh_api_list_transfers()')),1);
// Give the requester an otherwise eligible approval role: self-approval must still fail.
await db.exec(`INSERT INTO user_role_assignments(user_id,role_id,scope_location_id)
 SELECT u.user_id,r.role_id,l.location_id FROM users u,roles r,locations l
 WHERE u.auth_subject='${nurse}' AND r.role_key='chargeNurse' AND l.code='ER';`);
await denied(nurse,`SELECT nh_api_decide_transfer('${id}',true)`);
await denied(outsider,`SELECT nh_api_decide_transfer('${id}',true)`);
await denied(approver,`SELECT nh_api_decide_transfer('${id}',NULL)`);
await as(approver,()=>db.exec(`SELECT nh_api_decide_transfer('${id}',true)`));
assert.equal(await value(`SELECT transfer_status FROM transfer_requests WHERE transfer_id='${id}'`),'reserved');
assert.equal(await value(`SELECT count(*)::int FROM asset_reservations WHERE transfer_id='${id}' AND released_at IS NULL`),1);
await denied(approver,`SELECT nh_api_decide_transfer('${id}',true)`);
assert.equal(await value(`SELECT count(*)::int FROM asset_reservations WHERE transfer_id='${id}'`),1);
const rejected = await as(nurse,()=>value(`SELECT nh_api_request_equipment('${source}')`));
await as(approver,()=>db.exec(`SELECT nh_api_decide_transfer('${rejected}',false,'Not needed')`));
assert.equal(await value(`SELECT transfer_status FROM transfer_requests WHERE transfer_id='${rejected}'`),'rejected');
console.log('PASS actor-bound hospital requests, decisions, reservations, denial and persisted reads');
const enquiry = await as(nurse,()=>value(`SELECT nh_api_create_supply_enquiry('${category}',2,'Hospital-only note')`));
assert.equal(await as(supplier,()=>value('SELECT count(*)::int FROM nh_api_list_supply_enquiries()')),0);
await denied(nurse,`SELECT nh_api_send_supply_enquiry('${enquiry}','${supplierId}')`);
await denied(supplier,`SELECT nh_api_send_supply_enquiry('${enquiry}','${supplierId}')`);
await denied(supplier,`SELECT nh_api_respond_supply_enquiry('${enquiry}','available',2)`);
await as(approver,()=>db.exec(`SELECT nh_api_send_supply_enquiry('${enquiry}','${supplierId}')`));
assert.equal(await as(supplier,()=>value('SELECT count(*)::int FROM nh_api_list_supply_enquiries()')),1);
assert.equal(await as(unrelated,()=>value('SELECT count(*)::int FROM nh_api_list_supply_enquiries()')),0);
const supplierView = await as(supplier,()=>value('SELECT * FROM nh_api_list_supply_enquiries()'));
assert.equal(supplierView.request_reason,null);
assert.equal(supplierView.can_respond,true);
assert.equal('requested_by' in supplierView,false);
await denied(unrelated,`SELECT nh_api_respond_supply_enquiry('${enquiry}','available',2)`);
await denied(nurse,`SELECT nh_api_respond_supply_enquiry('${enquiry}','available',2)`);
await denied(supplier,`SELECT nh_api_respond_supply_enquiry('${enquiry}','available',1)`);
await denied(supplier,`SELECT nh_api_respond_supply_enquiry('${enquiry}','partial',2)`);
await denied(supplier,`SELECT nh_api_respond_supply_enquiry('${enquiry}',NULL,2)`);
await as(supplier,()=>db.exec(`SELECT nh_api_respond_supply_enquiry('${enquiry}','available',2,current_date+2)`));
const events=await value(`SELECT count(*)::int FROM nh_supply_events WHERE enquiry_id='${enquiry}'`);
await as(supplier,()=>db.exec(`SELECT nh_api_respond_supply_enquiry('${enquiry}','available',2,current_date+2)`));
assert.equal(await value(`SELECT count(*)::int FROM nh_supply_events WHERE enquiry_id='${enquiry}'`),events);
const hospitalView = await as(nurse,()=>value('SELECT * FROM nh_api_list_supply_enquiries()'));
assert.equal(hospitalView.status,'responded'); assert.equal(hospitalView.available_quantity,2);
assert.equal(hospitalView.request_reason,'Hospital-only note');
await denied(supplier,'SELECT * FROM nh_supply_enquiries',/permission denied/);
await denied(supplier,'SELECT * FROM nh_supplier_memberships',/permission denied/);
await db.exec(`UPDATE nh_supplier_memberships SET is_active=false WHERE auth_subject='${supplier}'`);
assert.equal(await as(supplier,()=>value('SELECT count(*)::int FROM nh_api_list_supply_enquiries()')),0);
await denied(supplier,`SELECT nh_api_respond_supply_enquiry('${enquiry}','unavailable',0)`);
await db.exec(`UPDATE users SET is_active=false WHERE auth_subject='${nurse}'`);
await denied(nurse,`SELECT nh_api_request_equipment('${source}')`);
assert.equal(await as(nurse,()=>value('SELECT count(*)::int FROM nh_api_list_supply_enquiries()')),0);
console.log('PASS supplier isolation, hospital-only fields, authorization, response validation, replay and revoked membership');
await db.exec(await file('07_authenticated_workflows.sql'));
await db.exec(await file('08_supplier_enquiries.sql'));
assert.equal(await value('SELECT count(*)::int FROM nh_schema_migrations'),2);
assert.equal(await value(`SELECT count(*)::int FROM nh_supply_enquiries WHERE enquiry_id='${enquiry}'`),1);
assert.equal(await value(`SELECT count(*)::int FROM nh_supply_events WHERE enquiry_id='${enquiry}'`),events);
assert.equal(await value("SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'nh_api_%' AND p.prosecdef"),0);
console.log('PASS additive migrations can be reapplied without deleting requests or audit history');
await db.close();
