// AI Panel - MiMo (Xiaomi) Content Script
// URL: https://aistudio.xiaomimimo.com/
// Input: div[contenteditable="true"] (rich text editor with Tailwind classes)
// Send: button.rounded-full[class*="bg-black"] (circular send button)

(function() {
  'use strict';

  const AI_TYPE = 'mimo';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  window.AIPanelBase.createController({
    aiType: AI_TYPE,
    name: 'MiMo',

    inputSelectors: [
      'div[contenteditable="true"][class*="resize-none"]',
      'div[contenteditable="true"][class*="overflow-y-auto"]',
      'div[contenteditable="true"][class*="placeholder-gray-400"]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="聊天"]',
      'textarea[placeholder*="输入"]',
      'textarea'
    ],

    submitOptions: {
      selectors: [
        'button.rounded-full[class*="bg-black"]',
        'button.rounded-full[class*="bg-white"]',
        'button[class*="rounded-full"][class*="bg-black/90"]',
        'button[class*="rounded-full"]',
        'button[type="submit"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]'
      ],
      positivePattern: /(send|submit|发送|提交)/i,
      allowUnlabeledNearInput: true,
      enterFallback: true,
      maxWait: 6000,
      verifyMaxWait: 3000,
      submittingSelectors: [
        'button[aria-label*="停止"]',
        'button[aria-label*="Stop"]',
        '[class*="stop-generating"]',
        '[class*="stop"]'
      ]
    },

    responseSelectors: [
      '[class*="markdown"]',
      '[class*="message"] [class*="content"]',
      '[class*="answer"]',
      '[class*="response"]',
      '[class*="bubble"]'
    ],

    streamingSelectors: [
      'button[aria-label*="停止"]',
      'button[aria-label*="Stop"]',
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
        .replace(/^\s*已深度思考[^\n]*$/gm, '') // mimo 思考标记残留(含「(用时 7.3 秒)」注解)
        .replace(/```\s*\n+```/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return md || null;
    }

  });
})();
