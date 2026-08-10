// AI Panel - Hunyuan (Tencent Yuanbao) Content Script
// URL: https://yuanbao.tencent.com/
// Login required (WeChat / QQ / phone number)
// Input: textarea or div[contenteditable] (Tencent Design components)
// Send: button or a[aria-label*="发送"] (TDesign button system)

(function() {
  'use strict';

  const AI_TYPE = 'hunyuan';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  // Shared response selectors — used by both the observer and getLatestResponse
  const RESPONSE_SELECTORS = [
    '[class*="markdown"]',
    '[class*="chat-content"]',
    '[class*="message"] [class*="content"]',
    '[class*="answer"]',
    '[class*="response"]',
    '[class*="bubble"]',
    '.agent-chat__content'
  ];

  window.AIPanelBase.createController({
    aiType: AI_TYPE,
    name: 'Hunyuan',
    afterInputDelay: 600, // give Tencent's React editor time to register the text

    loginCheck: function() {
      if (window.location.pathname.includes('/login') ||
          document.querySelector('.hyc-login__dialog') ||
          document.querySelector('.hyc-login__close')) {
        throw new Error('Hunyuan not logged in. Please log in at yuanbao.tencent.com first.');
      }
    },

    inputSelectors: [
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="提问"]',
      'textarea[placeholder*="发消息"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea',
      '.t-textarea__inner',
      'div[role="textbox"]'
    ],

    submitOptions: {
      selectors: [
        'a[aria-label*="发送"]',
        'a[aria-label*="Send"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'div[role="button"][aria-label*="发送"]',
        'button[class*="send"]',
        'a[class*="send-btn"]',
        '.t-button--theme-primary'
      ],
      positivePattern: /(send|submit|发送|提交)/i,
      allowUnlabeledNearInput: true,
      enterFallback: true,
      maxWait: 6000,
      // Longer verify window: the send button may not change state immediately
      // after the click, which previously caused false "Submit did not start"
      // errors even though the message was actually submitted.
      verifyMaxWait: 5000,
      submittingSelectors: [
        '[aria-label*="停止"]',
        '[aria-label*="Stop"]',
        'button[aria-label*="stop"]',
        'a[aria-label*="停止"]',
        '[class*="stop-generating"]',
        '[class*="stop"]'
      ]
    },

    responseSelectors: RESPONSE_SELECTORS,

    streamingSelectors: [
      '[aria-label*="停止"]',
      '[aria-label*="Stop"]',
      'button[aria-label*="stop"]',
      'a[aria-label*="停止"]',
      '[class*="stop-generating"]'
    ],

    getLatestResponse: function() {
      for (const selector of RESPONSE_SELECTORS) {
        const blocks = document.querySelectorAll(selector);
        if (blocks.length > 0) {
          return blocks[blocks.length - 1].innerText.trim();
        }
      }
      return null;
    }
  });
})();
