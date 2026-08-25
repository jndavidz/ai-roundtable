// AI Panel - Tongyi Qianwen (Alibaba) Content Script
// URL: https://www.qianwen.com/ (also tongyi.aliyun.com as legacy entry)
// Input: div[role="textbox"][contenteditable="true"]
// Send: button[aria-label="发送消息"]

(function() {
  'use strict';

  const AI_TYPE = 'qianwen';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  window.AIPanelBase.createController({
    aiType: AI_TYPE,
    name: 'Qianwen',

    inputSelectors: [
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="千问"]',
      'textarea[placeholder*="提问"]',
      'textarea'
    ],

    submitOptions: {
      selectors: [
        'button[aria-label="发送消息"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]'
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
        '[class*="stop-generating"]'
      ]
    },

    responseSelectors: [
      '[class*="markdown"]',
      '[class*="message"] [class*="content"]',
      '[class*="bubble"]',
      '[class*="answer"]'
    ],

    streamingSelectors: [
      '[aria-label*="停止"]',
      '[aria-label*="Stop"]',
      '[class*="stop-generating"]'
    ]

    // getLatestResponse omitted — base.js derives it from responseSelectors.
  });
})();
