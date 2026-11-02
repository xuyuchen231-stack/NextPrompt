(() => {
  'use strict';
  if (document.getElementById('nextprompt-host')) return;
  const A = NextPromptAdapter, { Gate, normalize, validToken, contract, protocolInPrompt, immediateEligibility } = NextPromptEngine;
  const newToken = () => `NEXT_PROMPT_DONE_${crypto.randomUUID().replaceAll("-", "")}`;
  const { ui, selectTab, icon } = NextPromptUI.mount();
  const $ = id => ui.getElementById(id);
  let route = location.pathname, data, task = null, mode = null, ticking = false, mutating = false, loading = true;
  let lastTick = performance.now(), filling = false, editState = null;
  let status = '已暂停 · 请准备下一步', gate = new Gate(), leaseRoute = null, persistChain = Promise.resolve();
  const key = () => `nextprompt:v1:${route}`;
  const blank = () => ({ version: 1, items: [], cooldown: 12, logs: [], tokens: [], inFlight: null });
  function persist() {
    const storageKey = key(), value = structuredClone(data);
    persistChain = persistChain.catch(() => {}).then(() => chrome.storage.local.set({ [storageKey]: value }));
    return persistChain;
  }
  function log(text) {
    data.logs.unshift({ time: new Date().toISOString(), text }); data.logs = data.logs.slice(0, 50);
    $('logs').replaceChildren(...data.logs.map(entry => { const li = document.createElement('li'); li.textContent = `${new Date(entry.time).toLocaleTimeString()} · ${entry.text}`; return li; }));
  }
  const setText = (id, text) => { if ($(id).textContent !== String(text)) $(id).textContent = text; };
  function refreshOverview(s = A.snapshot()) {
    if (!data) return;
    setText('route', document.title.replace(/\s*[-–—|]\s*ChatGPT\s*$/i, '') || '当前 ChatGPT 对话');
    setText('pending-count', data.items.length); setText('nav-count', data.items.length);
    setText('wait-count', data.cooldown); setText('auto-state', mode === 'immediate' ? '提交中' : mode ? '已启用' : '未启用');
    const ready = data.tokens.some(value => protocolInPrompt(s.userText, value));
    setText('protocol-state', ready ? '本轮已设置' : '待准备'); $('protocol-state').dataset.ready = String(ready);
    setText('draft-state', s.draft ? '草稿已就绪' : '待写入'); $('draft-state').dataset.ready = String(!!s.draft);
    setText('attachment-state', s.attachments ? '已检测到附件，发送时原位保留' : '文件通过 ChatGPT 原生输入框上传');
    setText('state-label', data.inFlight ? '待核验' : mode === 'immediate' ? '提交中' : mode ? '等待中' : status.startsWith('已提交') ? '已提交' : status.startsWith('已完成') ? '已完成' : '已暂停');
    $('state-label').dataset.active = String(!!mode); $('state-label').dataset.locked = String(!!data.inFlight);
    $('pause').dataset.active = String(!!mode); $('launcher').dataset.active = String(!!mode);
  }
  function show(text) { status = text; setText('status', text); $('status').dataset.active = String(!!mode); refreshOverview(); }
  function renderQueue() {
    const keyword = normalize($('search').value).toLocaleLowerCase();
    const rows = data.items.map((item, index) => ({ item, index })).filter(({ item }) => item.text.toLocaleLowerCase().includes(keyword));
    const locked = !!mode || !!data.inFlight;
    const cards = rows.map(({ item, index }) => {
      const card = document.createElement('div'); card.className = 'item'; card.dataset.next = String(index === 0);
      const heading = document.createElement('div'); heading.className = 'item-head';
      const number = document.createElement('span'); number.className = 'item-index'; number.textContent = String(index + 1).padStart(2, '0');
      const label = document.createElement('span'); label.className = 'item-state'; label.textContent = index === 0 ? (mode === 'queue' ? '正在等待本轮完成' : '下一条') : '等待前序任务'; heading.append(number, label); card.append(heading);
      if (editState?.id === item.id) {
        const editor = document.createElement('textarea'); editor.value = editState.text; editor.maxLength = 50000; editor.setAttribute('aria-label', '编辑任务');
        editor.oninput = () => { editState.text = editor.value; };
        const controls = document.createElement('div'); controls.className = 'controls';
        const save = document.createElement('button'); save.className = 'primary'; save.textContent = '保存修改'; save.disabled = locked;
        save.onclick = () => safely(async () => {
          const text = normalize(editState.text); if (!text || text.length > 50000) throw new Error('任务需要 1–50000 个字符');
          item.text = text; editState = null; await persist(); render(); show('任务已更新 · 顺序保持不变');
        });
        const cancel = document.createElement('button'); cancel.textContent = '取消'; cancel.onclick = () => { editState = null; render(); };
        controls.append(save, cancel); card.append(editor, controls); return card;
      }
      const p = document.createElement('p'); p.textContent = item.text; card.append(p);
      const actions = document.createElement('div'); actions.className = 'item-actions';
      for (const [name, picture, operation, unavailable] of [
        ['上移', 'up', () => { [data.items[index - 1], data.items[index]] = [data.items[index], data.items[index - 1]]; }, index === 0],
        ['下移', 'down', () => { [data.items[index + 1], data.items[index]] = [data.items[index], data.items[index + 1]]; }, index + 1 === data.items.length]
      ]) {
        const button = document.createElement('button'); button.className = 'icon-button'; button.innerHTML = icon(picture); button.title = name; button.setAttribute('aria-label', `${name}任务 ${index + 1}`); button.disabled = locked || !!editState || unavailable;
        button.onclick = () => safely(async () => { operation(); await persist(); render(); }); actions.append(button);
      }
      const spacer = document.createElement('span'); spacer.className = 'spacer'; actions.append(spacer);
      const edit = document.createElement('button'); edit.className = 'text-button'; edit.innerHTML = icon('edit') + '编辑'; edit.disabled = locked || !!editState;
      edit.onclick = () => { if (locked) return; editState = { id:item.id, text:item.text }; render(); $('queue').querySelector('textarea')?.focus(); };
      const remove = document.createElement('button'); remove.className = 'text-button danger'; remove.innerHTML = icon('trash') + '删除'; remove.disabled = locked || !!editState;
      remove.onclick = () => safely(async () => { data.items.splice(index, 1); await persist(); render(); });
      actions.append(edit, remove); card.append(actions); return card;
    });
    if (!cards.length) {
      const empty = document.createElement('div'); empty.className = 'empty';
      empty.innerHTML = `<div class="empty-symbol" aria-hidden="true"></div><h3>${keyword ? '没有匹配的任务' : '先放下你的下一步。'}</h3><p>${keyword ? '换个关键词，或清空搜索。' : '写下任务，加入队列。<br>只有手动启动后才会发送。'}</p>`; cards.push(empty);
    }
    $('queue').replaceChildren(...cards);
  }
  function render() {
    refreshOverview(); setText('count', `${data.items.length} 条`);
    setText('char-count', $('new-task').value.length.toLocaleString());
    $('cooldown').value = data.cooldown; $('resolve').hidden = !data.inFlight;
    renderQueue();
    $('send-now').disabled = loading || !!mode || !!data.inFlight || !!editState;
    $('arm').disabled = loading || !!mode || !!data.inFlight || !!editState;
    $('run').disabled = loading || !!mode || !!data.inFlight || !!editState || !data.items.length;
    for (const id of ['add','import','cooldown','prepare']) $(id).disabled = loading || !!mode || !!data.inFlight || !!editState;
    $('search').disabled = !!editState;
    $('logs').replaceChildren(...data.logs.map(entry => { const li = document.createElement('li'); li.textContent = `${new Date(entry.time).toLocaleTimeString()} · ${entry.text}`; return li; }));
  }
  async function load(carriedTokens = []) {
    loading = true; task = null; mode = null; editState = null; gate.reset();
    const saved = (await chrome.storage.local.get(key()))[key()];
    data = blank();
    if (saved?.version === 1) {
      data.items = Array.isArray(saved.items) ? saved.items.filter(x => typeof x?.text === 'string' && x.text.trim() && x.text.length <= 50000).slice(0, 100) : [];
      data.cooldown = Math.max(5, Math.min(120, Number(saved.cooldown) || 12));
      data.logs = Array.isArray(saved.logs) ? saved.logs.slice(0, 50) : [];
      data.inFlight = saved.inFlight || null;
      data.tokens = Array.isArray(saved.tokens) ? saved.tokens.filter(validToken).slice(-100) : [];
    }
    const prompt = A.snapshot().userText;
    for (const token of carriedTokens) if (validToken(token) && protocolInPrompt(prompt, token) && !data.tokens.includes(token)) data.tokens.push(token);
    if (data.inFlight?.nextToken && validToken(data.inFlight.nextToken) && protocolInPrompt(prompt, data.inFlight.nextToken) && !data.tokens.includes(data.inFlight.nextToken)) data.tokens.push(data.inFlight.nextToken);
    await persist();
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
  function makeTask(kind, s, text) {
    const token = [...data.tokens].reverse().find(value => protocolInPrompt(s.userText, value));
    return { kind, route, text: normalize(text), attachments: s.attachments, users: s.users, userText: s.userText, token };
  }
  async function start(kind) {
    if (editState) throw new Error('请先保存或取消任务编辑');
    const s = A.snapshot();
    if (!s.editor || !s.recognized) throw new Error('请先打开已有消息的 ChatGPT 对话');
    if (kind === 'draft' && !s.draft) throw new Error('请先在 ChatGPT 输入框写好下一条文字');
    if (kind === 'queue' && (s.draft || s.attachments)) throw new Error('请先处理输入框里的草稿和附件');
    if (!data.tokens.some(value => protocolInPrompt(s.userText, value))) throw new Error('本轮没有结束约定：请先复制约定并随本轮任务发送；不会用蓝色箭头猜测');
    const lease = await chrome.runtime.sendMessage({ type: 'lease', route });
    if (!lease?.ok) throw new Error('另一个标签页正在管理此对话，请先在那边暂停');
    leaseRoute = route;
    if (cancelled) { await release(); throw new Error('启动已取消'); }
    mode = kind;
    task = makeTask(kind, s, kind === 'draft' ? s.draft : data.items[0].text);
    gate.reset(); log(kind === 'draft' ? '已启用本轮结束后发送草稿' : '已启动文字队列'); await persist(); render(); show('已启用 · 正在观察当前轮次');
  }
  async function confirmReceipt(active, sendRoute) {
    let acknowledged = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const s = A.snapshot();
      if (s.route !== sendRoute) break;
      const lastUser = [...document.querySelectorAll('[data-message-author-role="user"]')].at(-1);
      if (s.users === active.users + 1 && normalize(lastUser?.innerText) === active.text && !s.draft) { acknowledged = true; break; }
      if (s.users > active.users + 1 || s.error) break;
    }
    if (!acknowledged) throw new Error('提交尚未在聊天记录确认 · 请检查是否进入原生队列，不会自动重试');
  }
  async function sendImmediate() {
    if (mode || editState || data.inFlight) throw new Error('请先暂停自动发送、结束编辑或核验上次发送');
    const s = A.snapshot(), initial = immediateEligibility(s);
    if (!initial.ready) throw new Error(initial.reason);
    cancelled = false;
    const active = { kind:'immediate', route, users:s.users, userText:s.userText, text:s.draft, attachments:s.attachments, edited:false };
    mode = 'immediate'; task = active; render(); show('正在提交原生草稿…');
    const lease = await chrome.runtime.sendMessage({ type:'lease', route });
    if (!lease?.ok) throw new Error('其他标签页正在管理此对话，请先暂停');
    leaseRoute = route;
    let ready = immediateEligibility(A.snapshot(), active);
    if (cancelled || !mode || !ready.ready) throw new Error(cancelled ? '提交已取消' : ready.reason);
    data.inFlight = { id:crypto.randomUUID(), kind:'immediate', at:new Date().toISOString(), itemId:null, nextToken:null };
    log('已记录立即提交尝试，等待网页回执'); await persist();
    ready = immediateEligibility(A.snapshot(), active);
    if (cancelled || !mode || !ready.ready) throw new Error(cancelled ? '提交已取消' : ready.reason);
    A.send();
    await confirmReceipt(active, route);
    data.inFlight = null; log('已确认原生草稿提交，不代表本轮工作已结束'); await persist();
    await stop('已提交 · 按网页当前设置补充或排队');
  }
  async function dispatch() {
    // Lease and state are rechecked after awaits, immediately before clicking.
    const active = { ...task }, sendRoute = route;
    const nextToken = active.kind === 'queue' ? newToken() : null;
    if (nextToken) active.text = `${active.text}\n\n${contract(nextToken)}`;
    const lease = await chrome.runtime.sendMessage({ type: 'lease', route: sendRoute });
    if (!lease?.ok) return stop('无法取得发送锁，已暂停');
    if (!mode || cancelled || !gate.recheck(A.snapshot(), task, performance.now(), { prepared: false })) throw new Error('发送准备前结束证据已变化，已暂停');
    if (active.kind === 'queue') {
      let insertion;
      filling = true;
      try { insertion = A.fill(active.text); } finally { filling = false; }
      await insertion;
    }
    let before = A.snapshot();
    if (!mode || cancelled || !gate.recheck(before, active, performance.now())) throw new Error('发送前页面状态变化，已保留草稿并暂停');
    const journal = { id: crypto.randomUUID(), kind: active.kind, at: new Date().toISOString(), itemId: active.kind === 'queue' ? data.items[0].id : null, nextToken };
    data.inFlight = journal; log('已记录发送尝试，正在等待网页确认'); await persist();
    before = A.snapshot();
    if (!mode || cancelled || !gate.recheck(before, active, performance.now())) throw new Error('发送前最终校验失败，请手动检查并解除锁定');
    A.send();
    await confirmReceipt(active, sendRoute);
    data.inFlight = null;
    data.tokens = data.tokens.filter(value => value !== active.token);
    if (nextToken) data.tokens.push(nextToken);
    if (active.kind === 'queue') data.items.shift();
    log('已确认新消息出现在对话中'); await persist();
    if (cancelled || !mode) return stop('已暂停 · 本条发送已确认');
    if (active.kind === 'draft' || !data.items.length) return stop('已完成 · 所有指定消息已发送');
    task = makeTask('queue', A.snapshot(), data.items[0].text);
    gate.reset(); render(); show('等待新一轮回答完成');
  }
  async function tick() {
    if (ticking || mutating || loading) return;
    ticking = true;
    try {
      if (location.pathname !== route) {
        const carriedTokens = /\/c\/[^/]+\/?$/.test(route) ? [] : [...data.tokens];
        await stop('对话已切换'); await persistChain.catch(() => {}); route = location.pathname; await load(carriedTokens); return;
      }
      refreshOverview();
      if (!mode) return;
      const lease = await chrome.runtime.sendMessage({ type: 'lease', route });
      if (!lease?.ok) return stop('另一个标签页持有发送锁，已暂停');
      const now = performance.now();
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
  function openPanel(open) { $('panel').hidden = !open; $('launcher').setAttribute('aria-expanded', String(open)); if (!open) $('launcher').focus(); }
  $('launcher').onclick = () => openPanel($('panel').hidden);
  $('close').onclick = () => openPanel(false);
  ui.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('panel').hidden) { event.preventDefault(); openPanel(false); } });
  $('search').oninput = () => renderQueue();
  $('new-task').oninput = () => setText('char-count', $('new-task').value.length.toLocaleString());
  $('new-task').onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('add').click(); } };
  $('prepare').onclick = () => safely(async () => {
    const token = newToken();
    if (data.tokens.length >= 100) throw new Error('结束约定已达到 100 条，请清理或更换对话');
    data.tokens.push(token); await persist();
    await navigator.clipboard.writeText(contract(token));
    show('结束约定已复制 · 请粘贴在本轮任务末尾一并发送');
  });
  $('send-now').onclick = () => safely(sendImmediate);
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
    await navigator.clipboard.writeText(JSON.stringify({ version: '1.3.0', editor: s.editor, recognized: s.recognized, busy: s.busy, uploading: s.uploading, error: s.error, sendable: s.sendable, completed: s.completed, online: s.online, foreground: s.foreground, nonFinal: s.nonFinal, interrupted: s.interrupted, protocolReady: !!task?.token, hasDraft: !!s.draft, hasAttachments: !!s.attachments, mode, locked: !!data.inFlight }, null, 2));
    show('已复制诊断 · 不含提示词、附件名称或对话内容');
  });
  for (const name of ['input', 'change']) document.addEventListener(name, event => {
    if (mode && !filling && event.target instanceof Element && (event.target.closest(A.SEL.editor) || event.target.closest('form, [data-type="unified-composer"]'))) { if (task) task.edited = true; gate.reset(); }
  }, true);
  document.addEventListener('visibilitychange', () => gate.reset());
  window.addEventListener('offline', () => gate.reset());
  window.addEventListener('online', () => gate.reset());
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'toggle-panel') $('launcher').click(); });
  load().then(() => setInterval(tick, 1000)).catch(error => show('无法读取本地队列：' + error.message));
})();
