import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window={NEXORA_CONFIG:{}};
const {openModal}=await import('../js/modal.js');
test('modal waits for a save, blocks double clicks and keeps failures open',async()=>{
 const controls={};
 const form={querySelector:()=>null,reportValidity:()=>true,appendChild(node){this.message=node;}};
 const host={_html:'',set innerHTML(v){this._html=v;},get innerHTML(){return this._html;},querySelector(sel){if(sel==='form.modal-body')return form;return controls[sel]??= {addEventListener(){},disabled:false};}};
 globalThis.document={body:{appendChild(){}},createElement(tag){return tag==='div'?host:{dataset:{},setAttribute(){}};}};
 let finish;let saves=0;
 openModal({title:'Request',bodyHtml:'',onSubmit(){saves++;return new Promise(resolve=>{finish=resolve;});}});
 const first=controls['.modal-submit'].onclick();
 await controls['.modal-submit'].onclick();
 assert.equal(saves,1);assert.ok(host.innerHTML);assert.equal(controls['.modal-submit'].disabled,true);
 controls['.modal-cancel'].onclick();assert.ok(host.innerHTML);
 finish();await first;assert.equal(host.innerHTML,'');
 openModal({title:'Request',bodyHtml:'',onSubmit(){throw Error('Save denied');}});
 await controls['.modal-submit'].onclick();assert.ok(host.innerHTML);assert.equal(form.message.textContent,'Save denied');
});
