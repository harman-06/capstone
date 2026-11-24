const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function createResetHandler({ url, serviceKey, origin, enabled, factor, request = fetch }) {
  return async incoming => {
    const allowedOrigin = incoming.headers.get('Origin') === origin;
    const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', Vary: 'Origin' };
    if (allowedOrigin) Object.assign(headers, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type'
    });
    const reply = (status, body) => Response.json(body, { status, headers });
    if (!allowedOrigin) return reply(403, { error: 'Origin is not allowed.' });
    if (incoming.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (incoming.method !== 'POST') return reply(405, { error: 'Use POST.' });
    if (!enabled || !url || !serviceKey || !uuid.test(factor)) return reply(503, { error: 'Demo password resets are disabled.' });

    const bearer = incoming.headers.get('Authorization') ?? '';
    if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(bearer)) {
      return reply(401, { error: 'Sign in again.' });
    }

    const call = (path, method, data, authorization = 'Bearer ' + serviceKey) =>
      request(url + path, {
        method,
        headers: { apikey: serviceKey, Authorization: authorization, 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data),
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      });
    let updateAttempted = false;
    try {
      const payload = await incoming.json().catch(() => null);
      const target = payload?.target;
      if (typeof target !== 'string' || target.length > 80) {
        return reply(400, { error: 'Select a demo account.' });
      }

      // Supabase Auth validates the bearer before we read its signed claims.
      const verified = await call('/auth/v1/user', 'GET', undefined, bearer);
      if (verified.status === 401 || verified.status === 403) return reply(401, { error: 'Sign in again.' });
      if (!verified.ok) return reply(503, { error: 'Sign-in verification is unavailable.' });
      const user = await verified.json();
      const encoded = bearer.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(encoded));
      if (!uuid.test(user.id) || claims.sub !== user.id || claims.aal !== 'aal2'
          || !uuid.test(claims.session_id) || user.email !== 'it.admin@nexora.example') {
        return reply(403, { error: 'An IT administrator session verified with MFA is required.' });
      }

      const authorized = await call('/rest/v1/rpc/nh_begin_demo_password_reset', 'POST', {
        actor: user.id, session_id: claims.session_id, factor, target
      });
      if (!authorized.ok) return reply(503, { error: 'Reset authorization is unavailable.' });
      const operation = await authorized.json();
      if (operation?.busy) return reply(409, { error: 'There was a recent attempt for this account. Wait two minutes before retrying.' });
      if (!uuid.test(operation?.reset_id) || !uuid.test(operation?.target_id)) {
        return reply(403, { error: 'This account cannot be reset.' });
      }

      const bytes = crypto.getRandomValues(new Uint8Array(24));
      const password = 'Nx!9-' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      updateAttempted = true;
      const updated = await call('/auth/v1/admin/users/' + operation.target_id, 'PUT', { password });
      if (!updated.ok && updated.status >= 400 && updated.status < 500) {
        return reply(502, { error: 'Supabase rejected the password update.' });
      }
      if (!updated.ok) throw new Error('Unknown update outcome');
      const completed = await call('/rest/v1/rpc/nh_finish_demo_password_reset', 'POST', {
        operation: operation.reset_id
      });
      if (!completed.ok || await completed.json() !== true) throw new Error('Reset finalization failed');
      return reply(200, { password });
    } catch {
      return reply(502, { error: updateAttempted
        ? 'The password may have changed. Completion could not be confirmed. Contact the Supabase project operator before retrying.'
        : 'The password reset service is unavailable.' });
    }
  };
}
