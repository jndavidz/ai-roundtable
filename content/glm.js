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
      // Aggregate the COMPLETE reply for GLM / chatglm.cn / z.ai.
      //
      // Two real-world traps on these sites (both reported via 聚合):
      //   1. The answer is rendered across MULTIPLE message containers, so taking
      //      only the "last" one truncates the reply.
      //   2. A separate "引用 / references" sidebar (and inline citation anchors
      //      like tencent.com / aliyun.com) leaks into a container's innerText.
      //
      // Fix: collect EVERY answer container on the page, strip thinking blocks
      // and reference/footer noise from each, and join them in document order.
      // This yields the full reply instead of one stray trailing node.

      // Answer containers, in priority order. Broad selectors ([class*="response"])
      // are listed last so a specific message/markdown container wins when both
      // exist, but we still gather ALL matches (not just the last) to reassemble
      // a split reply.
      const containerSelectors = [
        '.markdown-body',
        '[class*="chat-content"]',
        '[class*="message"]',
        '.chat-top-section',
        '.glms-operation-content',
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
          // De-dupe: a .markdown-body inside a [class*="message"] would otherwise
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

  // Pull the clean answer text out of a single container: drop thinking blocks,
  // reference/footer noise and injected <style>/<script> (e.g. mermaid chart
  // CSS), then read innerText.
  function extractAnswerText(element) {
    if (!element) return '';
    const clone = element.cloneNode(true);

    // 1) Always drop raw style/script so injected CSS blobs (mermaid diagrams,
    //    #mmd-... rules) never leak into the captured text.
    clone.querySelectorAll('style, script').forEach(el => el.remove());

    // 2) Reasoning / thinking blocks (GLM's "已深度思考" collapsible sections).
    //    These hold the leaked citation domains (tencent.com / aliyun.com …),
    //    so stripping them removes the domain noise entirely.
    //    NOTE: we deliberately do NOT strip generic "citation"/"source" nodes —
    //    those also wrap the ANSWER's own inline citations (github.com …) and
    //    its "来源" section, which the user wants kept.
    const noiseSelectors = [
      '[class*="think"]',
      '[class*="thought"]',
      '[class*="reasoning"]',
      '[class*="thinking"]',
      '[class*="analysis"]',
      '[class*="chain"]',
      '[class*="cot"]',
      '[class*="overflow-hidden"][class*="max-h"]',
      '[data-type*="think"]',
      '[data-type*="reason"]'
    ];
    for (const selector of noiseSelectors) {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    }

    // 3) Collapsible thinking wrappers whose class isn't caught above but whose
    //    header text is the Chinese "thinking" label.
    clone.querySelectorAll('*').forEach(el => {
      const headerText = (el.innerText || '').trim();
      if (headerText === '思考' || headerText === '已深度思考' || headerText === '深度思考') {
        el.remove();
      }
    });

    return clone.innerText || '';
  }
})();
