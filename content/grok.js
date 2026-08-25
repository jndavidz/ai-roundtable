// AI Panel - Grok (xAI) Content Script
// URL: https://grok.com/
// Input: div[role="textbox"][contenteditable="true"][aria-label="Ask Grok anything"]
// Send: button[type="submit"][data-testid="chat-submit"][aria-label="提交"]

(function() {
  'use strict';

  const AI_TYPE = 'grok';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  window.AIPanelBase.createController({
    aiType: AI_TYPE,
    name: 'Grok',

    inputSelectors: [
      'div[role="textbox"][contenteditable="true"][aria-label="Ask Grok anything"]',
      'div[role="textbox"][contenteditable="true"][aria-label*="Grok"]',
      'div[role="textbox"][contenteditable="true"][aria-label*="grok"]',
      'div[contenteditable="true"][aria-label*="Ask"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea[aria-label*="Grok"]',
      'textarea[aria-label*="grok"]',
      'textarea'
    ],

    submitOptions: {
      selectors: [
        'button[type="submit"][data-testid="chat-submit"]',
        'button[data-testid="chat-submit"]',
        'button[type="submit"][aria-label="提交"]',
        'button[type="submit"]',
        'button[aria-label*="Submit"]',
        'button[aria-label*="提交"]'
      ],
      positivePattern: /(submit|send|提交|发送)/i,
      allowUnlabeledNearInput: true,
      enterFallback: true,
      maxWait: 6000,
      verifyMaxWait: 3000,
      submittingSelectors: [
        '[aria-label*="Stop"]',
        '[aria-label*="停止"]',
        'button[aria-label*="stop"]',
        '[class*="stop-generating"]'
      ]
    },

    // Order matters: first match wins (kept identical to the previous
    // hand-written getLatestResponse priority).
    responseSelectors: [
      '.message-bubble',
      '.prose-chat',
      '[data-testid*="message"]',
      '[class*="markdown"]'
    ],

    streamingSelectors: [
      '[aria-label*="Stop"]',
      '[aria-label*="停止"]',
      'button[aria-label*="stop"]'
    ]

    // getLatestResponse omitted — base.js derives it from responseSelectors.
  });
})();
