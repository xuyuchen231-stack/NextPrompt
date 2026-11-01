/* One active sender per conversation across tabs. No conversation text crosses this channel. */
let chain = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['lease', 'release'].includes(message?.type)) return;
  chain = chain.then(async () => {
    const tabId = sender.tab?.id;
    if (tabId === undefined || !/^https:\/\/chatgpt\.com\//.test(sender.url || '')) return respond({ ok: false });
    if (typeof message.route !== 'string' || !message.route.startsWith('/') || message.route.length > 500) return respond({ ok: false });
    const key = `lease:${message.route}`;
    const old = (await chrome.storage.session.get(key))[key];
    if (message.type === 'release') {
      if (old?.tabId === tabId) await chrome.storage.session.remove(key);
      return respond({ ok: true });
    }
    const now = Date.now();
    if (old && old.tabId !== tabId && old.expires > now) return respond({ ok: false });
    await chrome.storage.session.set({ [key]: { tabId, expires: now + 15000 } });
    respond({ ok: true });
  }).catch(() => respond({ ok: false }));
  return true;
});
chrome.action.onClicked.addListener(tab => {
  if (tab.url?.startsWith('https://chatgpt.com/')) chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' }).catch(() => {});
});
chrome.commands.onCommand.addListener(async command => {
  if (command !== 'toggle-panel') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith('https://chatgpt.com/')) chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' }).catch(() => {});
});
