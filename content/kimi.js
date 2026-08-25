// AI Panel - Kimi (Moonshot AI) Content Script
// URL: https://www.kimi.com/
// Input: div.chat-input-editor (contenteditable)
// Send: .send-button-container

(function() {
  'use strict';

  const AI_TYPE = 'kimi';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  window.AIPanelBase.createController({
    aiType: AI_TYPE,
    name: 'Kimi',

    inputSelectors: [
      '.chat-input-editor',
      'div[role="textbox"].chat-input-editor',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="输入"]',
      'textarea'
    ],

    submitOptions: {
      selectors: [
        '.send-button-container',
        '.send-button-container:not(.disabled)',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'div[role="button"][aria-label*="发送"]'
      ],
      positivePattern: /(send|submit|发送|提交)/i,
      allowUnlabeledNearInput: true,
      enterFallback: true,
      maxWait: 6000,
      verifyMaxWait: 3000,
      submittingSelectors: [
        '.send-button-container[data-loading]',
        '.send-button-container.loading',
        '[aria-label*="停止"]',
        '[aria-label*="Stop"]',
        '[class*="stop-generating"]'
      ]
    },

    responseSelectors: [
      '[class*="markdown"]',
      '[class*="chat-content"]',
      '[class*="message"] [class*="content"]',
      '[class*="answer"]',
      '[class*="response"]'
    ],

    streamingSelectors: [
      '[aria-label*="停止"]',
      '[aria-label*="Stop"]',
      '[class*="stop-generating"]'
    ]

    // getLatestResponse omitted — base.js derives it from responseSelectors.
  });
})();
