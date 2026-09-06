#!/usr/bin/env node
// 全站引用元素普查: 对每个在线 AI 标签页, 找正文容器里的行内引用载体
// (a[href] 局部 / [data-url] / sup / class 含 cite/citation/chip),
// 输出结构样本 —— 用于对照各站噪声规则找丢失点
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);

const HOSTS = {
  'chatglm.cn': '.answer-content-wrap:not(.text-advance-thinking-content)',
  'kimi.com': '.chat-content-item-assistant',
  'claude.ai': '[data-message-author-role="assistant"], .font-claude-message, [data-is-streaming="false"]',
  'chatgpt.com': '[data-message-author-role="assistant"]',
  'gemini.google.com': 'message-content',
  'chat.deepseek.com': '.ds-markdown',
  'grok.com': '.message-bubble',
  'qianwen.com': '[class*="markdown"]'
};

const PROBE = (hostSel) => `(function(){
  var hs = document.querySelectorAll(${JSON.stringify(hostSel)});
  var m = hs[hs.length - 1];
  if (!m) return JSON.stringify({ error: 'no host' });
  var out = { candidates: [] };
  function push(el, kind) {
    if (out.candidates.length >= 6) return;
    // 排除明显的大卡片容器(引用列表块)
    if (el.closest('[class*="pua-ref-article"], .carousel-container, [class*="sources-carousel"]')) return;
    out.candidates.push({
      kind: kind,
      tag: el.tagName,
      cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').slice(0, 40),
      text: (el.textContent || '').trim().slice(0, 22),
      href: (el.getAttribute && (el.getAttribute('href') || '')) || null,
      dataUrl: (el.getAttribute && (el.getAttribute('data-url') || '')) || null,
      dataSite: (el.getAttribute && (el.getAttribute('data-site-name') || '')) || null,
      outer: el.outerHTML.slice(0, 160)
    });
  }
  // 1) 行内 a[href](排除块级卡片链接)
  m.querySelectorAll('a[href]').forEach(function (a) {
    if (a.closest('[class*="pua-ref-article"], .carousel-container, [class*="sources-carousel"], [class*="sources-footer"]')) return;
    // 只要"短"链接(角标/引用), 长文本链接(正文超链)也算——统一列出
    push(a, 'a[href]');
  });
  // 2) data-url 引用
  m.querySelectorAll('[data-url]').forEach(function (el) { if (!el.closest('a')) push(el, 'data-url'); });
  // 3) sup / 角标
  m.querySelectorAll('sup').forEach(function (el) { push(el, 'sup'); });
  // 4) class 含 cite/citation/chip/source-mark 的元素
  m.querySelectorAll('[class*="cite"], [class*="citation"], [class*="chip"], [class*="source-mark"]').forEach(function (el) {
    if (el.closest('a')) return;
    push(el, 'cite-class');
  });
  return JSON.stringify(out, null, 1);
})();`;

const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });

for (const [host, hostSel] of Object.entries(HOSTS)) {
  const tab = tabs.find(t => t.type === 'page' && t.url.includes(host));
  if (!tab) { console.log(`\n===== ${host}: 无标签页, 跳过 =====`); continue; }
  try {
    const c = await cdp(tab.webSocketDebuggerUrl);
    const res = await c.cmd('Runtime.evaluate', { expression: PROBE(hostSel), returnByValue: true });
    let info;
    try { info = JSON.parse(res.result?.result?.value ?? '{}'); } catch { info = { error: 'parse' }; }
    console.log(`\n===== ${host} =====`);
    if (info.error) { console.log('  ', info.error); }
    else {
      console.log('  引用候选:', info.candidates.length);
      info.candidates.forEach((x, i) => {
        console.log(`  [${i}] ${x.kind} <${x.tag}> cls="${x.cls}" text="${x.text}" site="${x.dataSite}"`);
        if (x.href) console.log(`      href: ${x.href.slice(0, 90)}`);
        if (x.dataUrl) console.log(`      data-url: ${x.dataUrl.slice(0, 70)}`);
      });
    }
    c.close();
  } catch (e) { console.log(`\n===== ${host}: ERROR ${e.message} =====`); }
}
console.log('\ndone');
