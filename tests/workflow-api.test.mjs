import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window={NEXORA_CONFIG:{supabaseUrl:'https://demo.supabase.co',supabasePublishableKey:'sb_publishable_test'}};
const api=await import('../js/api.js');
const loginResponse=()=>({ok:true,json:async()=>({access_token:'session-token',refresh_token:'refresh-token',expires_in:3600})});
test('workflow calls are authenticated POSTs with no caller-supplied actor',async()=>{
 const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return url.includes('/auth/v1/token')?loginResponse():{ok:true,status:200,json:async()=>null};};
 await api.signIn('staff@example.test','test-only');
 await api.requestEquipment('EQ-source-category','Needed');
 await api.decideTransfer('transfer-id',true);
 await api.createSupplyEnquiry('category-id',2,'Need equipment');
 await api.sendSupplyEnquiry('enquiry-id','supplier-id');
 await api.respondSupplyEnquiry('enquiry-id','available',2,'2030-01-02');
 for(const {url,options} of calls.slice(1)){
  assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer session-token');
  assert.ok(url.includes('/rest/v1/rpc/nh_api_'));
  assert.ok(!Object.keys(JSON.parse(options.body)).some(k=>/actor|requester|approver|user_id/.test(k)));
 }
 assert.deepEqual(JSON.parse(calls[1].options.body),{p_source_inventory_id:'EQ-source-category',p_reason:'Needed'});
 assert.deepEqual(JSON.parse(calls[5].options.body),{p_enquiry_id:'enquiry-id',p_availability:'available',p_available_quantity:2,p_estimated_delivery_date:'2030-01-02'});
 await api.signOut();
});
test('a late database result is discarded after logout',async()=>{
 let finish;
 globalThis.fetch=async url=>url.includes('/auth/v1/token')?loginResponse():url.includes('/rpc/')?new Promise(resolve=>{finish=()=>resolve({ok:true,status:200,json:async()=>[{id:'private'}]});}):{ok:true};
 await api.signIn('staff@example.test','test-only');
 const pending=api.fetchTransfers();
 await new Promise(resolve=>setImmediate(resolve));
 await api.signOut();finish();
 await assert.rejects(pending,/Session changed/);
});
test('a late token refresh cannot resurrect a signed-out session',async()=>{
 let finishRefresh;
 globalThis.fetch=async url=>{
  if(url.includes('grant_type=password'))return {ok:true,json:async()=>({access_token:'old',refresh_token:'refresh',expires_in:0})};
  if(url.includes('grant_type=refresh_token'))return new Promise(resolve=>{finishRefresh=()=>resolve(loginResponse());});
  return {ok:true};
 };
 await api.signIn('staff@example.test','test-only');
 const pending=api.fetchTransfers();
 await new Promise(resolve=>setImmediate(resolve));
 await api.signOut();finishRefresh();
 await assert.rejects(pending,/Session changed/);assert.equal(api.isSignedIn(),false);
});
test('missing migrations fail explicitly; expired sessions are cleared',async()=>{
 globalThis.fetch=async url=>url.includes('/auth/v1/token')?loginResponse():{ok:false,status:404};
 await api.signIn('staff@example.test','test-only');
 await assert.rejects(api.fetchTransfers(),/not enabled yet/);
 globalThis.fetch=async()=>({ok:false,status:401});
 await assert.rejects(api.fetchTransfers(),/Session expired/);assert.equal(api.isSignedIn(),false);
});
