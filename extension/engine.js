/* NextPrompt — MIT. Fail-closed completion protocol and decision engine. */
(function (root) {
  'use strict';
  const normalize = value => String(value || '').replace(/\r\n/g, '\n').trim();
  const validToken = token => typeof token === 'string' && /^NEXT_PROMPT_DONE_[a-f0-9]{32}$/.test(token);
  function finalMarker(text, token) {
    if (!validToken(token)) return false;
    const lines = normalize(text).split('\n');
    if (lines.at(-1) !== token) return false;
    let fence = null;
    for (const line of lines.slice(0, -1)) {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (!match) continue;
      if (!fence) fence = { char: match[1][0], length: match[1].length };
      else if (match[1][0] === fence.char && match[1].length >= fence.length && !match[2].trim()) fence = null;
    }
    return !fence;
  }
  function contract(token) {
    if (!validToken(token)) throw new Error('无效的结束口令');
    return `【NextPrompt 本轮结束约定】\n请仅在本轮任务的全部工作、工具调用和验证均已结束，且无需等待我补充或确认时，在最终交付回复的最后独占一行输出下面的口令。进度说明、思考、工具执行、引用和代码块中都不要输出；任务失败、被中断或需要我决定时也不要输出。不要仅为触发自动发送而声称工作完成。\n${token}`;
  }
  function protocolInPrompt(text, token) {
    return validToken(token) && normalize(text).endsWith(contract(token));
  }
  // Manual immediate submission intentionally does NOT depend on busy/final/token.
  // The native page decides whether the submitted message steers or queues.
  function immediateEligibility(s, active = null) {
    const block = reason => ({ ready:false, reason });
    if (!s.editor || !s.recognized) return block('请先打开已有消息且输入框唯一的 ChatGPT 对话');
    if (s.online !== true || s.foreground !== true) return block('请保持当前页面可见并联网');
    if (s.error) return block('请先处理页面上的错误或确认提示');
    if (s.uploading || s.attachmentUnknown) return block('请等待附件上传完成并确认预览');
    if (!s.draft) return block('请先在 ChatGPT 原生输入框写好消息');
    if (!s.sendable) return block('原生发送按钮尚不可用；不会点击停止按钮');
    if (active && (active.edited || s.route !== active.route || s.users !== active.users || s.userText !== active.userText || s.draft !== active.text || s.attachments !== active.attachments)) return block('提交前对话、草稿或附件发生变化，已取消提交');
    return { ready:true, reason:'原生输入已就绪' };
  }
  class Gate {
    constructor({ cooldown = 12000 } = {}) { this.cooldown = cooldown; this.reset(); }
    reset() { this.readyAt = null; this.signature = null; this.lastSample = null; this.samples = 0; }
    eligible(s, task, { prepared = false } = {}) {
      if (!task) return { action: 'wait', reason: '尚未启用任务' };
      const pause = reason => ({ action: 'pause', reason });
      const wait = reason => ({ action: 'wait', reason });
      if (s.route !== task.route) return pause('对话已切换，请重新启用');
      if (s.users !== task.users || s.userText !== task.userText) return pause('本轮用户消息变化，请重新检查任务');
      if (task.edited) return pause('启用后输入框发生编辑，请重新启用');
      if (s.error) return pause('页面出现错误或确认提示，请手动处理');
      if (s.online !== true) return wait('网络不可用，等待恢复');
      if (s.foreground !== true) return wait('页面不在前台，恢复可见后重新检查');
      if (!s.editor || !s.recognized) return wait('尚未识别兼容且唯一的输入框');
      if (s.busy) return wait('当前任务仍在执行');
      if (s.uploading) return wait('等待附件上传完成');
      if (s.attachmentUnknown) return wait('附件或输入框结构不明确，停止自动判断');
      if (s.interrupted) return pause('任务被手动停止，请检查后重新开始');
      if (!protocolInPrompt(s.userText, task.token)) return wait('本轮没有匹配的结束约定，不会按按钮猜测完成');
      if (s.markerSafe !== true) return wait('结束口令位于代码、引用或未知结构中，不予采用');
      if (s.nonFinal) return wait('当前消息标记为进度或分析，不是最终交付');
      if (!s.completed || !finalMarker(s.finalText, task.token)) return wait('等待本轮唯一结束口令出现在最终回复末尾');
      if (task.kind === 'draft' || prepared) {
        if (s.draft !== task.text) return pause('草稿已修改，请重新启用');
        if (s.attachments !== task.attachments) return pause('附件列表已变化，请重新启用');
        if (!s.sendable) return wait('等待发送按钮可用');
      } else if (s.draft || s.attachments) return wait('请先处理原生输入框里的草稿或附件');
      return { action: 'ready', reason: '本轮结束口令匹配，正在检查状态' };
    }
    decide(s, task, now = performance.now()) {
      const eligibility = this.eligible(s, task);
      if (eligibility.action !== 'ready') { this.reset(); return eligibility; }
      const signature = JSON.stringify([s.finalText, s.finalId, s.userText, s.users, s.attachments, s.draft]);
      // Sparse observations after suspension do not count as continuous stability.
      if (this.signature !== signature || this.lastSample === null || now - this.lastSample > 5000 || now < this.lastSample) {
        this.readyAt = now; this.signature = signature; this.samples = 0;
      }
      if (this.lastSample !== now) this.samples++;
      this.lastSample = now;
      const remaining = Math.max(0, this.cooldown - (now - this.readyAt));
      if (remaining || this.samples < 3) return { action: 'wait', reason: `口令已匹配 · 连续确认 ${Math.ceil(remaining / 1000)} 秒`, remaining };
      return { action: 'send', reason: '本轮口令、回复身份与连续页面状态均已确认' };
    }
    recheck(s, task, now = performance.now(), { prepared = true } = {}) {
      if (this.eligible(s, task, { prepared }).action !== 'ready') return false;
      return this.samples >= 3 && this.readyAt !== null && this.lastSample !== null && now >= this.lastSample && now - this.lastSample <= 5000 && now - this.readyAt >= this.cooldown && this.signature === JSON.stringify([s.finalText, s.finalId, s.userText, s.users, s.attachments, task.kind === 'queue' ? '' : s.draft]);
    }
  }
  const api = { Gate, normalize, validToken, finalMarker, contract, protocolInPrompt, immediateEligibility };
  if (typeof module !== 'undefined') module.exports = api;
  root.NextPromptEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
