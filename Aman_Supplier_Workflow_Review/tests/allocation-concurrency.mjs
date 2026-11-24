// Run only against a new disposable PostgreSQL database, never the hosted project.
import pg from 'pg';
import assert from 'node:assert/strict';
import {install,context,subjects} from './allocation-fixtures.mjs';
const url=process.env.NEXORA_TEST_DATABASE_URL;
if(!url)throw Error('Set NEXORA_TEST_DATABASE_URL to a new disposable nexora_allocation_test database.');
const parsed=new URL(url);
if(!['localhost','127.0.0.1','postgres'].includes(parsed.hostname) || parsed.pathname!='/nexora_allocation_test')throw Error('Only the named local disposable database is accepted.');
const pool=new pg.Pool({connectionString:url,max:12});
try {
 const existing=await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'");
 assert.equal(existing.rows[0].n,0,'Concurrency test requires a fresh empty database; it never drops existing tables.');
 await install(sql=>pool.query(sql));
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
 const repeated=await Promise.all(Array.from({length:8},()=>as(subjects.a,'SELECT nh_api_enqueue_equipment($1,$2,$3)',[ctx.source,opA,'Concurrent request'])));
 assert.equal(new Set(repeated).size,1,'Concurrent retry created duplicate demands');
 const a=repeated[0];
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
 console.log('PASS real PostgreSQL concurrent enqueue, replay, reserve-floor and last-asset allocation (independent sessions)');
} finally {await pool.end();}
