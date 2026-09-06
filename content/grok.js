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
    ],

    // CDP 实测(grok.com 2026-09): 默认派生取 .message-bubble 的 innerText,
    // 其中混有 .thinking-container(「工作了 16s」耗时/思考标记)与消息底部
    // 的 sources 计数按钮(「65 sources」)。改为自定义提取: 取最后一条消息
    // 气泡 → 剥离思考容器与注入样式 → 表格转管道行 → 清掉 sources 计数行。
    getLatestResponse: function () {
      const bubbleSelectors = [
        '.message-bubble',
        '.prose-chat',
        '[data-testid*="message"]',
        '[class*="markdown"]'
      ];

      let node = null;
      for (const sel of bubbleSelectors) {
        const nodes = Array.from(document.querySelectorAll(sel))
          .filter(el => (el.innerText || '').trim().length > 0);
        if (nodes.length > 0) { node = nodes[nodes.length - 1]; break; }
      }
      if (!node) return null;

      const clone = node.cloneNode(true);
      // 思考/耗时标记 (.thinking-container「工作了 16s」) 与注入样式
      clone.querySelectorAll('.thinking-container, [class*="thinking"], style, script')
        .forEach(el => el.remove());

      // 表格转管道行, 避免被 innerText 压成一行
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

      // DOM→Markdown 序列化(表格管道行/引用链接/代码围栏), 再清理 sources 计数
      let md = window.AIPanelDom && window.AIPanelDom.toMarkdown
        ? window.AIPanelDom.toMarkdown(clone)
        : (clone.innerText || '');
      md = md
        .replace(/\s*\d+\s*sources\s*$/i, '') // 尾部「65 sources」计数
        .replace(/\n\s*\d+\s*sources\s*(?=\n)/gi, '\n') // 独立成行的 sources
        .replace(/^\s*\w*\s*(表格|复制|下载|代码预览|代码|预览)\s*$/gmi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return md || null;
    }
  });
})();
