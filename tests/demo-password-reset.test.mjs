import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { install } from './allocation-fixtures.mjs';
import { createResetHandler } from '../supabase/functions/demo-reset-password/handler.mjs';

const admin = 'aaaaaaaa-1234-4321-aaaa-aaaaaaaaaaaa';
const session = 'bbbbbbbb-1234-4321-bbbb-bbbbbbbbbbbb';
const factor = 'ffffffff-1234-4321-ffff-ffffffffffff';
const target = 'cccccccc-1234-4321-cccc-cccccccccccc';
const operation = 'dddddddd-1234-4321-dddd-dddddddddddd';
const adminEmail = 'it.admin@nexora.example';
const targetEmail = 'nurse.demo@nexora.example';
const origin = 'https://demo.example';
const accounts = [targetEmail, 'coordinator.demo@nexora.example', 'supplier.a@nexora.example',
  'supplier.b@nexora.example', 'patient.demo@nexora.example'];
const sql = filename => readFile(new URL('../' + filename, import.meta.url), 'utf8');

test('only an eligible demo target can be reset by the service with the approved live admin session', async () => {
  const db = new PGlite();
  try {
    await install(s => db.exec(s));
    await db.exec('CREATE ROLE service_role; CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE, email_confirmed_at timestamptz);');
    await db.exec('CREATE TABLE auth.sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, not_after timestamptz, aal text, factor_id uuid); CREATE TABLE auth.mfa_factors(id uuid PRIMARY KEY,user_id uuid,status text,factor_type text);');
    await db.query('INSERT INTO auth.users VALUES ($1,$2,now()),($3,$4,now())', [admin, adminEmail, target, targetEmail]);
    for (const email of accounts.slice(1)) {
      await db.query('INSERT INTO auth.users(email,email_confirmed_at) VALUES($1,now())', [email]);
    }
    await db.exec(await sql('database/provision_demo_access.sql'));
    await db.exec(await sql('supabase/migrations/20261123153019_synthetic_patient_visit.sql'));
    await db.exec("INSERT INTO nexora_private.nh_demo_patient_visits SELECT id,'Demo Patient',now(),'Demo Clinic','{}',now()+interval '1 day' FROM auth.users WHERE email='patient.demo@nexora.example'");
    await db.query("INSERT INTO users(email,display_name,auth_subject) VALUES($1,'Demo administrator',$2)", [adminEmail, admin]);
    await db.query("INSERT INTO user_role_assignments SELECT u.user_id,r.role_id,l.location_id FROM users u,roles r,locations l WHERE u.auth_subject=$1 AND r.role_key='admin' AND l.code='NDH'", [admin]);
    await db.query("INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES($1,$2,'aal2',$3)", [session, admin, factor]);
    await db.query("INSERT INTO auth.sessions(user_id) VALUES($1),($1)", [target]);
    await db.query("INSERT INTO auth.mfa_factors VALUES($1,$2,'verified','totp')", [factor, admin]);
    await db.exec(await sql('supabase/migrations/20261124021310_demo_password_reset.sql'));

    const begin = async (actor = admin, sid = session, fid = factor, email = targetEmail) =>
      (await db.query('SELECT public.nh_begin_demo_password_reset($1,$2,$3,$4) AS result', [actor,sid,fid,email])).rows[0].result;
    const finish = async id => (await db.query('SELECT public.nh_finish_demo_password_reset($1) AS result', [id])).rows[0].result;
    for (const role of ['anon','authenticated']) {
      await db.exec('SET ROLE ' + role);
      await assert.rejects(begin(), /permission denied/);
      await assert.rejects(finish(operation), /permission denied/);
      await db.exec('RESET ROLE');
    }

    await db.exec('SET ROLE service_role');
    assert.equal(await begin(target), null);
    assert.equal(await begin(admin, operation), null);
    assert.equal(await begin(admin, session, operation), null);
    assert.equal(await begin(admin, session, factor, adminEmail), null);
    assert.equal(await begin(admin, session, factor, 'legacy@example.test'), null);
    const requests = [];
    for (const email of accounts) requests.push(await begin(admin, session, factor, email));
    assert.equal(new Set(requests.map(request => request.target_id)).size, 5);
    assert.equal(requests[0].target_id, target);
    assert.deepEqual(await begin(), { busy: true });
    assert.equal(await finish(requests[0].reset_id), true);
    assert.equal(await finish(requests[0].reset_id), false);
    await db.exec('RESET ROLE');
    assert.deepEqual((await db.query('SELECT user_id FROM auth.sessions')).rows, [{user_id: admin}]);
    const audit = (await db.query('SELECT actor_id,target_id,completed_at FROM nexora_private.nh_demo_password_reset_audit WHERE reset_id=$1', [requests[0].reset_id])).rows[0];
    assert.equal(audit.actor_id, admin);
    assert.equal(audit.target_id, target);
    assert.ok(audit.completed_at);
  } finally {
    await db.close();
  }
});

function edge({ aal = 'aal2', email = adminEmail, authStatus = 200, unauthorized = false, busy = false, finish = true,
  enabled = true, browser = origin } = {}) {
  const calls = [];
  const handler = createResetHandler({
    url: 'https://project.example', serviceKey: 'mock-service-key', origin, enabled, factor,
    request: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : undefined;
      calls.push({ url, body, authorization: options.headers.Authorization });
      if (url.endsWith('/user')) return Response.json({ id: admin, email }, { status: authStatus });
      if (url.endsWith('/nh_begin_demo_password_reset')) {
        return Response.json(unauthorized ? null : busy ? { busy: true } : { reset_id: operation, target_id: target });
      }
      if (url.endsWith('/nh_finish_demo_password_reset')) return Response.json(finish);
      assert.equal(options.method, 'PUT');
      return Response.json({});
    }
  });
  const encoded = btoa(JSON.stringify({ sub: admin, aal, session_id: session })).replace(/=+$/, '');
  const request = new Request('https://project.example/demo-reset-password', {
    method: 'POST',
    headers: { Origin: browser, Authorization: 'Bearer header.' + encoded + '.signature' },
    body: JSON.stringify({ target: targetEmail, actor: target, password: 'client-supplied' })
  });
  return { calls, response: handler(request) };
}

test('Edge Function refuses unverified, non-admin, disabled, unauthorized and repeat attempts before an Auth update', async () => {
  for (const [options, status, count] of [
    [{ authStatus: 401 }, 401, 1], [{ aal: 'aal1' }, 403, 1], [{ email: targetEmail }, 403, 1],
    [{ enabled: false }, 503, 0], [{ browser: 'https://other.example' }, 403, 0],
    [{ unauthorized: true }, 403, 2], [{ busy: true }, 409, 2]
  ]) {
    const attempt = edge(options);
    assert.equal((await attempt.response).status, status);
    assert.equal(attempt.calls.length, count);
  }
});

test('Edge Function returns a random password only after completion and derives the actor from Auth', async () => {
  const attempt = edge();
  const response = await attempt.response;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const { password } = await response.json();
  assert.match(password, /^Nx!9-[a-f0-9]{48}$/);
  assert.deepEqual(attempt.calls[1].body, { actor: admin, session_id: session, factor, target: targetEmail });
  assert.deepEqual(attempt.calls[2].body, { password });
  assert.deepEqual(attempt.calls[3].body, { operation });
  const partial = await edge({ finish: false }).response;
  assert.equal(partial.status, 502);
  assert.match((await partial.json()).error, /may have changed/);
});
