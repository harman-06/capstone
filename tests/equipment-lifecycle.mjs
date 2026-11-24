
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {context, install, handoffMigrationPath, subjects} from './allocation-fixtures.mjs';

const db = new PGlite();
try {
  await install(sql => db.exec(sql));
  await db.exec(await readFile(new URL('../'+handoffMigrationPath,import.meta.url),'utf8'));
  const query = async sql => (await db.query(sql)).rows;
  const ctx = await context(query);
  async function as(subject, sql, params = [], role = 'authenticated') {
    await db.exec('BEGIN');
    try {
      await db.exec('SET LOCAL ROLE ' + role);
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[subject]);
      const result = (await db.query(sql,params)).rows.map(row => Object.values(row)[0]);
      await db.exec('COMMIT');
      return result;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }
  const sources = 'SELECT nh_api_equipment_sources($1)';
  const [options] = await as(subjects.a, sources, [ctx.category_id]);
  const [destination] = await query("SELECT location_id,name FROM locations WHERE code='CARD'");
  assert.equal(options.destination,destination.name);
  assert.ok(options.sources.some(source => source.id === ctx.source && source.quantity === 2));
  assert.ok(options.sources.every(source => !source.id.includes(destination.location_id)));
  await assert.rejects(as(subjects.outsider,sources,[ctx.category_id]),/active hospital profile/);
  await assert.rejects(as('',sources,[ctx.category_id],'anon'),/permission denied/);

  const submit = 'SELECT nh_api_submit_equipment_need($1,$2,$3,$4)';
  const due = new Date(Date.now() + 3600000).toISOString();
  const key = crypto.randomUUID();
  const input = [ctx.source,key,'Synthetic simulation stock shortage',due];
  const [need] = await as(subjects.a,submit,input);
  assert.deepEqual(await as(subjects.a,submit,input),[need]);
  await assert.rejects(as(subjects.a,submit,[...input.slice(0,3),new Date(Date.now()+7200000).toISOString()]),/different required-by/);
  await assert.rejects(as(subjects.a,submit,[ctx.source,crypto.randomUUID(),input[2],due]),/already has a queued/);
  await assert.rejects(as(subjects.b,submit,[ctx.source,crypto.randomUUID(),'  ',due]),/operational reason/);
  await assert.rejects(as(subjects.b,submit,[ctx.source,crypto.randomUUID(),input[2],'2000-01-01']),/future/);
  const [queued] = await as(subjects.a,'SELECT nh_api_list_allocation_queue()');
  assert.equal(queued.status,'queued');
  assert.equal(queued.reason,input[2]);
  assert.equal(new Date(queued.requested_needed_by).toISOString(),due);
  assert.equal(queued.destination_unit,destination.name);
  await assert.rejects(as(subjects.a,'SELECT nh_api_review_allocation($1,3,$2,$3)',[need,due,'Synthetic self review']),/different authorized/);
  await as(subjects.coordinator,'SELECT nh_api_review_allocation($1,2,$2,$3)',[need,null,'Verified in synthetic simulation']);
  assert.deepEqual(await as(subjects.a,submit,input),[need],'review cannot change the retry payload');
  await as(subjects.coordinator,'SELECT nh_api_configure_allocation($1,$2,1)',[ctx.source_id,ctx.category_id]);
  const [allocation] = await as(subjects.coordinator,'SELECT nh_api_allocate_next($1,$2,$3)',[ctx.source_id,ctx.category_id,crypto.randomUUID()]);
  const transfer = allocation.transfer_id;
  assert.equal(allocation.request_id,need);
  assert.deepEqual(await as(subjects.a,submit,input),[need],'request retries remain safe after allocation');
  const receiveSubject = subjects.outsider;
  await db.query(`
    INSERT INTO users(email,display_name,home_department_id,auth_subject)
    VALUES('allocation-receiver@example.test','receiver',$1,$2)`,[destination.location_id,receiveSubject]);
  await db.query(`
    INSERT INTO user_role_assignments(user_id,role_id,scope_location_id)
    SELECT u.user_id,r.role_id,u.home_department_id FROM users u,roles r
    WHERE u.auth_subject=$1 AND r.role_key='chargeNurse'`,[receiveSubject]);

  const [{asset_tag:tag}] = (await db.query(
    'SELECT asset_tag FROM transfer_requests JOIN equipment_assets USING(asset_id) WHERE transfer_id=$1',[transfer])).rows;
  const move = (who, action, role, presentedTag = tag) => as(who,
    'SELECT nh_api_verify_transfer_asset($1,$2,$3)',[transfer,action,presentedTag],role);
  const history = async who => (await as(who,'SELECT nh_api_list_transfers()')).find(row=>row.id===transfer);
  const stock = async () => (await db.query(
    'SELECT coalesce((SELECT qty FROM frontend_equipment_inventory_v WHERE id=$1),0) AS source, coalesce((SELECT qty FROM frontend_equipment_inventory_v WHERE id=$2),0) AS destination',
    [ctx.source,'EQ-'+destination.location_id+'-'+ctx.category_id])).rows[0];
  const reservedStock = await stock();
  assert.equal(reservedStock.source,1);
  assert.equal((await history(subjects.coordinator)).canDispatch,true);
  assert.equal((await history(subjects.coordinator)).assetTag,tag);
  assert.equal((await history(subjects.a)).assetTag,null);
  await assert.rejects(move(subjects.coordinator,'dispatch','authenticated','NX-WRONG-ASSET'),/does not match/);
  assert.equal((await history(subjects.coordinator)).status,'reserved');
  assert.equal(await history(subjects.b),undefined);
  assert.equal((await history(receiveSubject)).canReceive,false);
  await assert.rejects(move(receiveSubject,'receive'),/in-transit/);
  await assert.rejects(move(receiveSubject,'dispatch'),/cannot perform/);
  await assert.rejects(move(subjects.a,'dispatch'),/cannot perform/);
  await assert.rejects(move('','dispatch','anon'),/permission denied/);
  await assert.rejects(as(subjects.coordinator,'SELECT nh_start_transfer($1,$2)',[transfer,crypto.randomUUID()]),/permission denied/);

  assert.deepEqual(await move(subjects.coordinator,'dispatch'),['in_transit']);
  assert.deepEqual(await move(subjects.coordinator,'dispatch'),['in_transit']);
  assert.deepEqual(await stock(),reservedStock);
  assert.equal((await history(receiveSubject)).canReceive,true);
  assert.equal((await history(receiveSubject)).assetTag,tag);
  await assert.rejects(move(receiveSubject,'receive','authenticated','NX-WRONG-ASSET'),/does not match/);
  assert.deepEqual(await stock(),reservedStock);
  await assert.rejects(move(subjects.coordinator,'receive'),/cannot perform/);
  await assert.rejects(move(subjects.a,'receive'),/cannot perform/);
  assert.deepEqual(await move(receiveSubject,'receive'),['completed']);
  assert.deepEqual(await move(receiveSubject,'receive'),['completed']);
  assert.deepEqual(await move(subjects.coordinator,'dispatch'),['completed']);
  assert.deepEqual(await stock(),{source:reservedStock.source,destination:reservedStock.destination+1});
  const [asset] = (await db.query(`
    SELECT a.current_location_id,a.asset_status,r.released_at
    FROM transfer_requests t JOIN equipment_assets a USING(asset_id)
    JOIN asset_reservations r USING(transfer_id) WHERE t.transfer_id=$1`,[transfer])).rows;
  assert.equal(asset.current_location_id,destination.location_id);
  assert.equal(asset.asset_status,'available');
  assert.ok(asset.released_at);
  const completed = await history(subjects.a);
  assert.deepEqual(completed.timeline.map(event=>event.stage),
    ['requested','reviewed','allocated','reserved','dispatched','in_transit','received','completed']);
  assert.ok(completed.timeline.every(event=>Number.isFinite(Date.parse(event.at))));
  assert.equal(completed.status,'completed');
  assert.equal(completed.assetTag,null);
  assert.deepEqual(completed.timeline.filter(event=>event.tagVerified).map(event=>event.stage),['dispatched','received']);
  assert.equal((await as(subjects.a,'SELECT nh_api_list_allocation_queue()'))[0].transfer_status,'completed');
  await db.exec(await readFile(new URL('../'+handoffMigrationPath,import.meta.url),'utf8'));
  assert.deepEqual((await history(subjects.a)).timeline,completed.timeline);
  console.log('PASS equipment need validation, role scopes, lifecycle ordering, retries, timeline and inventory movement');
} finally {
  await db.close();
}
