(() => {
  'use strict';
  if (document.getElementById('nextprompt-host')) return;
  const A = NextPromptAdapter, { Gate, normalize } = NextPromptEngine;
  const host = document.createElement('div'); host.id = 'nextprompt-host';
  document.documentElement.append(host);
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `<style>
    :host{all:initial;color-scheme:light;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#152433}
    *{box-sizing:border-box}button,input,textarea,select{font:inherit}button{cursor:pointer;border:1px solid #d9e3ec;border-radius:9px;padding:8px 11px;background:white;color:#24384b}button:hover{background:#eef5fa}button:disabled{opacity:.45;cursor:default}
    #launcher{position:fixed;right:24px;bottom:22px;z-index:2147483646;border:0;background:#124d5c;color:white;box-shadow:0 8px 26px #102f4330;padding:11px 17px;border-radius:24px;font-weight:650}
    #panel{position:fixed;right:24px;bottom:80px;width:390px;max-width:calc(100vw - 24px);max-height:calc(100vh - 110px);overflow:auto;background:#f7f9fc;border:1px solid #d7e2e9;border-radius:18px;z-index:2147483646;box-shadow:0 18px 70px #102f4338}
    [hidden]{display:none!important}header{padding:18px 18px 12px;background:white;border-bottom:1px solid #e2eaf0}h1{font-size:20px;letter-spacing:-.5px;line-height:1.3;margin:0}h2{font-size:14px;margin:0 0 9px}.sub{font-size:12px;color:#65798c;margin:4px 0 0}.row{display:flex;gap:8px;align-items:center}.between{justify-content:space-between}.section{padding:14px 18px;border-bottom:1px solid #e2eaf0}.primary{background:#124d5c;color:#fff;border-color:#124d5c}.primary:hover{background:#176377}.danger{color:#a3323a}#status{background:#eaf1f5;padding:10px 12px;border-radius:10px;margin-top:12px;font-size:13px;word-break:break-word}#status[data-active="true"]{background:#e0f2ea;color:#15583e}textarea{width:100%;resize:vertical;min-height:82px;border:1px solid #cfdce6;border-radius:9px;padding:10px;background:white;color:#152433}small{font-size:12px;color:#607488}label{display:block}.controls{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.item{background:white;border:1px solid #dce5ec;border-radius:10px;padding:10px;margin-top:9px}.item p{white-space:pre-wrap;word-break:break-word;max-height:110px;overflow:auto;margin:0 0 8px}.item button{font-size:12px;padding:4px 9px}.badge{font-size:12px;border-radius:8px;background:#eaf1f5;padding:3px 8px}.wide{width:100%}details summary{cursor:pointer;font-size:13px}#logs{padding:0;list-style:none;max-height:140px;overflow:auto;font-size:12px;color:#607488}#logs li{padding:3px 0}input[type=number]{width:65px;padding:3px;border:1px solid #cfdce6;border-radius:5px}#route{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px}a{color:#124d5c}
  </style>
  <button id="launcher" aria-label="打开 NextPrompt">N → 下一步</button>
  <section id="panel" hidden aria-label="NextPrompt 控制面板">
    <header><div class="row between"><div><h1>NextPrompt <span style="font-weight:400;font-size:15px">下一步</span></h1><p class="sub">想好下一步，不必守着等。</p></div><button id="close" aria-label="收起面板">×</button></div><p class="sub" id="route"></p><div id="status" role="status">正在读取本地队列…</div></header>
    <div class="section"><h2>01 · 当前草稿</h2><small>在 ChatGPT 原生输入框写好文字、附上文件，再启用。附件原位保留；修改后会自动暂停。</small><div class="controls"><button class="primary wide" id="arm">本轮结束后发送当前草稿</button><button class="wide danger" id="pause">暂停全部自动发送</button></div></div>
    <div class="section"><div class="row between"><h2>02 · 后续任务</h2><span class="badge" id="count">0 条</span></div><textarea id="new-task" aria-label="下一步任务" placeholder="例如：根据刚才的测试结果，只修复仍失败的部分，并报告验证结果。"></textarea><div class="controls"><button id="add">加入队列</button><button class="primary" id="run">启动文字队列</button></div><small>队列仅保存文字。含附件的下一条请使用上方“当前草稿”。</small><div id="queue"></div></div>
    <div class="section"><details><summary>设置、备份与诊断</summary><p><label>稳定等待 <input id="cooldown" type="number" min="5" max="120" value="12" aria-label="稳定等待秒数"> 秒</label><small>只有识别到最后回答的完成标记后才开始计时；不按总耗时猜测结束。</small></p><div class="controls"><button id="export">导出当前队列</button><button id="import">导入文字任务</button><button id="diagnostics">复制诊断</button></div><input id="import-file" type="file" accept="application/json,.json" hidden><div class="controls"><button class="danger" id="resolve" hidden>已手动核验，解除发送锁定</button></div><p><small>刷新后需重新启动。发送结果不明时不会重试。保持电脑唤醒；新界面可能需要更新适配器。</small></p><ul id="logs"></ul></details></div>
    <div class="section"><small>v1.0 · 本地存储 · 无 API Key · 无遥测<br>非 OpenAI 官方产品。Work 界面兼容性需要实际验证；识别不到完成标记时会等待。</small></div>
  </section>`;
  const $ = id => ui.getElementById(id);
  let route = location.pathname, data, task = null, mode = null, ticking = false, mutating = false, loading = true;
  let lastTick = Date.now();
  let status = '已暂停 · 请准备下一步', gate = new Gate(), leaseRoute = null, persistChain = Promise.resolve();
  const key = () => `nextprompt:v1:${route}`;
  const blank = () => ({ version: 1, items: [], cooldown: 12, logs: [], inFlight: null });
  function persist() {
    const storageKey = key(), value = structuredClone(data);
    persistChain = persistChain.catch(() => {}).then(() => chrome.storage.local.set({ [storageKey]: value }));
    return persistChain;
  }
  function log(text) {
    data.logs.unshift({ time: new Date().toISOString(), text }); data.logs = data.logs.slice(0, 50);
    $('logs').replaceChildren(...data.logs.map(entry => { const li = document.createElement('li'); li.textContent = `${new Date(entry.time).toLocaleTimeString()} · ${entry.text}`; return li; }));
  }
  function show(text) { status = text; $('status').textContent = text; $('status').dataset.active = String(!!mode); }
  function render() {
    $('route').textContent = `当前对话 · ${route}`;
    $('count').textContent = `${data.items.length} 条`;
    $('cooldown').value = data.cooldown;
    $('resolve').hidden = !data.inFlight;
    $('queue').replaceChildren(...data.items.map((item, i) => {
      const card = document.createElement('div'); card.className = 'item';
      const p = document.createElement('p'); p.textContent = `${i + 1}. ${item.text}`; card.append(p);
      const buttons = document.createElement('div'); buttons.className = 'controls';
      for (const [name, operation] of [['编辑', () => { $('new-task').value = item.text; data.items.splice(i, 1); }], ['↑', () => { if (i) [data.items[i - 1], data.items[i]] = [data.items[i], data.items[i - 1]]; }], ['↓', () => { if (i + 1 < data.items.length) [data.items[i + 1], data.items[i]] = [data.items[i], data.items[i + 1]]; }], ['删除', () => data.items.splice(i, 1)]]) {
        const b = document.createElement('button'); b.textContent = name; b.disabled = !!mode || !!data.inFlight;
        b.onclick = () => safely(async () => { operation(); await persist(); render(); }); buttons.append(b);
      }
      card.append(buttons); return card;
    }));
    $('arm').disabled = loading || !!mode || !!data.inFlight;
    $('run').disabled = loading || !!mode || !!data.inFlight || !data.items.length;
    for (const id of ['add', 'import', 'cooldown']) $(id).disabled = loading || !!mode || !!data.inFlight;
    $('logs').replaceChildren(...data.logs.map(entry => { const li = document.createElement('li'); li.textContent = `${new Date(entry.time).toLocaleTimeString()} · ${entry.text}`; return li; }));
  }
  async function load() {
    loading = true; task = null; mode = null; gate.reset();
    const saved = (await chrome.storage.local.get(key()))[key()];
    data = blank();
    if (saved?.version === 1) {
      data.items = Array.isArray(saved.items) ? saved.items.filter(x => typeof x?.text === 'string' && x.text.trim() && x.text.length <= 50000).slice(0, 100) : [];
      data.cooldown = Math.max(5, Math.min(120, Number(saved.cooldown) || 12));
      data.logs = Array.isArray(saved.logs) ? saved.logs.slice(0, 50) : [];
      data.inFlight = saved.inFlight || null;
    }
    loading = false; gate = new Gate({ cooldown: data.cooldown * 1000 });
    show(data.inFlight ? '上次发送结果待核验 · 请检查聊天记录，自动发送已锁定' : '已暂停 · 刷新或切换后需手动启用'); render();
  }
  async function release() {
    if (!leaseRoute) return;
    const old = leaseRoute; leaseRoute = null;
    await chrome.runtime.sendMessage({ type: 'release', route: old }).catch(() => {});
  }
  async function stop(reason) {
    mode = null; task = null; gate.reset(); show(reason); render(); await release();
  }
  async function safely(action) {
    if (mutating || ticking || loading) return;
    mutating = true;
    try { await action(); } catch (error) { if (data) { log('操作停止：' + error.message); await stop(error.message); } else show(error.message); }
    finally { mutating = false; }
  }
  function makeTask(kind, s, text, afterFinal) {
    return { kind, route, text: normalize(text), attachments: s.attachments, users: s.users, afterFinal };
  }
  async function start(kind) {
    const s = A.snapshot();
    if (!s.editor || !s.recognized) throw new Error('请先打开已有消息的 ChatGPT 对话');
    if (kind === 'draft' && !s.draft) throw new Error('请先在 ChatGPT 输入框写好下一条文字');
    if (kind === 'queue' && (s.draft || s.attachments)) throw new Error('请先处理输入框里的草稿和附件');
    const lease = await chrome.runtime.sendMessage({ type: 'lease', route });
    if (!lease?.ok) throw new Error('另一个标签页正在管理此对话，请先在那边暂停');
    leaseRoute = route;
    if (cancelled) { await release(); throw new Error('启动已取消'); }
    mode = kind;
    task = makeTask(kind, s, kind === 'draft' ? s.draft : data.items[0].text);
    gate.reset(); log(kind === 'draft' ? '已启用本轮结束后发送草稿' : '已启动文字队列'); await persist(); render(); show('已启用 · 正在观察当前轮次');
  }
  async function dispatch() {
    // Lease and state are rechecked after awaits, immediately before clicking.
    const active = task, sendRoute = route;
    const lease = await chrome.runtime.sendMessage({ type: 'lease', route: sendRoute });
    if (!lease?.ok) return stop('无法取得发送锁，已暂停');
    if (active.kind === 'queue') await A.fill(active.text);
    let before = A.snapshot();
    if (before.route !== active.route || before.users !== active.users || before.busy || before.error || before.uploading || !before.sendable || before.draft !== active.text || before.attachments !== active.attachments || !before.completed) throw new Error('发送前页面状态变化，已保留草稿并暂停');
    const journal = { id: crypto.randomUUID(), kind: active.kind, at: new Date().toISOString(), itemId: active.kind === 'queue' ? data.items[0].id : null };
    data.inFlight = journal; log('已记录发送尝试，正在等待网页确认'); await persist();
    before = A.snapshot();
    if (before.route !== active.route || before.users !== active.users || before.busy || before.error || before.uploading || !before.sendable || before.draft !== active.text || before.attachments !== active.attachments || !before.completed) throw new Error('发送前最终校验失败，请手动检查并解除锁定');
    A.send();
    let acknowledged = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const s = A.snapshot();
      if (s.route !== sendRoute) break;
      const lastUser = [...document.querySelectorAll('[data-message-author-role="user"]')].at(-1);
      if (s.users === active.users + 1 && normalize(lastUser?.innerText) === active.text && !s.draft) { acknowledged = true; break; }
      if (s.users > active.users + 1 || s.error) break;
    }
    if (!acknowledged) throw new Error('发送结果不明确 · 请检查聊天记录，不会自动重试');
    data.inFlight = null;
    if (active.kind === 'queue') data.items.shift();
    log('已确认新消息出现在对话中'); await persist();
    if (cancelled || !mode) return stop('已暂停 · 本条发送已确认');
    if (active.kind === 'draft' || !data.items.length) return stop('已完成 · 所有指定消息已发送');
    task = makeTask('queue', A.snapshot(), data.items[0].text, before.finalText);
    gate.reset(); render(); show('等待新一轮回答完成');
  }
  async function tick() {
    if (ticking || mutating || loading) return;
    ticking = true;
    try {
      if (location.pathname !== route) {
        await stop('对话已切换'); await persistChain.catch(() => {}); route = location.pathname; await load(); return;
      }
      if (!mode) return;
      const lease = await chrome.runtime.sendMessage({ type: 'lease', route });
      if (!lease?.ok) return stop('另一个标签页持有发送锁，已暂停');
      const now = Date.now();
      if (now - lastTick > 5000) gate.reset();
      lastTick = now;
      const s = A.snapshot();
      const decision = gate.decide(s, task);
      show(decision.reason);
      if (decision.action === 'pause') { log(decision.reason); await stop(decision.reason); await persist(); }
      if (decision.action === 'send') await dispatch();
    } catch (error) {
      if (data) { log(error.message); await stop(error.message); await persist().catch(() => {}); }
      else show('本地存储不可用 · 请重新加载扩展');
    } finally { ticking = false; if (!mode) await release(); }
  }
  $('launcher').onclick = () => { $('panel').hidden = !$('panel').hidden; };
  $('close').onclick = () => { $('panel').hidden = true; };
  $('arm').onclick = () => safely(() => start('draft'));
  $('run').onclick = () => safely(() => start('queue'));
  // Pause is checked during dispatch too: mark cancellation synchronously, then release after tick.
  let cancelled = false;
  $('pause').onclick = () => { cancelled = true; mode = null; task = null; gate.reset(); show('已暂停 · 正在结束当前检查'); render(); if (!ticking) release(); };
  const originalSend = A.send;
  A.send = () => { if (cancelled || !mode) throw new Error('已暂停，未点击发送'); originalSend(); };
  const originalStart = start;
  start = async kind => { cancelled = false; return originalStart(kind); };
  $('add').onclick = () => safely(async () => {
    const text = normalize($('new-task').value);
    if (!text || text.length > 50000 || data.items.length >= 100) throw new Error('请输入 1–50000 字符；每个对话最多 100 条');
    data.items.push({ id: crypto.randomUUID(), text }); await persist(); $('new-task').value = ''; render(); show('已加入队列 · 点击启动后才会自动发送');
  });
  $('cooldown').onchange = () => safely(async () => {
    data.cooldown = Math.max(5, Math.min(120, Number($('cooldown').value) || 12));
    gate = new Gate({ cooldown: data.cooldown * 1000 }); await persist(); render();
  });
  $('resolve').onclick = () => safely(async () => {
    if (!confirm('请先在 ChatGPT 聊天记录中核验上次消息。解除锁定不会删除队列项：若已发送，请先删除对应任务，再启动。继续解除？')) return;
    data.inFlight = null; log('用户手动解除待核验发送锁'); await persist(); render(); show('已解除锁定 · 请检查队列后重新启用');
  });
  $('export').onclick = () => safely(async () => {
    const blob = new Blob([JSON.stringify({ version: 1, tasks: data.items.map(x => ({ text: x.text })) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'nextprompt-tasks.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); show('已导出文字队列（不包含对话内容或附件）');
  });
  $('import').onclick = () => $('import-file').click();
  $('import-file').onchange = () => safely(async () => {
    const file = $('import-file').files[0]; $('import-file').value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) throw new Error('导入文件不可超过 1 MB');
    const parsed = JSON.parse(await file.text());
    if (parsed.version !== 1 || !Array.isArray(parsed.tasks) || !parsed.tasks.length || parsed.tasks.length + data.items.length > 100 || parsed.tasks.some(x => typeof x?.text !== 'string' || !normalize(x.text) || x.text.length > 50000)) throw new Error('任务文件格式错误：需要 version:1 和 tasks:[{text:...}]，合计最多 100 条');
    data.items.push(...parsed.tasks.map(x => ({ id: crypto.randomUUID(), text: normalize(x.text) })));
    await persist(); render(); show('已导入 · 请检查内容并手动启动');
  });
  $('diagnostics').onclick = () => safely(async () => {
    const s = A.snapshot();
    await navigator.clipboard.writeText(JSON.stringify({ version: '1.0.0', editor: s.editor, recognized: s.recognized, busy: s.busy, uploading: s.uploading, error: s.error, sendable: s.sendable, completed: s.completed, hasDraft: !!s.draft, hasAttachments: !!s.attachments, mode, locked: !!data.inFlight }, null, 2));
    show('已复制诊断 · 不含提示词、附件名称或对话内容');
  });
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'toggle-panel') $('launcher').click(); });
  load().then(() => setInterval(tick, 1000)).catch(error => show('无法读取本地队列：' + error.message));
})();
