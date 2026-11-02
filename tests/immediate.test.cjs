const { test } = require('node:test');
const assert = require('node:assert/strict');
const { immediateEligibility } = require('../extension/engine.js');
const state = patch => ({ editor:true,recognized:true,online:true,foreground:true,error:false,uploading:false,attachmentUnknown:false,draft:'补充：检查单位',sendable:true,busy:true,completed:false,route:'/c/a',users:1,userText:'正在执行的任务，没有结束约定',attachments:'file.xlsx', ...patch });
const active = patch => ({route:'/c/a',users:1,userText:'正在执行的任务，没有结束约定',text:'补充：检查单位',attachments:'file.xlsx', ...patch});
test('immediate submission works during a busy turn without any completion contract', () => assert.equal(immediateEligibility(state()).ready,true));
test('immediate submission also works when native UI is idle', () => assert.equal(immediateEligibility(state({busy:false,completed:true})).ready,true));
for (const patch of [{editor:false},{recognized:false},{online:false},{foreground:false},{error:true},{uploading:true},{attachmentUnknown:true},{draft:''},{sendable:false}]) {
  test('immediate submission blocks '+JSON.stringify(patch), () => assert.equal(immediateEligibility(state(patch)).ready,false));
}
for (const patch of [{route:'/c/b'},{users:2},{userText:'changed'},{draft:'edited'},{attachments:'other-file'}]) {
  test('immediate recheck blocks changed snapshot '+JSON.stringify(patch), () => assert.equal(immediateEligibility(state(patch),active()).ready,false));
}
test('immediate recheck blocks transient edits even if draft text is restored', () => assert.equal(immediateEligibility(state(),active({edited:true})).ready,false));
test('immediate recheck accepts unchanged native text and attachment', () => assert.equal(immediateEligibility(state(),active()).ready,true));
