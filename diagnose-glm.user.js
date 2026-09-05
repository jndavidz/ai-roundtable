// 诊断脚本：在 ChatGLM / Kimi 等 AI 页面的 DevTools Console 里运行，
// 打印出聚合逻辑会抓到哪些容器、是否误含 thinking / style，以及最终文本。
// 用法：打开对应标签页 → F12 → Console → 粘贴本文件全部内容 → 回车。
(function () {
  'use strict';
  const SITES = {
    glm: [
      '.markdown-body', '[class*="chat-content"]', '[class*="message"]',
      '.chat-top-section', '.glms-operation-content',
      '[class*="answer"]', '[class*="response"]', '[class*="bubble"]'
    ],
    kimi: [
      '[class*="markdown"]', '[class*="chat-content"]', '[class*="message"]',
      '[class*="answer"]', '[class*="response"]', '[class*="bubble"]'
    ]
  };
  const site = location.hostname.includes('chatglm') || location.hostname.includes('z.ai')
    ? 'glm' : (location.hostname.includes('kimi') ? 'kimi' : null);
  if (!site) { console.log('[诊断] 当前不是 chatglm/z.ai/kimi 页面'); return; }

  const sels = SITES[site];
  const broad = new Set(['[class*="response"]', '[class*="bubble"]']);
  const noise = [
    'style', 'script',
    '.text-advance-thinking-content',
    '[class*="think"]', '[class*="thought"]', '[class*="reasoning"]',
    '[class*="thinking"]', '[class*="analysis"]', '[class*="chain"]', '[class*="cot"]',
    '[data-type*="think"]', '[data-type*="reason"]'
  ];

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

  // Mirror content/glm.js's extractAnswerText EXACTLY: if the node itself is a
  // thinking block, return '' (this is the fix that was missing before).
  function stripNoise(el) {
    if (isThinkingElement(el)) return '';
    const c = el.cloneNode(true);
    noise.forEach(s => c.querySelectorAll(s).forEach(n => n.remove()));
    c.querySelectorAll('*').forEach(n => {
      const t = (n.innerText || '').trim();
      if (t === '思考' || t === '已深度思考' || t === '深度思考') n.remove();
    });
    return c.innerText || '';
  }

  const seen = new Set();
  const parts = [];
  const THINKING_SIGNATURE = /Hmm[,，]|用户想|深度思考|已深度思考|thinking block/i;
  console.log('[诊断] 站点 =', site, ' 容器选择器 =', sels.join(' | '));
  console.log('[诊断] thinking 命中数 =',
    document.querySelectorAll('.text-advance-thinking-content, [class*="thinking"], [class*="think"], [class*="reasoning"]').length);
  for (const sel of sels) {
    document.querySelectorAll(sel).forEach(node => {
      if (seen.has(node)) return;
      seen.add(node);
      const raw = node.innerText || '';
      const cleaned = stripNoise(node).trim();
      const isThinking = /Hmm|用户想|思考|深度思考/i.test(raw) && raw.length > cleaned.length + 20;
      const hasStyle = /#mmd-|@keyframes|font-family/.test(raw);
      const isBroad = broad.has(sel);
      const dropped = isBroad && cleaned.length < 20;
      const selfThinking = /thinking|thought|reasoning|深度思考/.test(node.className || '');
      const sigDrop = THINKING_SIGNATURE.test(cleaned);
      console.log(
        `[诊断] sel=${sel} cls="${node.className}" ` +
        `rawLen=${raw.length} cleanLen=${cleaned.length} ` +
        `thinking=${isThinking} selfThinking=${selfThinking} style=${hasStyle} dropped=${dropped} sigDrop=${sigDrop}`
      );
      if (cleaned && !dropped && !sigDrop) parts.push(cleaned);
    });
  }
  const final = parts.join('\n\n').trim();
  console.log('[诊断] ===== 最终聚合文本（前 600 字）=====');
  console.log(final.slice(0, 600));
  console.log('[诊断] 含 tencent.com?', final.includes('tencent.com'),
              ' 含 aliyun.com?', final.includes('aliyun.com'),
              ' 含 #mmd-?', final.includes('#mmd-'),
              ' 含 Hmm?', /Hmm/.test(final));
})();
