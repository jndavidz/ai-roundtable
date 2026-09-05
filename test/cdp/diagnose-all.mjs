#!/usr/bin/env node
// 诊断 8 大模型站点：在 Tabbit(通道2, 9223) 各 AI 标签页上执行与
// ai-roundtable content script 相同的 getLatestResponse 逻辑，
// 报告每站的命中容器、提取文本长度与开头，用于验证/修正选择器。
// 运行: D:\PortableApps\_sys\node\node.exe <this>  (Windows 侧, 读 127.0.0.1:9223)
import { pathToFileURL } from "node:url";
import http from "node:http";

const PORT = 9223;

function getJSON(pathname) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: pathname }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);

// 与 content/glm.js 对齐的诊断逻辑（表格转管道行 / thinking 剥离 / 祖先跳过 / 子串去重）
const FN = `
(function () {
  const host = location.hostname || '';
  const site = host.replace(/^www\\./, '');
  const SITES = {
    'chatglm.cn': [
      '.markdown-body', '[class*="chat-content"]', '[class*="message"]', '.chat-top-section',
      '.glms-operation-content', '[class*="answer"]', '[class*="response"]', '[class*="bubble"]'
    ],
    'kimi.com': [
      '[class*="markdown"]', '[class*="chat-content"]', '[class*="message"]',
      '[class*="answer"]', '[class*="response"]', '[class*="bubble"]'
    ],
    'claude.ai': [
      '[data-message-author-role="assistant"]', '[data-test-render-count]', '.font-claude-message', '[class*="assistant"]'
    ],
    'chatgpt.com': [
      '[data-message-author-role="assistant"]', '[data-testid*="conversation-turn"]:has([data-message-author-role="assistant"])', '.agent-turn', '[class*="assistant"]'
    ],
    'gemini.google.com': [
      'message-content', '[class*="markdown"]', '[class*="response"]', 'model-response'
    ],
    'chat.deepseek.com': [
      '.ds-markdown--block', '.ds-markdown', '.markdown-body', '[class*="message"] [class*="content"]'
    ],
    'grok.com': [
      '[class*="markdown"]', '[class*="message"] [class*="content"]', '[class*="response"]', '[class*="bubble"]'
    ],
    'www.qianwen.com': [
      '[class*="markdown"]', '[class*="answer"]', '[class*="response"]', '[class*="content"]'
    ]
  };
  const sels = SITES[site];
  if (!sels) return JSON.stringify({ site, error: 'no selectors for site' });

  const isThinkingEl = (el) => {
    if (!el) return false;
    const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '';
    if (/thinking|thought|reasoning|深度思考/.test(cls)) return true;
    let p = el.parentElement;
    while (p) {
      const pc = (p.className && p.className.baseVal !== undefined ? p.className.baseVal : p.className) || '';
      if (/thinking|thought|reasoning|深度思考/.test(pc)) return true;
      p = p.parentElement;
    }
    return false;
  };

  const noiseSelectors = [
    'style', 'script',
    '.text-advance-thinking-content',
    '[class*="think"]', '[class*="thought"]', '[class*="reasoning"]', '[class*="thinking"]',
    '[class*="analysis"]', '[class*="chain"]', '[class*="cot"]',
    '[class*="overflow-hidden"][class*="max-h"]',
    '[data-type*="think"]', '[data-type*="reason"]',
    '[class*="mermaid"]'
  ];

  function extract(el) {
    if (isThinkingEl(el)) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('table').forEach(t => {
      const rows = [];
      t.querySelectorAll('tr').forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('th, td'))
          .map(c => (c.innerText || '').trim().replace(/\\s+/g, ' ')).filter(Boolean);
        if (cells.length) rows.push('| ' + cells.join(' | ') + ' |');
      });
      const pre = document.createElement('pre');
      pre.textContent = rows.join('\\n');
      t.replaceWith(pre);
    });
    noiseSelectors.forEach(s => clone.querySelectorAll(s).forEach(n => n.remove()));
    clone.querySelectorAll('*').forEach(n => {
      const t = (n.innerText || '').trim();
      if (t === '思考' || t === '已深度思考' || t === '深度思考') n.remove();
    });
    return clone.innerText || '';
  }

  // 候选收集：thinking 特征直接丢弃
  const seen = new Set();
  const cands = [];
  const hits = [];
  for (const sel of sels) {
    document.querySelectorAll(sel).forEach(node => {
      if (seen.has(node)) return;
      seen.add(node);
      const leafSels = ['.markdown-body', '.answer-content-wrap', '[class*="content"]', '[class*="markdown"]'];
      const wrapsLeaf = leafSels.some(ls => ls !== sel && node.querySelector(ls));
      const cls = (node.className && node.className.baseVal !== undefined ? node.className.baseVal : node.className) || '';
      const text = extract(node).trim();
      const THINKING = /Hmm[,，]|用户想|深度思考|已深度思考|thinking block/i;
      const dropped = !text || THINKING.test(text) ||
        (text.length < 20 && /response|bubble/.test(sel));
      hits.push({ sel: sel, cls: String(cls).slice(0, 55), wrapsLeaf: wrapsLeaf, rawLen: (node.innerText || '').length, cleanLen: text.length, dropped: dropped });
      if (!dropped) cands.push({ text: text, wrapsLeaf: wrapsLeaf });
    });
  }

  // 去重：只保留「未被其他候选包含」的最大块（去掉重复副本）
  const norm = s => s.replace(/\\s+/g, '');
  const kept = cands.filter(c => {
    const cn = norm(c.text);
    return !cands.some(o => o !== c && norm(o.text).length > cn.length && norm(o.text).includes(cn));
  }).map(c => c.text);
  const final = kept.join('\\n\\n').trim();
  return JSON.stringify({
    site: site,
    finalLen: final.length,
    head: final.slice(0, 150),
    tail: final.slice(-120),
    hasHmm: /Hmm/.test(final),
    hasMmd: /#mmd-/.test(final),
    hits: hits
  });
})();
`;

