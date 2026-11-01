const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup() {
  let listener; const storage = {};
  const chrome = { runtime: { onMessage: { addListener(fn) { listener=fn; } } }, storage: { session: {
    get: async key => ({ [key]: storage[key] }), set: async value => Object.assign(storage,value), remove: async key => { delete storage[key]; }
  } }, action: { onClicked: { addListener() {} } }, commands: { onCommand: { addListener() {} } } };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../extension/background.js'),'utf8'), { chrome, Date, Promise });
  const request = (type,tabId,route='/c/a',url='https://chatgpt.com/c/a')=>new Promise(resolve=>listener({type,route},{tab:{id:tabId},url},resolve));
  return { storage, request };
}
test('concurrent tabs cannot both acquire the same conversation',async()=>{
  const { request } = setup(); const results=await Promise.all([request('lease',1),request('lease',2)]);
  assert.equal(results.filter(x=>x.ok).length,1);
});
test('owner can renew, nonowner cannot release',async()=>{
  const {request}=setup(); assert.equal((await request('lease',1)).ok,true);
  assert.equal((await request('lease',1)).ok,true); await request('release',2);
  assert.equal((await request('lease',2)).ok,false);
  await request('release',1); assert.equal((await request('lease',2)).ok,true);
});
test('expired lease can be acquired by a new tab',async()=>{
  const {request,storage}=setup(); await request('lease',1); storage['lease:/c/a'].expires=0;
  assert.equal((await request('lease',2)).ok,true);
});
test('different conversations have independent senders',async()=>{
  const {request}=setup(); assert.equal((await request('lease',1,'/c/a')).ok,true);
  assert.equal((await request('lease',2,'/c/b')).ok,true);
});
test('rejects untrusted origin and malformed route',async()=>{
  const {request}=setup(); assert.equal((await request('lease',1,'/c/a','https://example.com/')).ok,false);
  assert.equal((await request('lease',1,'invalid')).ok,false);
});
