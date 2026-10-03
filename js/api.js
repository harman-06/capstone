// Browser adapter: publishable key identifies this app; access token identifies the user.
const cfg = window.NEXORA_CONFIG ?? {};
let auth = null;
export const isSignedIn = () => Boolean(auth);
export const isConfigured = () => Boolean(cfg.supabaseUrl && cfg.supabasePublishableKey);
function config() {
  if (!isConfigured()) throw new Error('Database is not configured');
  if (!/^sb_publishable_/.test(cfg.supabasePublishableKey)) throw new Error('Use a Supabase publishable key only');
  const url = new URL(cfg.supabaseUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.username || url.password || url.search || url.hash) {
    throw new Error('Use the HTTPS Supabase project URL');
  }
  return url.origin;
}
async function authRequest(path, body) {
  const res = await fetch(`${config()}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: cfg.supabasePublishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}). Check your account or try again.`);
  const result = await res.json();
  if (!result.access_token || !result.refresh_token) throw new Error('Sign-in did not return a session');
  auth = { token: result.access_token, refresh: result.refresh_token,
    expires: Date.now() + result.expires_in * 1000 };
}
export async function signIn(email, password) {
  await authRequest('token?grant_type=password', { email, password });
}
export async function signOut() {
  const token = auth?.token;
  auth = null;
  if (token) {
    try { await fetch(`${config()}/auth/v1/logout`, { method: 'POST', headers: {
      apikey: cfg.supabasePublishableKey, Authorization: `Bearer ${token}`
    } }); } catch { /* Local credentials are still cleared on a network failure. */ }
  }
}
let refreshPromise;
async function token() {
  if (!auth) throw new Error('Sign in to load database inventory');
  if (auth.expires <= Date.now() + 30000) {
    if (!refreshPromise) refreshPromise = authRequest('token?grant_type=refresh_token', { refresh_token: auth.refresh })
      .catch(err => { auth = null; throw err; }).finally(() => { refreshPromise = undefined; });
    await refreshPromise;
  }
  return auth.token;
}
async function rest(path) {
  const origin = config();
  const accessToken = await token();
  const res = await fetch(`${origin}/rest/v1/${path}`, { headers: {
    apikey: cfg.supabasePublishableKey, Authorization: `Bearer ${accessToken}`, Accept: 'application/json'
  }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Database request failed (${res.status}). Check access and project configuration.`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Unexpected database response');
  return rows;
}
export const fetchInventory = () => rest('frontend_equipment_inventory_v?select=id,name,type,unit,qty,status&order=unit.asc,name.asc');
export const fetchUnits = () => rest('frontend_units_v?select=id,number,name,floor&order=floor.asc,name.asc');