const AI_TABS = [
  'chatglm.cn', 'kimi.com', 'claude.ai', 'chatgpt.com',
  'gemini.google.com', 'chat.deepseek.com', 'grok.com', 'qianwen.com'
];

// CLI: --site=<host> 只跑一个站; --all 打印全部命中
const argv = process.argv.slice(2);
const siteArg = (argv.find(a => a.startsWith('--site=')) || '').slice(7);
const printAll = argv.includes('--all');
const wanted = siteArg ? [siteArg] : AI_TABS;

const tabs = await getJSON('/json/list');
const pages = tabs.filter(t => t.type === 'page' && wanted.some(d => (t.url || '').includes(d)));
console.log('found AI tabs:', pages.length);

  for (const tab of pages) {
    const site = wanted.find(d => tab.url.includes(d));
    try {
      const c = await cdp(tab.webSocketDebuggerUrl);
      const res = await c.cmd('Runtime.evaluate', { expression: FN, returnByValue: true, awaitPromise: false });
      const val = res.result?.result?.value ?? res.exceptionDetails?.text;
      let info;
      try { info = JSON.parse(val); } catch { info = { site, error: 'parse fail', raw: String(val).slice(0, 300) }; }
      console.log('\n====', site, '====');
      if (info.error) { console.log('ERROR:', info.error, info.raw || ''); }
      else {
        console.log('finalLen:', info.finalLen, '| hasHmm:', info.hasHmm, '| hasMmd:', info.hasMmd, '| hits:', info.hits.length);
        console.log('head:', JSON.stringify(info.head));
        console.log('tail:', JSON.stringify(info.tail));
        for (const h of (printAll ? info.hits : info.hits.slice(0, 6))) {
          console.log(`  sel=${h.sel} cls="${h.cls}" raw=${h.rawLen} clean=${h.cleanLen} wraps=${h.wrapsLeaf} dropped=${h.dropped}`);
        }
      }
      c.close();
    } catch (e) {
      console.log('\n====', site, '====');
      console.log('CDP FAIL:', e.message);
    }
  }
  console.log('\ndone');
