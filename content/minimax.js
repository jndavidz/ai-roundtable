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
    ]

    // getLatestResponse omitted — base.js derives it from responseSelectors.
  });
})();
