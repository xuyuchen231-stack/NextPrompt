const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Gate, normalize, finalMarker, validToken, contract } = require('../extension/engine.js');
const token = 'NEXT_PROMPT_DONE_' + 'a'.repeat(32);
const other = 'NEXT_PROMPT_DONE_' + 'b'.repeat(32);
const prompt = '检查项目\n' + contract(token);
const snapshot = patch => ({ route: '/c/test', users: 1, userText: prompt, editor: true, recognized: true, busy: false, uploading: false, error: false, draft: 'next', attachments: '', completed: true, sendable: true, finalText: 'done\n' + token, finalId: 'reply-1', markerSafe: true, online: true, foreground: true, interrupted: false, nonFinal: false, attachmentUnknown: false, ...patch });
const task = patch => ({ kind: 'draft', route: '/c/test', users: 1, userText: prompt, text: 'next', attachments: '', token, ...patch });
function observe(gate, s, t, start = 0, duration = 12000) {
  let result;
  for (let time = start; time <= start + duration; time += 1000) result = gate.decide(s, t, time);
  return result;
}
test('matching per-turn protocol and continuous observations permit sending', () => assert.equal(observe(new Gate(), snapshot(), task()).action, 'send'));
test('long execution and an enabled arrow never override busy status', () => {
  const gate = new Gate();
  for (let time = 0; time <= 1800000; time += 1000) assert.equal(gate.decide(snapshot({ busy: true }), task(), time).action, 'wait');
  assert.equal(observe(gate, snapshot(), task(), 1801000).action, 'send');
});
for (const [name, change] of Object.entries({
  'copy button without token': { finalText: '已完成，继续运行工具' },
  'old or wrong token': { finalText: 'done\n' + other },
  'trailing progress after token': { finalText: token + '\n正在继续测试' },
  'inline token': { finalText: 'done ' + token },
  'no completion actions': { completed: false },
  'progress channel': { nonFinal: true },
  'token rendered in code or quote': { markerSafe: false },
  'attachment uploading': { uploading: true },
  'unknown attachment structure': { attachmentUnknown: true },
  'offline': { online: false },
  'background page': { foreground: false },
  'unknown UI': { recognized: false },
  'missing editor': { editor: false },
  'disabled send': { sendable: false }
})) {
  test(name + ' cannot trigger a send after any wait', () => {
    const gate = new Gate(), s = snapshot(change);
    assert.equal(observe(gate, s, task()).action, 'wait');
    assert.equal(gate.decide(s, task(), 9999999).action, 'wait');
    assert.equal(gate.readyAt, null);
  });
}
for (const [name, change] of Object.entries({
  'edited draft': { draft: 'edited' }, 'changed attachments': { attachments: 'new.pdf' },
  'conversation changed': { route: '/c/other' }, 'manual message sent': { users: 2 },
  'same-count user message edited': { userText: 'edited task' }, 'error or confirmation': { error: true },
  'manually stopped': { interrupted: true }
})) test(name + ' pauses', () => assert.equal(new Gate().decide(snapshot(change), task(), 0).action, 'pause'));
test('missing registered protocol is blocked even if response has a marker', () => {
  assert.equal(observe(new Gate(), snapshot(), task({ token: null })).action, 'wait');
  const s = snapshot({ userText: 'no contract' }), t = task({ userText: 'no contract' });
  assert.equal(observe(new Gate(), s, t).action, 'wait');
});
test('a transient input event invalidates the arm even if text is restored', () => assert.equal(new Gate().decide(snapshot(), task({ edited: true }), 0).action, 'pause'));
test('generation resuming resets the entire window', () => {
  const gate = new Gate(); observe(gate, snapshot(), task(), 0, 10000);
  gate.decide(snapshot({ busy: true }), task(), 11000);
  assert.equal(gate.decide(snapshot(), task(), 12000).action, 'wait');
  assert.equal(observe(gate, snapshot(), task(), 12000).action, 'send');
});
test('new response text or identity resets the stability period', () => {
  for (const change of [{ finalText: 'updated\n' + token }, { finalId: 'different-response' }]) {
    const gate = new Gate(); observe(gate, snapshot(), task());
    assert.equal(gate.decide(snapshot(change), task(), 13000).action, 'wait');
    assert.equal(observe(gate, snapshot(change), task(), 13000).action, 'send');
  }
});
test('sleep or large observation gap does not count as stable time', () => {
  const gate = new Gate(); gate.decide(snapshot(), task(), 0);
  assert.equal(gate.decide(snapshot(), task(), 1800000).action, 'wait');
  assert.equal(gate.samples, 1);
});
test('backwards clock movement invalidates the old window', () => {
  const gate = new Gate(); observe(gate, snapshot(), task());
  assert.equal(gate.decide(snapshot(), task(), 0).action, 'wait');
});
test('at least three distinct samples are required', () => {
  const gate = new Gate({ cooldown: 0 });
  assert.equal(gate.decide(snapshot(), task(), 0).action, 'wait');
  assert.equal(gate.decide(snapshot(), task(), 0).action, 'wait');
  assert.equal(gate.decide(snapshot(), task(), 1000).action, 'wait');
  assert.equal(gate.decide(snapshot(), task(), 2000).action, 'send');
});
test('unarmed engine cannot send', () => assert.equal(new Gate().decide(snapshot(), null, 0).action, 'wait'));
test('native file draft keeps its attachment signature', () => assert.equal(observe(new Gate(), snapshot({ attachments: 'file.pdf' }), task({ attachments: 'file.pdf' })).action, 'send'));
test('queue never overwrites a native draft or attachment', () => {
  assert.equal(observe(new Gate(), snapshot(), task({ kind: 'queue' })).action, 'wait');
  assert.equal(observe(new Gate(), snapshot({ draft: '', attachments: 'file' }), task({ kind: 'queue' })).action, 'wait');
});
test('queue dispatch rechecks before AND after controlled insertion', () => {
  const gate = new Gate(), s = snapshot({ draft: '' }), t = task({ kind: 'queue' });
  assert.equal(observe(gate, s, t).action, 'send');
  assert.equal(gate.recheck(s, t, 12000, { prepared: false }), true);
  const wire = 'next\n\n' + contract(other);
  assert.equal(gate.recheck(snapshot({ draft: wire }), { ...t, text: wire }, 12250), true);
  assert.equal(gate.recheck(snapshot({ draft: wire, finalText: 'updated\n' + token }), { ...t, text: wire }, 12250), false);
});
test('last-moment missing token, renewed busy state, or stale observation prevents clicking', () => {
  const gate = new Gate(); observe(gate, snapshot(), task());
  for (const change of [{ finalText: 'no token' }, { busy: true }, { foreground: false }, { userText: 'changed' }, { finalId: 'other' }]) assert.equal(gate.recheck(snapshot(change), task(), 12001), false);
  assert.equal(gate.recheck(snapshot(), task(), 18000), false);
});
test('next turn requires its OWN token, not an old response or arbitrary changed answer', () => {
  const t = task({ token: other, userText: 'next\n' + contract(other) });
  const s = snapshot({ draft: '', userText: t.userText, finalText: 'new answer\n' + token });
  assert.equal(observe(new Gate(), s, { ...t, kind: 'queue' }).action, 'wait');
});
test('marker must be exact, final, outside fenced examples', () => {
  assert(finalMarker('done\n' + token, token));
  for (const text of ['```text\n' + token, '~~~\n' + token, '> ' + token, '`' + token + '`', token + '\nmore', '```\n' + token + '\n```']) assert.equal(finalMarker(text, token), false, text);
  assert(finalMarker('```js\nconst x = 1;\n```\n' + token, token));
});
test('protocol generator rejects arbitrary markers and constrains their use', () => {
  assert(validToken(token)); assert(!validToken('DONE')); assert.throws(() => contract('DONE'));
  assert(contract(token).includes('工具调用和验证均已结束'));
  assert(contract(token).endsWith(token));
});
test('normalization preserves internal whitespace', () => assert.equal(normalize('  a\r\nb  '), 'a\nb'));
