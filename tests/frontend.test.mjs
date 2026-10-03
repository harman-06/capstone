import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = { NEXORA_CONFIG: {
  supabaseUrl:'https://demo.supabase.co',supabasePublishableKey:'sb_publishable_test'
} };
const api = await import('../js/api.js');
test('publishable key is not treated as a user token; credentials stay out of URLs', async () => {
 const calls=[];
 globalThis.fetch=async (url, options) => {
  calls.push({url,options});
  if(url.includes('/auth/v1/token')) return {ok:true,json:async()=>({access_token:'user-jwt',refresh_token:'refresh',expires_in:3600})};
  return {ok:true,json:async()=>[{id:'x'}]};
 };
 await api.signIn('staff@example.test','temporary-test-password');
 await api.fetchInventory();
 assert.equal(calls[0].options.headers.Authorization,undefined);
 assert.ok(!calls[0].url.includes('temporary-test-password'));
 assert.equal(calls[1].options.headers.apikey,'sb_publishable_test');
 assert.equal(calls[1].options.headers.Authorization,'Bearer user-jwt');
 await api.signOut();
 await assert.rejects(api.fetchInventory(),/Sign in/);
});
test('rejects a secret key before any network request',async()=>{
 window.NEXORA_CONFIG.supabasePublishableKey='sb_secret_do-not-use';
 globalThis.fetch=()=>{throw Error('Network must not be called');};
 await assert.rejects(api.signIn('x','x'),/publishable key only/);
 window.NEXORA_CONFIG.supabasePublishableKey='sb_publishable_test';
});
test('configured failure cannot silently present JSON equipment as live; medicine retained',async()=>{
 const data=await import('../js/data.js');
 globalThis.fetch=async url=>({ok:true,json:async()=> url.includes('inventory.json') ? [
  {id:'equipment-demo',type:'equipment'}, {id:'medicine-demo',type:'medicine'}
 ] : []});
 await data.loadData();
 assert.match(data.getDataSource(),/unavailable/);
 assert.deepEqual(data.getInventory(),[{id:'medicine-demo',type:'medicine'}]);
 assert.deepEqual(data.getUnits(),[]);
 window.NEXORA_CONFIG.supabaseUrl='';
 await data.reloadEquipment();
 assert.match(data.getDataSource(),/Demo JSON/);
 assert.equal(data.getInventory().length,2);
});
