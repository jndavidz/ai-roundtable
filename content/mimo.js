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

    getLatestResponse: function() {
      const selectors = [
        '[class*="markdown"]',
        '[class*="message"] [class*="content"]',
        '[class*="answer"]',
        '[class*="response"]',
        '[class*="bubble"]'
      ];
      for (const selector of selectors) {
        const blocks = document.querySelectorAll(selector);
        if (blocks.length > 0) {
          return blocks[blocks.length - 1].innerText.trim();
        }
      }
      return null;
    }
  });
})();
