const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Gate, normalize } = require('../extension/engine.js');
const snapshot = patch => ({ route: '/c/test', users: 1, editor: true, recognized: true, busy: false, uploading: false, error: false, draft: 'next', attachments: '', completed: true, sendable: true, finalText: 'done', ...patch });
const task = patch => ({ kind: 'draft', route: '/c/test', users: 1, text: 'next', attachments: '', ...patch });
test('long-running task stays blocked for 30 minutes without time-based guessing', () => {
  const gate = new Gate();
  for (let time = 0; time <= 1800000; time += 1000) assert.equal(gate.decide(snapshot({ busy: true }), task(), time).action, 'wait');
  assert.equal(gate.decide(snapshot(), task(), 1801000).action, 'wait');
  assert.equal(gate.decide(snapshot(), task(), 1813000).action, 'send');
});
test('missing completion marker never sends even when composer is ready', () => {
  const gate = new Gate();
  assert.equal(gate.decide(snapshot({ completed: false }), task(), 0).action, 'wait');
  assert.equal(gate.decide(snapshot({ completed: false }), task(), 9999999).action, 'wait');
});
for (const [name, change] of Object.entries({ 'draft edited': { draft: 'edited' }, 'attachments changed': { attachments: 'new.pdf' }, 'conversation changed': { route: '/c/other' }, 'manual message sent': { users: 2 }, 'page error': { error: true } })) {
  test(name + ' pauses instead of sending', () => assert.equal(new Gate().decide(snapshot(change), task(), 9999999).action, 'pause'));
}
for (const [name, change] of Object.entries({ 'upload ongoing': { uploading: true }, 'send disabled': { sendable: false }, 'unknown UI': { recognized: false }, 'missing editor': { editor: false } })) {
  test(name + ' blocks sending', () => assert.equal(new Gate().decide(snapshot(change), task(), 9999999).action, 'wait'));
}
test('stream resuming resets completion countdown', () => {
  const gate = new Gate(); gate.decide(snapshot(), task(), 0);
  gate.decide(snapshot({ busy: true }), task(), 11999);
  assert.equal(gate.decide(snapshot(), task(), 12000).action, 'wait');
  assert.equal(gate.decide(snapshot(), task(), 24000).action, 'send');
});
test('changed answer resets stability countdown', () => {
  const gate = new Gate(); gate.decide(snapshot(), task(), 0);
  assert.equal(gate.decide(snapshot({ finalText: 'updated' }), task(), 12000).action, 'wait');
  assert.equal(gate.decide(snapshot({ finalText: 'updated' }), task(), 24000).action, 'send');
});
test('native attachment draft can send without moving the attachment', () => {
  const gate = new Gate({ cooldown: 5 }); const s = snapshot({ attachments: 'file.pdf' }), t = task({ attachments: 'file.pdf' });
  gate.decide(s, t, 0); assert.equal(gate.decide(s, t, 5).action, 'send');
});
test('queue never overwrites native draft or attachments', () => {
  const gate = new Gate();
  assert.equal(gate.decide(snapshot(), task({ kind: 'queue' }), 0).action, 'wait');
  assert.equal(gate.decide(snapshot({ draft: '', attachments: 'image' }), task({ kind: 'queue' }), 99999).action, 'wait');
});
test('next queued prompt waits for a new answer', () => {
  const gate = new Gate({ cooldown: 5 }), t = task({ kind: 'queue', afterFinal: 'done' });
  assert.equal(gate.decide(snapshot({ draft: '' }), t, 0).action, 'wait');
  assert.equal(gate.decide(snapshot({ draft: '', finalText: 'new answer' }), t, 10).action, 'wait');
  assert.equal(gate.decide(snapshot({ draft: '', finalText: 'new answer' }), t, 15).action, 'send');
});
test('unarmed engine cannot send', () => assert.equal(new Gate().decide(snapshot(), null).action, 'wait'));
test('normalization preserves intentional internal whitespace', () => assert.equal(normalize('  a\r\nb  '), 'a\nb'));
test('enabled send arrow and visible copy action do not override a running task', () => {
  const gate = new Gate();
  const s = snapshot({ sendable: true, completed: true, busy: true });
  assert.equal(gate.decide(s, task(), 0).action, 'wait');
  assert.equal(gate.decide(s, task(), 1800000).action, 'wait');
});
test('enabled arrow with no final marker never starts the stable countdown', () => {
  const gate = new Gate();
  const s = snapshot({ sendable: true, busy: false, completed: false });
  gate.decide(s, task(), 0);
  assert.equal(gate.readyAt, null);
  assert.equal(gate.decide(s, task(), 1800000).action, 'wait');
});
