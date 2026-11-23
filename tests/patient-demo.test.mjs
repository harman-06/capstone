import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { install, subjects } from './allocation-fixtures.mjs';

test('patient demo accounts can only read their own active synthetic visit', async () => {
  const db = new PGlite();
  try {
    await install(sql => db.exec(sql));
    await db.exec('CREATE TABLE auth.users(id uuid PRIMARY KEY)');
    const migrate = async path => db.exec(await readFile(new URL('../'+path,import.meta.url),'utf8'));
    await migrate('supabase/migrations/20261101002755_account_workspace.sql');
    await migrate('supabase/migrations/20261123151007_sprint_three_supplier_and_inventory.sql');
    await migrate('supabase/migrations/20261123153019_synthetic_patient_visit.sql');
    const a=crypto.randomUUID(),b=crypto.randomUUID(),expired=crypto.randomUUID();
    for (const [subject,clinic] of [[a,'Synthetic Clinic A'],[b,'Synthetic Clinic B'],[expired,'Synthetic Expired Clinic']]) {
      await db.query('INSERT INTO auth.users(id) VALUES($1)',[subject]);
      const past = subject===expired;
      await db.query(`
        INSERT INTO nexora_private.nh_demo_patient_visits(auth_subject,display_name,starts_at,clinic,checklist,expires_at)
        VALUES($1,'Synthetic Patient',now()+$2::interval,$3,ARRAY['Demo preparation'],now()+$4::interval)`,
      [subject,past ? '-2 days' : '2 days',clinic,past ? '-1 day' : '30 days']);
    }
    async function as(subject,sql,role='authenticated') {
      await db.exec('BEGIN');
      try {
        await db.exec('SET LOCAL ROLE '+role);
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[subject]);
        const {rows} = await db.query(sql);
        await db.exec('COMMIT');
        return rows.map(row=>Object.values(row)[0]);
      } catch (error) { await db.exec('ROLLBACK'); throw error; }
    }
    const [visitA] = await as(a,'SELECT nh_api_my_visit()');
    const [visitB] = await as(b,'SELECT nh_api_my_visit()');
    assert.equal(visitA.clinic,'Synthetic Clinic A');
    assert.equal(visitB.clinic,'Synthetic Clinic B');
    assert.deepEqual(Object.keys(visitA).sort(),['checklist','clinic','starts_at']);
    assert.equal((await as(a,'SELECT nh_api_workspace()'))[0].kind,'patient');
    assert.equal((await as(subjects.a,'SELECT nh_api_workspace()'))[0].kind,'staff');
    await assert.rejects(as(expired,'SELECT nh_api_workspace()'),/no active workspace/);
    await assert.rejects(as(expired,'SELECT nh_api_my_visit()'),/active patient/);
    await assert.rejects(as(subjects.a,'SELECT nh_api_my_visit()'),/active patient/);
    await assert.rejects(as('', 'SELECT nh_api_my_visit()', 'anon'),/permission denied/);
    await assert.rejects(as(a,'SELECT clinic FROM nexora_private.nh_demo_patient_visits'),/permission denied/);
    assert.deepEqual(await as(a,'SELECT id FROM frontend_equipment_inventory_v'),[]);
    assert.deepEqual(await as(a,'SELECT nh_api_list_supply_enquiries()'),[]);
  } finally {
    await db.close();
  }
});
