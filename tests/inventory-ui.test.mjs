import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = {NEXORA_CONFIG:{}};
const items = [
  {id:'a',name:'Infusion pump',type:'equipment',unit:'ICU',qty:0,status:'out'},
  {id:'b',name:'Infusion pump',type:'equipment',unit:'Emergency',qty:2,status:'available'},
  {id:'c',name:'Monitor',type:'equipment',unit:'ICU',qty:1,status:'low'}
];
globalThis.fetch = async url => ({ok:true,json:async()=>url.includes('inventory.json') ? items : []});
const data = await import('../js/data.js');
await data.loadData();
const {inventory} = await import('../js/pages/other.js');
test('inventory combines name and unit filters, reports empty results and keeps request handlers',()=>{
  const control = () => ({value:'',handlers:{},addEventListener(event, fn){this.handlers[event]=fn;}});
  const search=control(),unit=control(),count={},empty={};
  const rows=items.map(i=>({dataset:{name:i.name.toLowerCase(),unit:i.unit},hidden:false}));
  const request=control(); request.dataset={requestItem:'a'};
  const el={innerHTML:'',querySelector(selector){return {'#inventory-search':search,'#inventory-unit':unit,'#inventory-count':count,'#inventory-empty':empty}[selector] ?? null;},querySelectorAll(selector){return selector==='[data-inventory-row]' ? rows : [request];}};
  inventory(el,{query:{}});
  assert.equal(count.textContent,'3 items');
  search.value='  PUMP ';search.handlers.input();
  assert.equal(count.textContent,'2 items');
  unit.value='ICU';unit.handlers.change();
  assert.equal(count.textContent,'1 item');
  assert.deepEqual(rows.map(r=>r.hidden),[false,true,true]);
  search.value='missing';search.handlers.input();
  assert.equal(empty.hidden,false);assert.equal(count.textContent,'0 items');
  search.value='';unit.value='';unit.handlers.change();
  assert.equal(empty.hidden,true);assert.equal(count.textContent,'3 items');
  globalThis.location={hash:''}; request.handlers.click();
  assert.equal(location.hash,'#/requests?item=a');
});
