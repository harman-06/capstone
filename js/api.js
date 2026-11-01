// Public client key identifies the app; the user's bearer token establishes identity.
const cfg = window.NEXORA_CONFIG ?? {};
let auth = null;
let sessionVersion = 0;
let refreshPromise;
const authListeners = new Set();
const pendingOperations = new Map();
export const isSignedIn = () => Boolean(auth);
export const isConfigured = () => Boolean(cfg.supabaseUrl && cfg.supabasePublishableKey);
export const onAuthChange = callback => { authListeners.add(callback); return () => authListeners.delete(callback); };
function notifyAuth() { pendingOperations.clear(); for (const callback of authListeners) callback(); }
function config() {
  if (!isConfigured()) throw new Error('Database is not configured');
  if (!/^sb_publishable_/.test(cfg.supabasePublishableKey)) throw new Error('Use a Supabase publishable key only');
  const url = new URL(cfg.supabaseUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.username || url.password || url.search || url.hash) {
    throw new Error('Use the HTTPS Supabase project URL');
  }
  return url.origin;
}
async function authRequest(path, body, version) {
  const res = await fetch(`${config()}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: cfg.supabasePublishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}). Check your account or try again.`);
  const result = await res.json();
  if (version !== sessionVersion) throw new Error('Session changed. Sign in again.');
  if (!result.access_token || !result.refresh_token) throw new Error('Sign-in did not return a session');
  auth = { token: result.access_token, refresh: result.refresh_token,
    expires: Date.now() + result.expires_in * 1000 };
}
export async function signIn(email, password) {
  const version = ++sessionVersion;
  auth = null; refreshPromise = undefined; notifyAuth();
  await authRequest('token?grant_type=password', { email, password }, version);
  notifyAuth();
}
export async function signOut() {
  const oldToken = auth?.token;
  ++sessionVersion; auth = null; refreshPromise = undefined; notifyAuth();
  if (oldToken) {
    try { await fetch(`${config()}/auth/v1/logout`, { method: 'POST', headers: {
      apikey: cfg.supabasePublishableKey, Authorization: `Bearer ${oldToken}`
    } }); } catch { /* Local session and protected caches are already cleared. */ }
  }
}
async function token() {
  if (!auth) throw new Error('Sign in to load database inventory');
  const version = sessionVersion;
  if (auth.expires <= Date.now() + 30000) {
    if (!refreshPromise) {
      const refreshing = authRequest('token?grant_type=refresh_token', { refresh_token: auth.refresh }, version)
        .catch(error => {
          if (version === sessionVersion) { auth = null; ++sessionVersion; notifyAuth(); }
          throw error;
        }).finally(() => { if (refreshPromise === refreshing) refreshPromise = undefined; });
      refreshPromise = refreshing;
    }
    await refreshPromise;
  }
  if (version !== sessionVersion || !auth) throw new Error('Session changed. Sign in again.');
  return auth.token;
}
async function databaseRequest(path, body) {
  const origin = config();
  const version = sessionVersion;
  const accessToken = await token();
  if (version !== sessionVersion) throw new Error('Session changed. Sign in again.');
  const res = await fetch(`${origin}/rest/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { apikey: cfg.supabasePublishableKey, Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json', ...(body === undefined ? {} : {'Content-Type':'application/json'}) },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}), cache: 'no-store'
  });
  if (version !== sessionVersion) throw new Error('Session changed. Sign in again.');
  if (!res.ok) {
    if (res.status === 401) {
      auth = null; ++sessionVersion; notifyAuth();
      throw new Error('Session expired. Sign in again.');
    }
    if (res.status === 403) throw new Error('This account does not have permission for this action.');
    if (res.status === 404) throw new Error('Database workflow is not enabled yet. Apply the reviewed workflow migrations first.');
    throw new Error(`Database request failed (${res.status}). Check the account permissions and request values.`);
  }
  const result = res.status === 204 ? null : await res.json();
  if (version !== sessionVersion) throw new Error('Session changed. Sign in again.');
  return result;
}
async function rest(path) {
  const rows = await databaseRequest(path);
  if (!Array.isArray(rows)) throw new Error('Unexpected database response');
  return rows;
}
const rpc = (name, body = {}) => databaseRequest(`rpc/${name}`, body);
export const fetchInventory = () => rest('frontend_equipment_inventory_v?select=id,name,type,unit,qty,status&order=unit.asc,name.asc');
export const fetchUnits = () => rest('frontend_units_v?select=id,number,name,floor&order=floor.asc,name.asc');
export const fetchHospitalContext = () => rpc('nh_api_hospital_context');
export const fetchTransfers = () => rpc('nh_api_list_transfers');
// Retain the operation key after an uncertain response; clear it only after confirmed success.
async function idempotentRpc(name, key, body) {
  const version = sessionVersion;
  const operationId = pendingOperations.get(key) || crypto.randomUUID();
  pendingOperations.set(key, operationId);
  const result = await rpc(name, {...body, p_operation_id: operationId});
  if (version === sessionVersion && pendingOperations.get(key) === operationId) pendingOperations.delete(key);
  return result;
}
export const requestEquipment = (sourceInventoryId, reason = null) => idempotentRpc('nh_api_enqueue_equipment', JSON.stringify(['request',sourceInventoryId,reason]), {
  p_source_inventory_id: sourceInventoryId, p_reason: reason
});
export const fetchAllocationQueue = () => rpc('nh_api_list_allocation_queue');
export const reviewAllocation = (requestId, priority, neededBy, note) => rpc('nh_api_review_allocation', {
  p_request_id: requestId, p_priority: priority, p_needed_by: neededBy, p_note: note
});
export const configureAllocationPool = (source, category, minimumRetained) => rpc('nh_api_configure_allocation', {
  p_source: source, p_category: category, p_minimum_retained: minimumRetained
});
export const allocateNext = (source, category) => idempotentRpc('nh_api_allocate_next', JSON.stringify(['allocate',source,category]), {p_source: source, p_category: category});
export const cancelAllocation = requestId => rpc('nh_api_cancel_allocation', {p_request_id: requestId});
export const decideTransfer = (transferId, approve, note = null) => rpc('nh_api_decide_transfer', {
  p_transfer_id: transferId, p_approve: approve, p_note: note
});
export const fetchSuppliers = () => rpc('nh_api_list_suppliers');
export const fetchSupplyEnquiries = () => rpc('nh_api_list_supply_enquiries');
export const createSupplyEnquiry = (categoryId, quantity, reason = null) => rpc('nh_api_create_supply_enquiry', {
  p_category_id: categoryId, p_quantity: quantity, p_reason: reason
});
export const sendSupplyEnquiry = (enquiryId, supplierId) => rpc('nh_api_send_supply_enquiry', {
  p_enquiry_id: enquiryId, p_supplier_id: supplierId
});
export const respondSupplyEnquiry = (enquiryId, availability, quantity, deliveryDate = null) => rpc('nh_api_respond_supply_enquiry', {
  p_enquiry_id: enquiryId, p_availability: availability,
  p_available_quantity: quantity, p_estimated_delivery_date: deliveryDate
});
