// AI Panel - Doubao (ByteDance) Content Script
// URL: https://www.doubao.com/
// Input: textarea.semi-input-textarea (placeholder: "发消息...")
// Send: button[class*="rounded-dbx"] (circular button near input, no aria-label)
// Response: [data-testid*="message"] or [class*="markdown"] containers

(function() {
  'use strict';

  const AI_TYPE = 'doubao';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  // Shared response selectors — used by both the observer and getLatestResponse
  const RESPONSE_SELECTORS = [
    '[data-testid*="message"]',
    '[data-testid*="receive"]',
    '[data-testid*="answer"]',
    '[class*="markdown"]',
    '[class*="message"] [class*="content"]',
    '[class*="answer"]',
    '[class*="response"]',
    '[class*="bubble"]'
  ];

  window.AIPanelBase.createController({
    aiType: AI_TYPE,
    name: 'Doubao',

    inputSelectors: [
      'textarea.semi-input-textarea',
      'textarea.semi-input-textarea-autosize',
      'textarea[placeholder*="发消息"]',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="提问"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea'
    ],

    submitOptions: {
      selectors: [
        'button[class*="rounded-dbx"]',
        'button[class*="size-36"]',
        'button[class*="!rounded-full"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'div[role="button"][aria-label*="发送"]'
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
        '[class*="stop"]'
      ]
    },

    responseSelectors: RESPONSE_SELECTORS,

    // Doubao's response area is not guaranteed to sit inside a <main>; the
    // original script observed the whole body for reliable detection.
    observerRoot: () => document.body,

    streamingSelectors: [
      '[aria-label*="停止"]',
      '[aria-label*="Stop"]',
      'button[aria-label*="stop"]',
      '[class*="stop-generating"]'
    ],

    // CDP 实测(2026-09): 新版豆包是 CSS modules hash class, 旧选择器全部失效。
    // 结构: 用户消息 container-xxx md-box-root gh-user;
    //       助手回复 container-xxx md-box-root(不带 gh-user)。
    // 用 :not(gh-user) 区分, 取最后一条助手消息整体序列化。
    getLatestResponse: function () {
      var boxes = document.querySelectorAll('[class*="md-box-root"]:not([class*="gh-user"])');
      if (!boxes.length) return null;
      var last = boxes[boxes.length - 1];
      var clone = last.cloneNode(true);
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
