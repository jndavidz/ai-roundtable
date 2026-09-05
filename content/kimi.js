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

    // Aggregate the COMPLETE reply.
    //
    // The default base extractor returns `blocks[blocks.length - 1].innerText`,
    // i.e. the LAST DOM node matching any response selector. On Kimi the answer
    // can span MULTIPLE message containers (a split/streamed reply) and its
    // descendants (markdown body, citation footers, secondary bubbles) all match
    // the broad selectors above — so "last block" lands on a partial node and
    // truncates the reply, exactly the behavior reported via 聚合.
    //
    // Fix: gather EVERY answer container on the page, strip reference/footer
    // noise from each, and join them in document order. This reassembles the full
    // reply instead of grabbing one stray trailing node.
    getLatestResponse: function () {
      const containerSelectors = [
        '[class*="markdown"]',
        '[class*="chat-content"]',
        '[class*="message"]',
        '[class*="answer"]',
        '[class*="response"]',
        '[class*="bubble"]'
      ];
      // Broad selectors also match reaction bubbles ("+1") and tiny footers that
      // are not answers; require a real answer length for those only.
      const broadSelectors = new Set(['[class*="response"]', '[class*="bubble"]']);
      const MIN_BROAD_LEN = 20;

      const seen = new Set();
      const parts = [];

      for (const sel of containerSelectors) {
        const nodes = Array.from(document.querySelectorAll(sel));
        for (const node of nodes) {
          // De-dupe: a markdown body inside a [class*="message"] would otherwise
          // be captured twice.
          if (seen.has(node)) continue;
          seen.add(node);

          const text = extractAnswerText(node).trim();
          if (!text) continue;
          if (broadSelectors.has(sel) && text.length < MIN_BROAD_LEN) continue;
          parts.push(text);
        }
      }

      if (parts.length === 0) return null;
      return parts.join('\n\n').trim();
    }
  });

  // Pull clean answer text from one container: drop reference/footer noise
  // (citation sidebars whose anchors leak domain names like tencent.com /
  // aliyun.com) then read innerText.
  function extractAnswerText(element) {
    if (!element) return '';
    const clone = element.cloneNode(true);
    const noiseSelectors = [
      '[class*="reference"]',
      '[class*="citation"]',
      '[class*="quote"]',
      '[class*="source"]',
      '[class*="footnote"]',
      '[class*="refer"]',
      '[class*="引用"]',
      '[class*="溯源"]'
    ];
    for (const selector of noiseSelectors) {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    }
    return clone.innerText || '';
  }
})();
