// AI Panel - GLM (Zhipu) Content Script
// Supports chatglm.cn and z.ai — uses textarea + dom-utils helpers
// Note: GLM-5.2 has thinking mode; thinking blocks are filtered from captured response

(function() {
  'use strict';

  const AI_TYPE = 'glm';
  if (!window.AIPanelBase?.boot(AI_TYPE)) return;

  window.AIPanelBase.createController({
    aiType: AI_TYPE,
    name: 'GLM',

    // GLM (chatglm.cn / z.ai) DOM structure (verified 2026-07-30):
    //   #search-input-box > .input-wrap > .input-box-inner > textarea.scroll-display-none
    //   Send button: .input-box-container > .options-container > div.enter.is-main-chat
    //   Placeholder is a sibling .custom-placeholder div (not on textarea itself)
    inputSelectors: [
      '#search-input-box textarea',
      '.input-box-inner textarea',
      '.input-wrap textarea',
      '.input-box textarea',
      'textarea.scroll-display-none',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="提问"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ],

    submitOptions: {
      selectors: [
        'div.enter',
        'div.enter.is-main-chat',
        '#search-input-box .enter',
        '.input-box-container .enter',
        '.enter-icon-container',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'div[role="button"][aria-label*="发送"]',
        'button[type="submit"]',
        'div[role="button"]'
      ],
      positivePattern: /(send|submit|发送|提交|enter)/i,
      allowUnlabeledNearInput: true,
      enterFallback: true,
      maxWait: 6000,
      verifyMaxWait: 3000,
      // GLM streaming indicators (verified against chatglm.cn 2026-07-30):
      //   div.enter gains "searching" class while generating (most reliable)
      //   .enter-icon-container loses "empty" class while generating
      submittingSelectors: [
        'div.enter.searching',
        '.enter-icon-container:not(.empty)',
        'div[aria-label*="停止"]',
        'div[role="button"][aria-label*="Stop"]',
        '[class*="stop-generating"]'
      ]
    },

    responseSelectors: [
      '.markdown-body',
      '[class*="message"] [class*="content"]',
      '[class*="answer"]',
      '[class*="response"]',
      '[class*="bubble"]',
      '.chat-top-section',
      '.glms-operation-content',
      '[class*="chat-content"]'
    ],

    // GLM streaming detection (verified against chatglm.cn 2026-07-30):
    //   div.enter.searching — send button gains "searching" class while generating
    //   This is the ONLY reliable indicator; [class*="loading"] is too broad
    //   (matches lazy-load images, skeleton screens, etc.) and causes false positives
    streamingSelectors: [
      'div.enter.searching'
    ],

    getLatestResponse: function() {
      // Try multiple selectors for GLM's response containers
      // GLM uses various containers for markdown-rendered responses
      const selectors = [
        '.markdown-body',
        '[class*="chat-content"]',
        '[class*="answer"] [class*="content"]',
        '[class*="response"] [class*="content"]',
        '[class*="bubble"] [class*="content"]',
        '[class*="message"] [class*="content"]',
        '.detail-container [class*="content"]'
      ];

      let blocks = [];
      for (const selector of selectors) {
        blocks = document.querySelectorAll(selector);
        if (blocks.length > 0) break;
      }

      if (blocks.length === 0) return null;

      const lastBlock = blocks[blocks.length - 1];

      // Filter out thinking blocks (GLM-5.2 thinking mode)
      // Thinking blocks are typically in collapsible containers with specific classes
      return filterThinkingContent(lastBlock).trim();
    }
  });

  // Filter out GLM thinking/reasoning blocks from the response
  function filterThinkingContent(element) {
    // Clone to avoid modifying the DOM
    const clone = element.cloneNode(true);

    // Remove thinking blocks — they are usually in containers with:
    // - class containing "think" or "thought" or "reasoning"
    // - containers with overflow-hidden and max-height constraints (collapsed thinking)
    const thinkingSelectors = [
      '[class*="think"]',
      '[class*="thought"]',
      '[class*="reasoning"]',
      '[class*="overflow-hidden"][class*="max-h"]',
      '[data-type="thinking"]',
      '[data-type="reasoning"]'
    ];

    for (const selector of thinkingSelectors) {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    }

    return clone.innerText;
  }
})();
