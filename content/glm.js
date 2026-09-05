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

      // CDP 实测(chatglm.cn, 2026-09): 真实结构为
      //   .answer > .answer-content-wrap.text-advance-thinking-content (思考,须剥离)
      //   .answer > .answer-content-wrap (正文, 内含多个 .markdown-body 段落)
      // 之前按「保留未被包含的最大块」会抓到 .answer(含头部「旧时光旅客/分享链接
      // 下载名片」推广块)与尾部「20个来源/以上内容为 AI 生成…NaN/」页脚(实测 7250)。
      // 修正: 优先取正文容器 .answer-content-wrap(非 thinking 的那个)，
      //       其次取所有 .markdown-body 段落拼接，两者都天然不含推广与页脚。
      const bodyContainerSelectors = [
        '.answer-content-wrap:not(.text-advance-thinking-content)',
        '[class*="answer-content-wrap"]:not([class*="thinking"])'
      ];

      for (const sel of bodyContainerSelectors) {
        const nodes = Array.from(document.querySelectorAll(sel))
          .filter(el => (el.innerText || '').trim().length > 0);
        if (nodes.length === 0) continue;
        const node = nodes[nodes.length - 1];
        const text = extractAnswerText(node).trim();
        if (text) return text;
      }

      // 回退: 拼接全部正文段落(.markdown-body)，跳过思考块
      const parts = [];
      const seen = new Set();
      for (const node of document.querySelectorAll('.markdown-body')) {
        if (seen.has(node)) continue;
        seen.add(node);
        const text = extractAnswerText(node).trim();
        if (text) parts.push(text);
      }
      if (parts.length > 0) return parts.join('\n\n').trim();
      return null;
    }
  });

  // Pull the clean answer text out of a single container: drop thinking blocks,
  // reference/footer noise and injected <style>/<script> (e.g. mermaid chart
  // CSS), then read innerText.
  function extractAnswerText(element) {
    if (!element) return '';

    // Thinking blocks on chatglm.cn/z.ai carry the class "text-advance-thinking-
    // content" (and similar) and sit INSIDE the main .answer container. If the
    // node we were handed IS itself a thinking block, return nothing.
    if (isThinkingElement(element)) return '';

    const clone = element.cloneNode(true);

    // 0) Convert <table> elements into pipe-separated rows BEFORE reading
    //    innerText — otherwise the whole table is flattened into one run-on
    //    line ("插件名称核心定位引擎支持…ModSearch…") that is unreadable.
    //    A <pre> keeps newlines, so each row lands on its own line.
    clone.querySelectorAll('table').forEach(t => {
      const rows = [];
      t.querySelectorAll('tr').forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('th, td'))
          .map(c => (c.innerText || '').trim().replace(/\s+/g, ' '))
          .filter(Boolean);
        if (cells.length) rows.push('| ' + cells.join(' | ') + ' |');
      });
      const pre = document.createElement('pre');
      pre.textContent = rows.join('\n');
      t.replaceWith(pre);
    });

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
      '.text-advance-thinking-content',
      '[class*="think"]',
      '[class*="thought"]',
      '[class*="reasoning"]',
      '[class*="thinking"]',
      '[class*="analysis"]',
      '[class*="chain"]',
      '[class*="cot"]',
      '[class*="overflow-hidden"][class*="max-h"]',
      '[data-type*="think"]',
      '[data-type*="reason"]',
      // Rendered mermaid preview (a div with class "mermaid") duplicates the
      // diagram source that lives in the <pre>/<code> block. Drop the preview so
      // we keep only the flowchart source text, not the flattened node labels.
      '[class*="mermaid"]'
    ];
    for (const selector of noiseSelectors) {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    }

    // 3) Collapsible thinking wrappers labelled with the Chinese "thinking" text.
    clone.querySelectorAll('*').forEach(el => {
      const headerText = (el.innerText || '').trim();
      if (headerText === '思考' || headerText === '已深度思考' || headerText === '深度思考') {
        el.remove();
      }
    });

    return clone.innerText || '';
  }

  // True when an element is (or is inside) a reasoning/thinking block. Used so a
  // container that IS the thinking block returns nothing instead of leaking.
  function isThinkingElement(el) {
    if (!el) return false;
    const cls = (el.className || '') + ' ' + (el.getAttribute && el.getAttribute('class') || '');
    if (/thinking|thought|reasoning|深度思考/.test(cls)) return true;
    // Also walk up a little in case the captured node wraps the thinking block.
    let p = el.parentElement;
    while (p) {
      const pcls = (p.className || '');
      if (/thinking|thought|reasoning|深度思考/.test(pcls)) return true;
      p = p.parentElement;
    }
    return false;
  }
})();
