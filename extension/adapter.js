/* All ChatGPT-specific DOM assumptions live here. Unknown UI stays blocked. */
(function (root) {
  'use strict';
  const { normalize } = root.NextPromptEngine;
  const visible = e => !!e && !!(e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden';
  const first = (scope, selectors) => [...scope.querySelectorAll(selectors)].find(visible);
  const SEL = {
    editor: '#prompt-textarea[contenteditable="true"], textarea#prompt-textarea',
    send: 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="发送提示"]',
    stop: 'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="停止生成"], button[aria-label="停止流式传输"]',
    final: 'button[data-testid="copy-turn-action-button"], button[data-testid="good-response-turn-action-button"], button[aria-label="Copy response"], button[aria-label="复制回复"]',
    attachment: '[data-testid="attachment"], [data-testid="file-preview"], [data-testid="attachment-preview"], button[aria-label*="Remove file"], button[aria-label*="移除文件"], button[aria-label*="Remove image"], button[aria-label*="移除图片"]'
  };
  const editors = () => [...document.querySelectorAll(SEL.editor)].filter(visible);
  function editor() { return editors().length === 1 ? editors()[0] : null; }
  function composer() { const e = editor(); return e?.closest('form') || e?.closest('[data-type="unified-composer"]'); }
  function draft() { const e = editor(); return normalize(e?.value ?? e?.innerText); }
  function attachmentSignature(scope) {
    if (!scope) return '';
    return [...scope.querySelectorAll(SEL.attachment)].filter(visible).map(e =>
      [e.getAttribute('data-testid'), e.getAttribute('aria-label'), e.textContent, e.querySelector('img')?.getAttribute('src')].join(':')
    ).sort().join('|');
  }
  function snapshot() {
    const e = editor(), scope = composer();
    const assistants = [...document.querySelectorAll('[data-message-author-role="assistant"]')].filter(visible);
    const last = assistants.at(-1);
    const lastUser = [...document.querySelectorAll('[data-message-author-role="user"]')].at(-1);
    const followsUser = !!last && !!lastUser && !!(lastUser.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING);
    // Final actions may be siblings of the message body, but must belong to the LAST assistant turn.
    const turn = last?.closest('[data-testid^="conversation-turn-"], article') || last;
    const send = first(scope || document, SEL.send);
    const channel = last?.getAttribute('data-message-channel') || last?.getAttribute('data-channel') || turn?.getAttribute('data-message-channel');
    const error = [...document.querySelectorAll('[role="alert"], [role="alertdialog"]')].some(x => visible(x) && normalize(x.textContent));
    return {
      route: location.pathname,
      online: navigator.onLine,
      foreground: document.visibilityState === 'visible',
      interrupted: interruptedUser !== null && normalize(lastUser?.innerText) === interruptedUser,
      markerSafe: !!last && !!normalize(last.innerText) && ![...last.querySelectorAll('pre, code, blockquote')].some(node => normalize(node.innerText).split('\n').at(-1) === normalize(last.innerText).split('\n').at(-1)),
      nonFinal: !!channel && channel !== 'final',
      finalId: last?.getAttribute('data-message-id') || turn?.getAttribute('data-testid') || '',
      userText: normalize(lastUser?.innerText),
      editor: !!e,
      recognized: /\/c\/[^/]+\/?$/.test(location.pathname) && !!scope && !!document.querySelector('[data-message-author-role]'),
      draft: draft(),
      attachments: attachmentSignature(scope),
      busy: !!first(document, SEL.stop) || !!first(document, '[data-is-streaming="true"], [data-testid="thinking-indicator"], main [aria-busy="true"], main [role="progressbar"]'),
      attachmentUnknown: !scope || (!!first(scope, 'input[type="file"]')?.files?.length && !attachmentSignature(scope)),
      uploading: !!scope && !!first(scope, '[role="progressbar"], [aria-busy="true"], [data-state="uploading"]'),
      error,
      sendable: !!send && !send.disabled && send.getAttribute('aria-disabled') !== 'true',
      completed: followsUser && !!turn && !!first(turn, SEL.final) && !(last?.closest('pre, code, blockquote')),
      finalText: normalize(last?.innerText),
      users: document.querySelectorAll('[data-message-author-role="user"]').length
    };
  }
  async function fill(text) {
    const e = editor();
    if (!e) throw new Error('找不到输入框');
    if (draft()) throw new Error('输入框已有草稿，不会覆盖');
    e.focus();
    if (e.tagName === 'TEXTAREA') {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(e, text);
      e.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const selection = getSelection(), range = document.createRange();
      range.selectNodeContents(e); selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('insertText', false, text)) throw new Error('浏览器未接受文本插入，请手动发送');
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    if (draft() !== normalize(text)) throw new Error('草稿校验失败，已停止自动发送');
  }
  function send() {
    const button = first(composer() || document, SEL.send);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') throw new Error('发送按钮不可用');
    button.click();
  }
  let interruptedUser = null;
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest(SEL.stop)) interruptedUser = normalize([...document.querySelectorAll('[data-message-author-role="user"]')].at(-1)?.innerText);
  }, true);
  root.NextPromptAdapter = { snapshot, fill, send, draft, SEL };
})(globalThis);
