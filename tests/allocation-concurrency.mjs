// Run only against a new disposable PostgreSQL database, never the hosted project.
import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {install,context,subjects,handoffMigrationPath} from './allocation-fixtures.mjs';
const url=process.env.NEXORA_TEST_DATABASE_URL;
if(!url)throw Error('Set NEXORA_TEST_DATABASE_URL to a new disposable nexora_allocation_test database.');
const parsed=new URL(url);
if(!['localhost','127.0.0.1','postgres'].includes(parsed.hostname) || parsed.pathname!='/nexora_allocation_test')throw Error('Only the named local disposable database is accepted.');
const pool=new pg.Pool({connectionString:url,max:12});
try {
 const existing=await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'");
 assert.equal(existing.rows[0].n,0,'Concurrency test requires a fresh empty database; it never drops existing tables.');
 await install(sql=>pool.query(sql));
 await pool.query(await readFile(new URL('../'+handoffMigrationPath,import.meta.url),'utf8'));
 const ctx=await context(async sql=>(await pool.query(sql)).rows);
 async function as(subject,sql,params=[]) {
  const c=await pool.connect();
  try {
   await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');
   await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[subject]);
   const result=await c.query(sql,params);await c.query('COMMIT');return Object.values(result.rows[0])[0];
  } catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 const opA=crypto.randomUUID();
 const due = new Date(Date.now() + 3600000).toISOString();
 const repeated=await Promise.all(Array.from({length:8},()=>as(subjects.a,'SELECT nh_api_submit_equipment_need($1,$2,$3,$4)',[ctx.source,opA,'Concurrent request',due])));
 assert.equal(new Set(repeated).size,1,'Concurrent retry created duplicate demands');
 const a=repeated[0];
 const conflicts=await Promise.allSettled(Array.from({length:4},()=>as(subjects.a,
  'SELECT nh_api_submit_equipment_need($1,$2,$3,$4)',[ctx.source,crypto.randomUUID(),'Conflicting demand',due])));
 assert.ok(conflicts.every(result=>result.status==='rejected' && result.reason.code==='23505'));
 const b=await as(subjects.b,'SELECT nh_api_enqueue_equipment($1,$2,$3)',[ctx.source,crypto.randomUUID(),'Other unit']);
 await as(subjects.coordinator,'SELECT nh_api_review_allocation($1,1,NULL,$2)',[a,'Routine reviewed independently']);
 await as(subjects.coordinator,'SELECT nh_api_review_allocation($1,1,NULL,$2)',[b,'Routine reviewed independently']);
 await as(subjects.coordinator,'SELECT nh_api_configure_allocation($1,$2,1)',[ctx.source_id,ctx.category_id]);
 const shared=crypto.randomUUID();
 const same=await Promise.all(Array.from({length:6},()=>as(subjects.coordinator,'SELECT nh_api_allocate_next($1,$2,$3)',[ctx.source_id,ctx.category_id,shared])));
 assert.equal(new Set(same.map(x=>x.transfer_id)).size,1,'Allocation retry reserved more than once');
 assert.ok(same.every(x=>x.outcome==='allocated'));
 const waiting=await Promise.all(Array.from({length:6},()=>as(subjects.coordinator,'SELECT nh_api_allocate_next($1,$2,$3)',[ctx.source_id,ctx.category_id,crypto.randomUUID()])));
 assert.ok(waiting.every(x=>x.outcome==='waiting_for_stock'),'Concurrent allocators violated reserve floor');
 const reserved=await pool.query('SELECT count(*)::int AS n FROM asset_reservations WHERE released_at IS NULL');
 assert.equal(reserved.rows[0].n,1);
 await as(subjects.coordinator,'SELECT nh_api_configure_allocation($1,$2,0)',[ctx.source_id,ctx.category_id]);
 const race=await Promise.all(Array.from({length:6},()=>as(subjects.coordinator,'SELECT nh_api_allocate_next($1,$2,$3)',[ctx.source_id,ctx.category_id,crypto.randomUUID()])));
 assert.equal(race.filter(x=>x.outcome==='allocated').length,1,'Last asset allocated more than once');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM asset_reservations WHERE released_at IS NULL')).rows[0].n,2);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM nh_allocation_events WHERE action='allocated'")).rows[0].n,2);
 const transfer = same[0].transfer_id;
 const receiver = subjects.outsider;
 await pool.query(`
  INSERT INTO users(email,display_name,home_department_id,auth_subject)
  SELECT 'concurrent-receiver@example.test','receiver',t.to_department_id,$2
  FROM transfer_requests t WHERE t.transfer_id=$1`,[transfer,receiver]);
 await pool.query(`
  INSERT INTO user_role_assignments(user_id,role_id,scope_location_id)
  SELECT u.user_id,r.role_id,u.home_department_id FROM users u,roles r
  WHERE u.auth_subject=$1 AND r.role_key='chargeNurse'`,[receiver]);
 const {rows:[{asset_tag:tag}]}=await pool.query('SELECT asset_tag FROM transfer_requests JOIN equipment_assets USING(asset_id) WHERE transfer_id=$1',[transfer]);
 const allMove = (subject, action) => Promise.all(Array.from({length:6},()=>as(subject,
  'SELECT nh_api_verify_transfer_asset($1,$2,$3)',[transfer,action,tag])));
 assert.ok((await allMove(subjects.coordinator,'dispatch')).every(status=>status==='in_transit'));
 assert.ok((await allMove(receiver,'receive')).every(status=>status==='completed'));
 const events=await pool.query("SELECT event_type,note FROM transfer_events WHERE transfer_id=$1 ORDER BY event_id",[transfer]);
 assert.deepEqual(events.rows.map(row=>row.event_type),
  ['requested','approved','reserved','dispatched','in_transit','received','completed']);
 assert.deepEqual(events.rows.filter(row=>row.note==='equipment_tag_verified').map(row=>row.event_type),['dispatched','received']);
 console.log('PASS real PostgreSQL concurrent request conflicts, replay, reserve floor, allocation, dispatch and receipt');
} finally {await pool.end();}
