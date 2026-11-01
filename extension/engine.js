/* NextPrompt — MIT. Pure decision engine, shared by the extension and tests. */
(function (root) {
  'use strict';
  const normalize = value => String(value || '').replace(/\r\n/g, '\n').trim();
  class Gate {
    constructor({ cooldown = 12000 } = {}) { this.cooldown = cooldown; this.reset(); }
    reset() { this.readyAt = null; this.signature = null; }
    decide(s, task, now = Date.now()) {
      const wait = reason => { this.reset(); return { action: 'wait', reason }; };
      const pause = reason => { this.reset(); return { action: 'pause', reason }; };
      if (!task) return wait('尚未启用任务');
      if (s.route !== task.route) return pause('对话已切换，请回到原对话重新启用');
      if (s.users !== task.users) return pause('检测到其他发送操作，请重新检查任务');
      if (s.error) return pause('页面出现错误或确认提示，请手动处理');
      if (!s.editor || !s.recognized) return wait('尚未识别兼容的 ChatGPT 输入框');
      if (s.busy) return wait('当前任务仍在执行');
      if (s.uploading) return wait('等待附件上传完成');
      if (task.kind === 'draft' && s.draft !== task.text) return pause('草稿已修改，请重新启用，避免发送未完成内容');
      if (task.kind === 'draft' && s.attachments !== task.attachments) return pause('附件列表已变化，请重新启用');
      if (task.kind === 'queue' && (s.draft || s.attachments)) return wait('请先处理原生输入框里的草稿或附件');
      if (task.afterFinal !== undefined && s.finalText === task.afterFinal) return wait('等待新一轮回答，而非上一轮完成标记');
      if (!s.completed) return wait('等待最终回答的完成标记（不会把静默当作完成）');
      if (task.kind === 'draft' && !s.sendable) return wait('等待发送按钮可用');
      const signature = JSON.stringify([s.finalText, s.users, s.attachments, s.draft]);
      if (this.signature !== signature) { this.signature = signature; this.readyAt = now; }
      const remaining = Math.max(0, this.cooldown - (now - this.readyAt));
      if (remaining) return { action: 'wait', reason: `确认结束中 · ${Math.ceil(remaining / 1000)} 秒`, remaining };
      return { action: 'send', reason: '完成标记和页面状态均已稳定' };
    }
  }
  const api = { Gate, normalize };
  if (typeof module !== 'undefined') module.exports = api;
  root.NextPromptEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
