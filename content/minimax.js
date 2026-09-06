// AI Panel - Minimax (Hailuo AI) Content Script
// URL: https://chat.minimaxi.com/ (redirects to agent.minimaxi.com)
//       https://chat.minimax.io/ (international)
// Input: div.tiptap.ProseMirror.rich-text-editor (contenteditable)
// Send: Enter key (no dedicated send button found) or button near input

(function() {
  'use strict';

  const AI_TYPE = 'minimax';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  window.AIPanelBase.createController({
    aiType: AI_TYPE,
    name: 'Minimax',

    inputSelectors: [
      'div.tiptap.ProseMirror.rich-text-editor',
      'div.ProseMirror.rich-text-editor',
      'div.tiptap[contenteditable="true"]',
      'div[contenteditable="true"][class*="rich-text"]',
      'div[contenteditable="true"][class*="tiptap"]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="发送"]',
      'textarea[placeholder*="输入"]',
      'textarea'
    ],

    submitOptions: {
      selectors: [
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="提交"]',
        'button[type="submit"]',
        'div[role="button"][aria-label*="发送"]',
        'button[class*="send"]'
      ],
      positivePattern: /(send|submit|发送|提交)/i,
      allowUnlabeledNearInput: true,
      enterFallback: true,
      maxWait: 6000,
      verifyMaxWait: 3000,
      submittingSelectors: [
        '[aria-label*="停止"]',
        '[aria-label*="Stop"]',
        'button[aria-label*="stop"]',
        '[class*="stop-generating"]',
        '[class*="loading"]'
      ]
    },

    responseSelectors: [
      '[class*="prose"]',
      '[class*="markdown"]',
      '[class*="message"] [class*="content"]',
      '[class*="answer"]',
      '[class*="response"]',
      '[class*="bubble"]'
    ],

    streamingSelectors: [
      '[aria-label*="停止"]',
      '[aria-label*="Stop"]',
      'button[aria-label*="stop"]',
      '[class*="stop-generating"]'
    ],

    // CDP 实测(2026-09): minimax 把回复拆成 16 个 markdown 分段流式渲染、
    // mimo 拆成 3 块——默认派生取最后一块只能拿到一段列表项/表格。
    // 修复: 找「包含全部 markdown 块的最近公共父容器」, 对容器整体序列化。
    getLatestResponse: function () {
      var blocks = document.querySelectorAll('[class*="markdown"]');
      if (!blocks.length) return null;
      var last = blocks[blocks.length - 1];
      var container = last;
      var total = blocks.length;
      while (container && container !== document.body) {
        var inside = container.querySelectorAll('[class*="markdown"]').length;
        if (inside >= total) break;
        container = container.parentElement;
      }
      if (!container || container === document.body) {
        // 兜底: 拼接全部块
        var parts = [];
        blocks.forEach(function (b) {
          var t = window.AIPanelDom && window.AIPanelDom.toMarkdown
            ? window.AIPanelDom.toMarkdown(b) : (b.innerText || '');
          if (t && t.trim()) parts.push(t.trim());
        });
        return parts.join('\n\n') || null;
      }
      var clone = container.cloneNode(true);
      clone.querySelectorAll('style, script').forEach(function (el) { el.remove(); });
      var md = window.AIPanelDom && window.AIPanelDom.toMarkdown
        ? window.AIPanelDom.toMarkdown(clone)
        : (clone.innerText || '');
      md = md
        .replace(/^\s*\w*\s*(表格|复制|下载|代码预览|代码|预览)\s*$/gmi, '')
        .replace(/```\s*\n+```/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return md || null;
    }

  });
})();
