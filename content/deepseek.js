// AI Panel - DeepSeek Content Script
// Supports chat.deepseek.com — uses standard textarea + dom-utils helpers

(function() {
  'use strict';

  const AI_TYPE = 'deepseek';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  window.AIPanelBase.createController({
    aiType: AI_TYPE,
    name: 'DeepSeek',

    // DeepSeek uses a standard textarea. Try multiple selectors for resilience.
    inputSelectors: [
      'textarea#chat-input',
      'textarea[placeholder*="给"]',
      'textarea[placeholder*="消息"]',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="问"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ],

    submitOptions: {
      selectors: [
        'div[role="button"][aria-label*="发送"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'div[role="button"] .icon-send',
        'div[role="button"] svg[class*="send"]',
        'div.send-button',
        'button[type="submit"]',
        'div[role="button"]'
      ],
      positivePattern: /(send|submit|发送|提交)/i,
      allowUnlabeledNearInput: true,
      enterFallback: true,
      maxWait: 6000,
      verifyMaxWait: 3000,
      submittingSelectors: [
        'div[aria-label*="停止"]',
        'div[role="button"][aria-label*="Stop"]',
        'div[role="button"][aria-label*="stop"]',
        '[class*="stop"]',
        '[class*="loading"]'
      ]
    },

    // Order matters: first match wins (kept identical to the previous
    // hand-written getLatestResponse priority).
    responseSelectors: [
      '.ds-markdown--block',
      '.ds-markdown',
      '.markdown-body',
      '[class*="message"] [class*="content"]',
      '[class*="answer"] [class*="content"]',
      '[class*="response"] [class*="content"]'
    ],

    // DeepSeek streaming detection: stop button or loading indicators
    streamingSelectors: [
      'div[aria-label*="停止"]',
      'div[role="button"][aria-label*="Stop"]',
      'div[role="button"][aria-label*="stop"]',
      '.stop-button',
      '[class*="stop-generating"]'
    ],

    // CDP 实测(chat.deepseek.com 2026-09): 默认派生取最后 .ds-markdown 的
    // innerText, 引用角标 <a href="来源"><span class="ds-markdown-cite">-4-</span></a>
    // 被提成了独立行("- 4 - 6 - 8。")。改用 toMarkdown 序列化: 段落/标题/代码块
    // 结构保留, 角标输出为 [4](来源) 链接(与 glm/kimi 的引用=链接原则一致)。
    getLatestResponse: function () {
      const sels = [
        '.ds-markdown',
        '[class*="markdown"]',
        '[class*="message-content"]'
      ];

      let node = null;
      for (const sel of sels) {
        const nodes = Array.from(document.querySelectorAll(sel))
          .filter(el => (el.innerText || '').trim().length > 0);
        if (nodes.length > 0) { node = nodes[nodes.length - 1]; break; }
      }
      if (!node) return null;

      const clone = node.cloneNode(true);
      clone.querySelectorAll('style, script').forEach(el => el.remove());

      let md = window.AIPanelDom && window.AIPanelDom.toMarkdown
        ? window.AIPanelDom.toMarkdown(clone)
        : (clone.innerText || '');

      md = md
        .replace(/^\s*\w*\s*(表格|复制|代码预览|代码|预览)\s*$/gmi, '')
        .replace(/```\s*\n+```/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return md || null;
    }
  });
})();
