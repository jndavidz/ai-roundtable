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
      // Aggregate the COMPLETE last reply for GLM / chatglm.cn / z.ai.
      //
      // The previous implementation returned `blocks[blocks.length - 1].innerText`
      // from a broad selector list. On GLM the real answer lives inside a single
      // message container, while citation/reference links, footnotes and
      // secondary bubbles also match those broad selectors — so "last block"
      // frequently landed on a partial/secondary node, truncating or garbling
      // the reply reported by 聚合.
      //
      // Fix: scope to the LAST non-empty message/answer container, then join
      // every content block inside it in document order. Citations that sit
      // OUTSIDE the answer wrapper are no longer pulled in; thinking blocks are
      // still stripped.
      const containerCandidates = [
        '[class*="message"]',
        '[class*="chat-content"]',
        '.markdown-body',
        '.chat-top-section',
        '[class*="answer"]',
        '[class*="response"]'
      ];

      // Prefer the LAST container of the MOST-specific selector that matched
      // (not the global last node), so a stray trailing bubble/footer/citation
      // wrapper matching the broad [class*="response"] selector can't override
      // the real answer container.
      let container = null;
      for (const sel of containerCandidates) {
        const matches = Array.from(document.querySelectorAll(sel))
          .filter(el => (el.innerText || '').trim().length > 0);
        if (matches.length > 0) {
          container = matches[matches.length - 1];
          break;
        }
      }
      if (!container) return null;

      const contentSelectors = [
        '.markdown-body',
        '[class*="content"]',
        '[class*="bubble"]',
        '[class*="answer"]',
        '[class*="response"]'
      ];
      const blocks = container.querySelectorAll(contentSelectors.join(','));
      const parts = [];
      if (blocks.length > 0) {
        blocks.forEach(b => {
          const t = filterThinkingContent(b).trim();
          if (t && !parts.includes(t)) parts.push(t);
        });
      }
      if (parts.length > 0) return parts.join('\n\n').trim();

      return filterThinkingContent(container).trim();
    }
  });

  // Filter out GLM thinking/reasoning blocks from a response fragment
  function filterThinkingContent(element) {
    if (!element) return '';
    // Clone to avoid modifying the live DOM
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

    return clone.innerText || '';
  }
})();
