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
 const queuedBody=JSON.parse(calls[1].options.body); assert.equal(queuedBody.p_source_inventory_id,'EQ-source-category'); assert.equal(queuedBody.p_reason,'Needed'); assert.match(queuedBody.p_operation_id,/^[0-9a-f-]{36}$/); assert.ok(calls[1].url.endsWith('/nh_api_enqueue_equipment'));
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

test('allocation retries reuse an operation ID after an uncertain save',async()=>{
 const operations=[]; let failed=true;
 globalThis.fetch=async(url,options)=>{
  if(url.includes('/auth/v1/token'))return loginResponse();
  operations.push(JSON.parse(options.body).p_operation_id);
  if(failed){failed=false;throw Error('Connection lost after possible commit');}
  return {ok:true,status:200,json:async()=>({outcome:'allocated'})};
 };
 await api.signIn('staff@example.test','test-only');
 await assert.rejects(api.allocateNext('source','category'),/Connection lost/);
 await api.allocateNext('source','category');
 assert.equal(operations[0],operations[1]);
 await api.allocateNext('source','category');
 assert.notEqual(operations[1],operations[2]);
});

test('equipment needs retain their operation ID after an uncertain save and movement sends no actor',async()=>{
 const calls=[];
 let lost=true;
 globalThis.fetch=async(url,options)=>{
  if(url.includes('/auth/v1/token'))return loginResponse();
  if(url.includes('/rpc/'))calls.push({url,body:JSON.parse(options.body),authorization:options.headers.Authorization});
  if(url.endsWith('/nh_api_submit_equipment_need') && lost){lost=false;throw Error('Response lost');}
  return {ok:true,status:200,json:async()=>null};
 };
 await api.signIn('staff@example.test','test-only');
 const need=()=>api.submitEquipmentNeed('EQ-source-category','Synthetic equipment shortage','2030-01-02T12:00:00.000Z');
 await assert.rejects(need(),/Response lost/);
 await need();
 await api.moveTransfer('transfer-id','dispatch');
 await api.moveTransfer('transfer-id','receive');
 assert.deepEqual(calls[0].body,calls[1].body);
 assert.equal(calls[1].body.p_needed_by,'2030-01-02T12:00:00.000Z');
 assert.deepEqual(calls.slice(2).map(call=>call.body),[
  {p_transfer_id:'transfer-id',p_action:'dispatch'},
  {p_transfer_id:'transfer-id',p_action:'receive'}
 ]);
 assert.ok(calls.every(call=>call.authorization==='Bearer session-token'));
 await api.signOut();
});
