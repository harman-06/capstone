import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {install} from './allocation-fixtures.mjs';
test('demo provisioning requires confirmed Auth users and safely assigns isolated roles',async()=>{
 const db=new PGlite();
 try {
  await install(sql=>db.exec(sql));
  await db.exec('CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text UNIQUE,email_confirmed_at timestamptz);');
  const sql=await readFile(new URL('../database/provision_demo_access.sql',import.meta.url),'utf8');
  await assert.rejects(db.exec(sql),/Create and confirm/);await db.exec('ROLLBACK');
  for(const email of ['nurse.demo@nexora.example','coordinator.demo@nexora.example','supplier.a@nexora.example','supplier.b@nexora.example'])
   await db.query('INSERT INTO auth.users(email,email_confirmed_at) VALUES($1,now())',[email]);
  await db.exec(sql);await db.exec(sql);
  const result=await db.query("SELECT u.email,r.role_key,l.code FROM users u JOIN user_role_assignments a USING(user_id) JOIN roles r USING(role_id) JOIN locations l ON l.location_id=a.scope_location_id WHERE u.email LIKE '%@nexora.example' ORDER BY u.email");
  assert.deepEqual(result.rows,[{email:'coordinator.demo@nexora.example',role_key:'chargeNurse',code:'ER'},{email:'nurse.demo@nexora.example',role_key:'nurse',code:'CARD'}]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM nh_supplier_memberships')).rows[0].n,2);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM users WHERE email IN ('supplier.a@nexora.example','supplier.b@nexora.example')")).rows[0].n,0);
  await db.exec("UPDATE users SET home_department_id=(SELECT location_id FROM locations WHERE code='ONC') WHERE email='nurse.demo@nexora.example'");
  await assert.rejects(db.exec(sql),/Existing profile conflicts/);await db.exec('ROLLBACK');
 } finally {await db.close();}
});
