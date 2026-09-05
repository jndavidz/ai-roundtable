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
    ],

    // Aggregate the COMPLETE last reply.
    //
    // The default base extractor returns `blocks[blocks.length - 1].innerText`,
    // i.e. the LAST DOM node matching any response selector. On Kimi the answer
    // spans a single message container whose descendants (markdown body, the
    // citation/reference footer, secondary bubbles) each match the broad
    // selectors above, so "last block" can land on a partial/secondary node and
    // truncate the reply — exactly the behavior reported when using 聚合.
    //
    // Fix: locate the real last message/answer container, then concatenate EVERY
    // content block inside it in document order. This yields the full multi-
    // section reply instead of a stray trailing node.
    getLatestResponse: function () {
      const containerCandidates = [
        '[class*="message"]',
        '[class*="chat-content"]',
        '[class*="answer"]',
        '[class*="response"]'
      ];

      // Prefer the LAST container of the MOST-specific selector that matched
      // (not the global last node). Broad selectors like [class*="response"]
      // can match stray trailing bubbles, footers or citation wrappers, so a
      // message/chat-content container must win when both exist.
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

      // Collect all content blocks within the container, in document order.
      const contentSelectors = [
        '[class*="markdown"]',
        '[class*="content"]',
        '[class*="bubble"]',
        '[class*="answer"]',
        '[class*="response"]'
      ];
      const blocks = container.querySelectorAll(contentSelectors.join(','));
      const parts = [];
      if (blocks.length > 0) {
        blocks.forEach(b => {
          const t = (b.innerText || '').trim();
          if (t && !parts.includes(t)) parts.push(t);
        });
      }
      if (parts.length > 0) return parts.join('\n\n').trim();

      // Fallback: whole container text (still the full reply, not a stray child).
      return (container.innerText || '').trim();
    }
  });
})();
