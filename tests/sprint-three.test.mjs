import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { install, context, requestHistoryMigrationPath, subjects } from './allocation-fixtures.mjs';

test('Sprint 3 stock and supplier workflows honor database permissions and preserve audit state', async () => {
  const db = new PGlite();
  try {
    await install(sql => db.exec(sql));
    const query = async sql => (await db.query(sql)).rows;
    const ctx = await context(query);
    const migration = await readFile(new URL('../supabase/migrations/20261123151007_sprint_three_supplier_and_inventory.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(await readFile(new URL('../'+requestHistoryMigrationPath,import.meta.url),'utf8'));
    async function as(subject, sql, values = [], role = 'authenticated') {
      await db.exec('BEGIN');
      try {
        await db.exec('SET LOCAL ROLE ' + role);
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [subject]);
        const result = (await db.query(sql,values)).rows;
        await db.exec('COMMIT');
        return result;
      } catch (error) { await db.exec('ROLLBACK'); throw error; }
    }
    const supplier = crypto.randomUUID(), other = crypto.randomUUID();
    const createSupplier = async (subject, suffix) => {
      const [row] = (await db.query(
        "INSERT INTO nh_suppliers(hospital_id,name) SELECT location_id,$1 FROM locations WHERE code='NDH' RETURNING supplier_id",
        ['Synthetic vendor ' + suffix])).rows;
      await db.query('INSERT INTO nh_supplier_memberships(auth_subject,supplier_id) VALUES($1,$2)',[subject,row.supplier_id]);
      return row.supplier_id;
    };
    const supplierId = await createSupplier(supplier,'A');
    await createSupplier(other,'B');

    const stock = 'SELECT qty,on_hand,in_use,reserved,maintenance,in_transit,unavailable,reserve_level,transferable FROM frontend_equipment_inventory_v WHERE id=$1';
    await assert.rejects(as('',stock,[ctx.source],'anon'), /permission denied/);
    assert.deepEqual(await as(supplier,stock,[ctx.source]), []);
    assert.deepEqual(await as(subjects.outsider,stock,[ctx.source]), []);
    const [otherSite] = (await db.query(`
      WITH hospital AS (
        INSERT INTO locations(location_type,code,name) VALUES('hospital','SITE-B','Synthetic second hospital') RETURNING location_id
      ), department AS (
        INSERT INTO locations(parent_location_id,location_type,code,name)
        SELECT location_id,'department','SITE-B-ER','Synthetic second emergency' FROM hospital RETURNING location_id
      )
      INSERT INTO equipment_assets(asset_tag,model_id,current_location_id,asset_status)
      SELECT 'SYNTHETIC-SITE-B',m.model_id,d.location_id,'available'
      FROM (SELECT model_id FROM equipment_models WHERE category_id=$1 LIMIT 1) m CROSS JOIN department d
      RETURNING current_location_id,asset_id`,[ctx.category_id])).rows;
    assert.deepEqual(await as(subjects.a,'SELECT location_id FROM locations WHERE location_id=$1',[otherSite.current_location_id]),[]);
    assert.deepEqual(await as(subjects.a,'SELECT asset_id FROM equipment_assets WHERE asset_id=$1',[otherSite.asset_id]),[]);
    assert.deepEqual(await as(subjects.a,stock,['EQ-'+otherSite.current_location_id+'-'+ctx.category_id]),[]);
    const [patient] = (await db.query(`
      INSERT INTO users(email,display_name,home_department_id,auth_subject)
      SELECT 'synthetic-patient@example.test','Synthetic Patient',location_id,$1 FROM locations WHERE code='CARD'
      RETURNING user_id`,[crypto.randomUUID()])).rows;
    const [{auth_subject:patientSubject}] = (await db.query('SELECT auth_subject FROM users WHERE user_id=$1',[patient.user_id])).rows;
    assert.deepEqual(await as(patientSubject,stock,[ctx.source]),[]);
    assert.deepEqual((await as(patientSubject,'SELECT user_id FROM users')).map(row=>row.user_id),[patient.user_id]);
    const [stockBefore] = await as(subjects.a,stock,[ctx.source]);
    assert.equal(stockBefore.qty,2);
    assert.equal(stockBefore.reserve_level,null);
    await as(subjects.coordinator,'SELECT nh_api_configure_allocation($1,$2,1)',[ctx.source_id,ctx.category_id]);
    const [stockAfter] = await as(subjects.a,stock,[ctx.source]);
    assert.equal(stockAfter.reserve_level,1);
    assert.equal(stockAfter.transferable,1);
    assert.equal(stockAfter.on_hand,stockAfter.qty + stockAfter.in_use + stockAfter.reserved +
      stockAfter.maintenance + stockAfter.in_transit + stockAfter.unavailable);

    const submit = 'SELECT nh_api_submit_supply_enquiry($1,$2,$3,$4,$5) AS enquiry';
    const due = new Date(Date.now()+3600000).toISOString();
    const request = [ctx.category_id,2,'Synthetic hospital-only shortage reason',due,crypto.randomUUID()];
    await assert.rejects(as('',submit,request,'anon'), /permission denied/);
    await assert.rejects(as(supplier,submit,request), /hospital profile/);
    await assert.rejects(as(subjects.a,submit,[...request.slice(0,3),null,request[4]]), /required-by/);
    const [{enquiry}] = await as(subjects.a,submit,request);
    assert.deepEqual(await as(subjects.a,submit,request),[{enquiry}]);
    await assert.rejects(as(subjects.a,submit,[request[0],1,...request.slice(2)]), /already used/);
    const enquiryHistory = async subject => (await as(subject,
      "SELECT nh_api_request_history('supplier',$1) AS history",[enquiry]))[0].history;
    assert.deepEqual((await enquiryHistory(subjects.a)).map(e=>e.stage),['requested']);
    await assert.rejects(enquiryHistory(supplier),/unavailable for this account/);
    const list = 'SELECT nh_api_list_supply_enquiries() AS item';
    assert.deepEqual(await as(supplier,list),[]);
    await assert.rejects(as(subjects.a,'SELECT nh_api_send_supply_enquiry($1,$2)',[enquiry,supplierId]), /cannot authorize/);
    await db.query(`
      INSERT INTO user_role_assignments(user_id,role_id,scope_location_id)
      SELECT u.user_id,r.role_id,d.location_id FROM users u,roles r,locations d
      WHERE u.auth_subject=$1 AND r.role_key='chargeNurse' AND d.code='CARD'`,[subjects.coordinator]);
    await as(subjects.coordinator,'SELECT nh_api_send_supply_enquiry($1,$2)',[enquiry,supplierId]);
    const [{item}] = await as(supplier,list);
    assert.equal(new Date(item.needed_by).toISOString(),due);
    assert.equal(item.request_reason,null);
    assert.equal('requested_by' in item,false);
    assert.deepEqual(await as(other,list),[]);
    await assert.rejects(as(other,"SELECT nh_api_respond_supply_enquiry($1,'partial',1)",[enquiry]),/cannot respond/);
    await as(supplier,"SELECT nh_api_respond_supply_enquiry($1,'partial',1,current_date+1)",[enquiry]);
    const [hospital] = await as(subjects.a,list);
    const supplierHistory = await enquiryHistory(supplier);
    assert.deepEqual(supplierHistory.map(e=>e.stage),['requested','sent','responded']);
    assert.deepEqual(await enquiryHistory(subjects.a),supplierHistory);
    assert.ok(supplierHistory.every(e=>Object.keys(e).sort().join(',')==='at,stage'));
    await assert.rejects(enquiryHistory(other),/unavailable for this account/);
    assert.equal(hospital.item.availability,'partial');
    assert.equal(hospital.item.available_quantity,1);
    assert.deepEqual(await as(subjects.a,stock,[ctx.source]),[stockAfter]);
    await assert.rejects(as(supplier,'SELECT * FROM nh_supply_enquiries'), /permission denied/);
    assert.equal((await query("SELECT to_regprocedure('public.nh_is_member()') AS fn"))[0].fn,null);
    const wrappers = await query(`
      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'nh_api_%'
      AND (p.prosecdef OR has_function_privilege('anon',p.oid,'EXECUTE'))`);
    assert.deepEqual(wrappers,[]);
    const seed = await readFile(new URL('../database/11_expand_demo_inventory.sql', import.meta.url), 'utf8');
    await db.exec(seed);
    const [scaled] = await as(subjects.a,stock,[ctx.source]);
    assert.equal(scaled.qty,8);
    assert.equal(scaled.on_hand,12);
    assert.equal(scaled.transferable,7);
    assert.deepEqual((await query("SELECT qty FROM frontend_equipment_inventory_v WHERE name='Portable Ultrasound'")).map(r=>r.qty),[0,0,0]);
    const [moved] = (await db.query(
      "UPDATE equipment_assets SET current_location_id=(SELECT location_id FROM locations WHERE code='CARD') WHERE asset_tag='NX-DEMO-SCALE-ER-C6-001' RETURNING current_location_id"
    )).rows;
    await db.exec(seed);
    const [afterReplay] = await as(subjects.a,stock,[ctx.source]);
    assert.equal(afterReplay.qty,7);
    assert.equal((await query("SELECT current_location_id FROM equipment_assets WHERE asset_tag='NX-DEMO-SCALE-ER-C6-001'"))[0].current_location_id,moved.current_location_id);
  } finally { await db.close(); }
});
