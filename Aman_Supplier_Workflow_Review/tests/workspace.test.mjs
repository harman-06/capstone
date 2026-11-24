import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {install,subjects} from './allocation-fixtures.mjs';
test('workspace derives own staff role and rejects anonymous and unprovisioned users',async()=>{
 const db=new PGlite();try{
 await install(sql=>db.exec(sql));await db.exec(await readFile('supabase/migrations/20261101002755_account_workspace.sql','utf8'));
 await assert.rejects(db.query('select public.nh_api_workspace()'),/Sign in/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[subjects.a]);
 const r=await db.query('select public.nh_api_workspace() as w');assert.equal(r.rows[0].w.kind,'staff');assert.deepEqual(r.rows[0].w.roles,['nurse']);assert.equal(r.rows[0].w.unit,'Cardiology');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[subjects.outsider]);await assert.rejects(db.query('select public.nh_api_workspace()'),/no active workspace/);
 await db.exec("insert into nh_suppliers(hospital_id,name) select location_id,'Test supplier' from locations where code='NDH'; insert into nh_supplier_memberships(auth_subject,supplier_id) select 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',supplier_id from nh_suppliers where name='Test supplier';");
 const s=await db.query('select public.nh_api_workspace() as w');assert.equal(s.rows[0].w.kind,'supplier');assert.deepEqual(s.rows[0].w.roles,[]);
 }finally{await db.close();}
});
