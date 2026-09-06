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
    // CDP 实测(kimi.com, 2026-09): 真实结构为
    //   .chat-content-list > .chat-content-item.chat-content-item-assistant
    //     > .markdown-container > .markdown (+ .table.markdown-table)
    // 之前按「收集所有匹配容器」拼接，会同时抓到会话容器、用户消息容器、
    // 助手容器与 markdown 容器并按层级重复拼接(实测 16818 字，且混入用户
    // 提问与「高峰时段算力不足…升级会员」推广)。
    // 修正: 只取最后一条「助手消息容器」，表格/代码块都在它内部，天然完整。
    getLatestResponse: function () {
      // 助手消息容器优先(语义精确)，越靠前优先级越高
      const containerSelectors = [
        '.chat-content-item-assistant',
        '[class*="item-assistant"]',
        '[class*="assistant"]',
        '.markdown-container',
        '[class*="markdown"]',
        '.chat-content-item',
        '[class*="chat-content"]'
      ];

      for (const sel of containerSelectors) {
        const nodes = Array.from(document.querySelectorAll(sel))
          .filter(el => (el.innerText || '').trim().length > 0);
        if (nodes.length === 0) continue;
        // 取最后一条(最新回复)
        const node = nodes[nodes.length - 1];
        const text = extractAnswerText(node).trim();
        if (text) return text;
      }
      return null;
    }
  });

  // Pull clean answer text from one container: drop thinking blocks, reference/
  // footer noise, and injected <style>/<script> (e.g. mermaid chart CSS),
  // then read innerText.
  function extractAnswerText(element) {
    if (!element) return '';

    // If the node itself IS a thinking block, return nothing.
    if (isThinkingElement(element)) return '';

    const clone = element.cloneNode(true);

    // 0) Convert <table> elements into pipe-separated rows BEFORE reading
    //    innerText — otherwise the whole table is flattened into one run-on
    //    line that is unreadable. A <pre> keeps newlines, so each row lands
    //    on its own line.
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

    // 1) Always drop raw style/script so injected CSS blobs (mermaid diagrams)
    //    never leak into the captured text.
    clone.querySelectorAll('style, script').forEach(el => el.remove());

    // 2) Reasoning / thinking blocks. We do NOT strip generic "citation"/"source"
    //    nodes — those also wrap the answer's own inline citations and "来源"
    //    section, which should be kept.
    const noiseSelectors = [
      '[class*="think"]',
      '[class*="thought"]',
      '[class*="reasoning"]',
      '[class*="thinking"]',
      '[class*="analysis"]',
      '[class*="chain"]',
      '[class*="cot"]',
      '[data-type*="think"]',
      '[data-type*="reason"]',
      // Rendered mermaid preview duplicates the diagram source in the code block;
      // drop the preview so only the flowchart source text is kept.
      '[class*="mermaid"]',
      // CDP 实测(kimi.com 2026-09)噪声：
      // - 工具调用「摘要」(.toolcall-rollup__part / .toolcall-flow*)
      //   「使用 3 个工具…搜索网页(40 个结果)」不是最终答复，须剥离
      //   注意：正文在 .toolcall-rollup__tail > .markdown-container 里，
      //   因此不能整体删 [class*="toolcall"]，只删 summary 部分
      // - .upgrade-membership「高峰时段算力不足…升级会员畅用思考模型」推广
      '.toolcall-rollup__part',
      '[class*="toolcall-flow"]',
      '.upgrade-membership',
      '[class*="upgrade-membership"]',
      // CDP 实测: .segment-assistant-actions 是回复下方的操作按钮区
      // (「引用 / 复制 / 重新生成」等), 不是答复内容
      '.segment-assistant-actions',
      '[class*="segment-assistant-actions"]',
      // CDP 实测: 联网搜索返回的引用卡片块在正文最前面
      // (.pua-ref-renderer / .pua-ref-article-block / .pua-ref-article-card,
      //  形如「Github GitHub - xxx/dsh-xxx: ... 2周前」)。
      // 按用户要求剥离, 只保留 kimi 自己的分析正文(标题/段落/表格)。
      '[class*="pua-ref"]'
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

  // True when an element is (or wraps) a reasoning/thinking block.
  function isThinkingElement(el) {
    if (!el) return false;
    const cls = (el.className || '') + ' ' + (el.getAttribute && el.getAttribute('class') || '');
    if (/thinking|thought|reasoning|深度思考/.test(cls)) return true;
    let p = el.parentElement;
    while (p) {
      if (/thinking|thought|reasoning|深度思考/.test(p.className || '')) return true;
      p = p.parentElement;
    }
    return false;
  }
})();
