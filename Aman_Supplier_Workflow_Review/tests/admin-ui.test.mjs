import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window={NEXORA_CONFIG:{supabaseUrl:'https://demo.supabase.co',supabasePublishableKey:'sb_publishable_test'}};
const api=await import('../js/api.js');
const {loadWorkspace}=await import('../js/workspace.js');
const {accounts}=await import('../js/pages/accounts.js');
test('admin overview uses real results, filters accounts and reports unavailable health honestly',async()=>{
 let fail=false;
 const rows=[{email:'nurse@example.test',name:'<script>unsafe</script>',active:false,confirmed:true,roles:[{role:'Nurse',scope:'Cardiology'}],suppliers:[],last_sign_in:null},{email:'missing@example.test',name:'Unassigned',active:true,confirmed:false,roles:[],suppliers:[],last_sign_in:null}];
 globalThis.fetch=async url=>({ok:!fail,status:fail?503:200,json:async()=>url.includes('/auth/')?{access_token:'test',refresh_token:'test',expires_in:3600}:url.includes('nh_api_workspace')?{kind:'staff',name:'Admin',unit:null,roles:['admin']}:fail?{message:'Service unavailable'}:rows});
 await api.signIn('admin@example.test','test-only');await loadWorkspace();
 const controls={};const host={innerHTML:'',isConnected:true,querySelector:s=>controls[s]??={value:'',textContent:'',innerHTML:''},querySelectorAll:()=>[]};
 await accounts(host);
 assert.match(host.innerHTML,/Administration overview/);assert.match(host.innerHTML,/Inactive account retains assignments/);assert.match(host.innerHTML,/No assigned access/);assert.match(host.innerHTML,/Email not confirmed/);assert.match(host.innerHTML,/Passed — authorized account query completed/);
 assert.match(controls['[data-accounts]'].innerHTML,/&lt;script&gt;/);
 controls['[data-search]'].value='Cardiology';controls['[data-search]'].oninput();assert.equal(controls['[data-count]'].textContent,'1 of 2 accounts');
 controls['[data-search]'].value='nonexistent';controls['[data-search]'].oninput();assert.match(controls['[data-accounts]'].innerHTML,/No matching/);
 fail=true;await accounts(host);assert.match(host.innerHTML,/Account service check failed/);assert.doesNotMatch(host.innerHTML,/Passed —/);
});
