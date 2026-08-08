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

    responseSelectors: [
      '.ds-markdown',
      '.ds-markdown--block',
      '.markdown-body',
      '[class*="message"] [class*="content"]',
      '[class*="answer"]',
      '[class*="response"]'
    ],

    // DeepSeek streaming detection: stop button or loading indicators
    streamingSelectors: [
      'div[aria-label*="停止"]',
      'div[role="button"][aria-label*="Stop"]',
      'div[role="button"][aria-label*="stop"]',
      '.stop-button',
      '[class*="stop-generating"]'
    ],

    getLatestResponse: function() {
      // Try multiple selectors for DeepSeek's response containers
      const selectors = [
        '.ds-markdown--block',
        '.ds-markdown',
        '.markdown-body',
        '[class*="message"] [class*="content"]',
        '[class*="answer"] [class*="content"]',
        '[class*="response"] [class*="content"]'
      ];

      let blocks = [];
      for (const selector of selectors) {
        blocks = document.querySelectorAll(selector);
        if (blocks.length > 0) break;
      }

      if (blocks.length === 0) return null;

      const lastBlock = blocks[blocks.length - 1];
      return lastBlock.innerText.trim();
    }
  });
})();
