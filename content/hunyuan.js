// AI Panel - Hunyuan (Tencent Yuanbao) Content Script
// URL: https://yuanbao.tencent.com/
// Login required (WeChat / QQ / phone number)
// Input: textarea or div[contenteditable] (Tencent Design components)
// Send: button or a[aria-label*="发送"] (TDesign button system)

(function() {
  'use strict';

  const AI_TYPE = 'hunyuan';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  // Shared response selectors — used by both the observer and getLatestResponse.
  // 2026-09 改版: 回复正文在 [class*="hyc-content-md"](完成后带 -done 后缀),
  // 用户消息在 agent-chat__bubble__content。[class*="markdown"] 现在会命中
  // 200+ 个行内代码组件(hyc-common-markdown__code__inline), 排在前面会让
  // 默认派生取到 10 字符的行内片段 —— 聚合「收集很少」的根因, 故移到最后。
  const RESPONSE_SELECTORS = [
    '[class*="hyc-content-md"]',
    '[class*="bubble__content"]',
    '[class*="chat-content"]',
    '[class*="message"] [class*="content"]',
    '[class*="answer"]',
    '[class*="response"]',
    '[class*="bubble"]',
    '.agent-chat__content',
    '[class*="markdown"]'
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

    // CDP 实测(2026-09 改版): 自取最后一个 hyc-content-md(回复正文容器,
    // 完成时带 -done); 回退到气泡内容时跳过与输入框文本相同的用户消息。
    getLatestResponse: function () {
      var nodes = document.querySelectorAll('[class*="hyc-content-md"]');
      var node = nodes.length ? nodes[nodes.length - 1] : null;
      if (!node) {
        var editor = document.querySelector('textarea, [contenteditable="true"]');
        var editorText = editor ? ((editor.value !== undefined ? editor.value : editor.innerText) || '').trim() : '';
        var bubbles = document.querySelectorAll('[class*="bubble__content"]');
        for (var i = bubbles.length - 1; i >= 0; i--) {
          var t = (bubbles[i].innerText || '').trim();
          if (t && t !== editorText) { node = bubbles[i]; break; }
        }
      }
      if (!node) return null;
      var clone = node.cloneNode(true);
      clone.querySelectorAll('style, script').forEach(function (el) { el.remove(); });
      var md = window.AIPanelDom && window.AIPanelDom.toMarkdown
        ? window.AIPanelDom.toMarkdown(clone)
        : (clone.innerText || '');
      md = md
        .replace(/^\s*\w*\s*(表格|复制|下载|代码预览|代码|预览)\s*$/gmi, '')
        .replace(/^\s*已深度思考[^\n]*$/gm, '')
        .replace(/```\s*\n+```/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return md || null;
    }
  });
})();
