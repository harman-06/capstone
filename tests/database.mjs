import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
const file = name => readFile(new URL(`../database/${name}`, import.meta.url), 'utf8');
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
for (const name of ['00_schema.sql','01_workflow_functions.sql','02_views.sql','03_seed_demo.sql','04_rls.sql','05_validation.sql']) {
  await db.exec(await file(name));
  console.log(`PASS ${name}`);
}
// Re-seeding must not duplicate approval policies (NULL category) or assets.
await db.exec(await file('03_seed_demo.sql'));
assert.equal((await db.query('SELECT count(*)::int AS n FROM approval_policies')).rows[0].n,3);
assert.equal((await db.query('SELECT count(*)::int AS n FROM equipment_assets')).rows[0].n,9);
console.log('PASS repeat seed is idempotent');
async function rejects(sql, pattern) {
  await db.exec('SAVEPOINT denied');
  try { await assert.rejects(db.exec(sql),pattern); }
  finally { await db.exec('ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied;'); }
}
await db.exec('BEGIN; SET LOCAL ROLE anon;');
await rejects('SELECT * FROM frontend_equipment_inventory_v', /permission denied/);
await rejects('SELECT * FROM users', /permission denied/);
await db.exec('ROLLBACK;');
console.log('PASS anonymous table and view reads denied');
await db.exec('BEGIN; SET LOCAL ROLE authenticated;');
assert.equal((await db.query('SELECT count(*)::int AS n FROM frontend_units_v')).rows[0].n,0);
await rejects("SELECT nh_approve_transfer(gen_random_uuid(),gen_random_uuid(),NULL)", /permission denied/);
await db.exec('ROLLBACK;');
console.log('PASS unprovisioned account sees no rows and cannot execute workflow');
await db.exec(`BEGIN; UPDATE users SET auth_subject='11111111-1111-4111-8111-111111111111' WHERE email='eli.brown@example.test';
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);`);
assert.equal((await db.query('SELECT count(*)::int AS n FROM frontend_units_v')).rows[0].n,3);
assert.equal((await db.query('SELECT count(*)::int AS n FROM frontend_equipment_inventory_v')).rows[0].n,18);
assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n,1);
await rejects("UPDATE equipment_assets SET asset_status='lost'", /permission denied/);
await rejects('SELECT * FROM audit_logs', /permission denied/);
await rejects('SELECT * FROM pending_transfer_v', /permission denied/);
await db.exec('ROLLBACK;');
console.log('PASS provisioned member reads inventory, own profile only; writes and private data denied');
await db.exec('BEGIN;');
await rejects("UPDATE locations SET parent_location_id=location_id WHERE code='CARD'", /Invalid location hierarchy|cycle/);
await rejects("UPDATE locations SET parent_location_id=NULL WHERE code='ER'", /needs a parent/);
await db.exec('ROLLBACK;');
console.log('PASS invalid location hierarchy denied');
assert.equal((await db.query('SELECT count(*)::int AS n FROM transfer_requests')).rows[0].n,0);
assert.equal((await db.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n,0);
console.log('PASS validation left no transfers or audit records');
await db.close();
