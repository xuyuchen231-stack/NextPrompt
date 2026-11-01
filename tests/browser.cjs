/* Offline integration fixtures: no ChatGPT credentials, API calls or real messages. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', 'playwright'))); }
const token = 'NEXT_PROMPT_DONE_' + 'a'.repeat(32);
const fixture = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>body{font:16px/1.7 system-ui;background:#f9fafb;color:#263747;margin:0;padding:64px 8%}main{max-width:750px}article{background:white;padding:22px;border-radius:14px;margin-bottom:18px}form{position:fixed;left:8%;bottom:32px;width:50%;background:white;border:1px solid #ddd;border-radius:20px;padding:18px}#prompt-textarea{min-height:70px;outline:0;white-space:pre-wrap}button{padding:8px}h1{font-size:30px}small{color:#667}[data-message-author-role]{white-space:pre-wrap}</style></head><body><main><small>OFFLINE TEST FIXTURE · 无真实消息发送</small><h1>项目改进 · 工作对话</h1><article><div data-message-author-role="user">检查这次改动，完成测试后报告结果。<br>NEXT_PROMPT_DONE_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</div></article><article id="answer"><div data-message-author-role="assistant">已完成当前修改。正在验证测试结果…</div></article></main><form onsubmit="return false"><div contenteditable="true" id="prompt-textarea" role="textbox" aria-label="ChatGPT 输入框"></div><button type="button" data-testid="send-button">发送</button><button type="button" data-testid="stop-button">停止生成</button></form><script>window.sent=[];document.querySelector('[data-testid="send-button"]').onclick=()=>{const e=document.getElementById('prompt-textarea');const text=e.innerText.trim();if(!text)return;window.sent.push(text);const a=document.createElement('article');const u=document.createElement('div');u.dataset.messageAuthorRole='user';u.textContent=text;a.append(u);document.querySelector('main').append(a);e.innerText='';document.querySelectorAll('[data-testid="attachment"]').forEach(x=>x.remove());if(!document.querySelector('[data-testid="stop-button"]')){const b=document.createElement('button');b.dataset.testid='stop-button';b.textContent='停止生成';document.querySelector('form').append(b);}};</script></body></html>`;
(async () => {
 const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
 try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  // Mock only extension APIs. The adapter and all UI/controller code run unmodified.
  await context.addInitScript(() => {
    window.chrome = { storage: { local: { get: async k => ({ [k]: JSON.parse(localStorage.getItem(k) || 'null') }), set: async obj => { for (const [k,v] of Object.entries(obj)) localStorage.setItem(k, JSON.stringify(v)); } } }, runtime: { sendMessage: async () => ({ ok:true }), onMessage: { addListener(){} } } };
  });
  const page = await context.newPage(); const errors=[]; page.on('pageerror',e=>{errors.push(e.message);console.error('FIXTURE PAGE ERROR:',e.message);});
  const waitForSent = async count => {
    try { await page.waitForFunction(count=>sent.length===count,count,{timeout:12000}); }
    catch(error) { console.error('FIXTURE STATE:', JSON.stringify(await page.evaluate(()=>({snapshot:NextPromptAdapter.snapshot(),status:document.querySelector('#nextprompt-host').shadowRoot.getElementById('status').textContent,logs:document.querySelector('#nextprompt-host').shadowRoot.getElementById('logs').textContent,sent})),null,2)); throw error; }
  };
  const boot = async ({ locked = false } = {}) => {
    await page.evaluate(token => {
      const key = 'nextprompt:v1:/c/fixture';
      const saved = JSON.parse(localStorage.getItem(key)||'null') || { version:1, items:[], logs:[], cooldown:5, inFlight:null, tokens:[] };
      saved.tokens = [...new Set([...(saved.tokens||[]),token])];
      localStorage.setItem(key, JSON.stringify(saved));
    }, token);
    for (const file of ['engine.js','adapter.js','content.js']) await page.addScriptTag({ path:path.join(__dirname,'../extension',file) });
    await page.locator('#nextprompt-host #launcher').click();
    await page.waitForFunction(locked => document.querySelector('#nextprompt-host')?.shadowRoot?.getElementById('status').textContent.includes(locked ? '待核验' : '已暂停'), locked);
    if (locked) return;
    await page.evaluate(token => document.querySelector('[data-message-author-role="user"]').innerText = '检查本轮任务。\n' + NextPromptEngine.contract(token), token);
    await page.locator('#nextprompt-host summary').click();
    await page.locator('#nextprompt-host #cooldown').fill('5');
    await page.locator('#nextprompt-host #cooldown').dispatchEvent('change');
    await page.locator('#nextprompt-host summary').click();
  };
  const complete = async text => page.evaluate(text=>{document.querySelector('[data-testid="stop-button"]')?.remove();document.querySelector('#answer [data-message-author-role="assistant"]').textContent=text;const b=document.createElement('button');b.dataset.testid='copy-turn-action-button';b.textContent='复制';document.querySelector('#answer').append(b);},text+'\n'+token);
  const root = '#nextprompt-host ';
  await page.goto('https://chatgpt.com/c/fixture'); await boot();
  const probe = 'literal <script>window.unwanted=true</script> & quotes\n\nblank line\n\n\nthird line';
  await page.evaluate(text=>NextPromptAdapter.fill(text),probe);
  assert.equal(await page.evaluate(()=>NextPromptAdapter.draft()),probe);
  assert.equal(await page.locator('#prompt-textarea script').count(),0);
  await page.locator('#prompt-textarea').fill('');
  console.log('PASS exact multiline/blank-line insertion with escaped markup');
  await page.locator('#prompt-textarea').fill('根据测试结果，只修复仍失败的部分。');
  await page.evaluate(()=>{const a=document.createElement('span');a.dataset.testid='attachment';a.textContent='测试数据.xlsx';document.querySelector('form').append(a);});
  await page.locator(root+'#arm').click();
  await page.waitForTimeout(2200); assert.equal(await page.evaluate(()=>sent.length),0);
  await page.evaluate(()=>{document.querySelector('[data-testid="stop-button"]')?.remove();const b=document.createElement('button');b.dataset.testid='copy-turn-action-button';b.textContent='复制';document.querySelector('#answer').append(b);});
  await page.waitForTimeout(6500); assert.equal(await page.evaluate(()=>sent.length),0);
  console.log('PASS available send/copy buttons and silence WITHOUT token never send');
  await complete('当前修改已完成，测试已通过。');
  await waitForSent(1);
  assert.equal(await page.evaluate(()=>sent[0]),'根据测试结果，只修复仍失败的部分。');
  await page.waitForTimeout(1500); assert.equal(await page.evaluate(()=>sent.length),1);
  console.log('PASS native draft + attachment; busy blocks; confirmed once only');
  await page.reload(); await boot();
  await page.locator('#prompt-textarea').fill('原始草稿'); await page.locator(root+'#arm').click();
  await page.locator('#prompt-textarea').fill('尚未写完的新草稿');
  await page.waitForFunction(()=>document.querySelector('#nextprompt-host').shadowRoot.getElementById('status').textContent.includes('启用后输入框发生编辑'));
  await complete('已结束'); await page.waitForTimeout(6500); assert.equal(await page.evaluate(()=>sent.length),0);
  console.log('PASS draft edits cancel automation');
  await page.locator('#prompt-textarea').fill('待取消'); await page.locator(root+'#arm').click(); await page.locator(root+'#pause').click();
  await page.waitForTimeout(6500); assert.equal(await page.evaluate(()=>sent.length),0);
  console.log('PASS pause prevents sending');
  await page.locator('#prompt-textarea').fill('');
  for (const text of ['检查改动，报告剩余问题。','根据实际结果给出下一步建议。']) { await page.locator(root+'#new-task').fill(text); await page.locator(root+'#add').click(); }
  await page.locator(root+'#run').click();
  await waitForSent(1);
  await page.waitForTimeout(6500); assert.equal(await page.evaluate(()=>sent.length),1);
  // Replace the prior assistant with a new completed turn.
  await page.evaluate(()=>{const token=sent[0].match(/NEXT_PROMPT_DONE_[a-f0-9]{32}/g).at(-1);const a=document.createElement('article');a.id='new-answer';const body=document.createElement('div');body.dataset.messageAuthorRole='assistant';body.textContent='这是新一轮检查结果。\n'+token;const b=document.createElement('button');b.dataset.testid='copy-turn-action-button';b.textContent='复制';a.append(body,b);document.querySelector('main').append(a);document.querySelector('[data-testid="stop-button"]')?.remove();});
  await waitForSent(2);
  const sentItems=await page.evaluate(()=>sent);
  assert(sentItems[0].startsWith('检查改动，报告剩余问题。\n\n【NextPrompt'));
  assert(sentItems[1].startsWith('根据实际结果给出下一步建议。\n\n【NextPrompt'));
  assert.notEqual(sentItems[0].match(/NEXT_PROMPT_DONE_[a-f0-9]{32}/g).at(-1),sentItems[1].match(/NEXT_PROMPT_DONE_[a-f0-9]{32}/g).at(-1));
  await page.waitForFunction(()=>document.querySelector('#nextprompt-host').shadowRoot.getElementById('status').textContent.includes('已完成'));
  console.log('PASS two-item queue waits for a new answer between sends');
  await page.reload(); await boot();
  assert.equal(await page.locator(root+'#count').textContent(),'0 条');
  assert((await page.locator(root+'#status').textContent()).includes('已暂停'));
  await page.locator(root+'#new-task').fill('结合当前结果，检查未覆盖的边界情况。'); await page.locator(root+'#add').click();
  await page.locator('#prompt-textarea').fill('请验证 Excel 导出后的数值和单位。');
  fs.mkdirSync(path.join(__dirname,'../docs/images'),{recursive:true});
  await page.screenshot({path:path.join(__dirname,'../docs/images/preview.png'),fullPage:true});
  await page.locator(root+'#prepare').click();
  const prepared=await page.evaluate(()=>JSON.parse(localStorage.getItem('nextprompt:v1:/c/fixture')).tokens.at(-1));
  assert(/^NEXT_PROMPT_DONE_[a-f0-9]{32}$/.test(prepared));
  await page.evaluate(()=>document.querySelector('[data-message-author-role="user"]').textContent='没有结束约定的任务');
  await page.locator(root+'#arm').click();
  assert((await page.locator(root+'#status').textContent()).includes('本轮没有结束约定'));
  await page.evaluate(()=>{const key='nextprompt:v1:/c/fixture';const saved=JSON.parse(localStorage.getItem(key));saved.inFlight={id:'interrupted-fixture-attempt',kind:'queue',at:new Date().toISOString()};localStorage.setItem(key,JSON.stringify(saved));});
  await page.reload(); await boot({locked:true});
  assert(await page.locator(root+'#arm').isDisabled());
  assert(await page.locator(root+'#run').isDisabled());
  console.log('PASS reload with an uncertain send remains locked without retry');
  assert.deepEqual(errors,[]); console.log('PASS persistence, reload-paused, UI runtime; screenshot saved');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
