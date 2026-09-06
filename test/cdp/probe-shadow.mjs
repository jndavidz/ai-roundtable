#!/usr/bin/env node
// 验证 chatglm 正文是否用 Shadow DOM 渲染:
// 对比 childNodes(遍历可得) 与 innerText(渲染结果), 并探测 shadowRoot
import { pathToFileURL } from "node:url";
import http from "node:http";

const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);

const EXPR = `
(function () {
  var nodes = document.querySelectorAll('.answer-content-wrap:not(.text-advance-thinking-content)');
  if (!nodes.length) return JSON.stringify({ error: 'no container' });
  var root = nodes[nodes.length - 1];
  var report = { rootChildren: root.children.length, rootTextLen: (root.innerText || '').length, samples: [] };

  // 递归找 shadowRoot
  var shadowHosts = [];
  function walk(el, depth) {
    if (depth > 6 || shadowHosts.length > 20) return;
    if (el.shadowRoot) {
      shadowHosts.push({
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 40),
        lightChildren: el.childNodes.length,
        shadowChildren: el.shadowRoot.childNodes.length,
        textLen: (el.innerText || '').length,
        shadowTextLen: (el.shadowRoot.textContent || '').length
      });
    }
    Array.from(el.children).forEach(function (c) { walk(c, depth + 1); });
    // 也遍历 shadow 内部
    if (el.shadowRoot) Array.from(el.shadowRoot.children).forEach(function (c) { walk(c, depth + 1); });
  }
  walk(root, 0);
  report.shadowHosts = shadowHosts;
  report.shadowCount = shadowHosts.length;

  // 抽样: root 前几个后代节点的 childNodes 与 innerText 对比
  var all = root.querySelectorAll('*');
  var samples = [];
  for (var i = 0; i < all.length && samples.length < 8; i++) {
    var el = all[i];
    var t = (el.innerText || '').trim();
    if (!t) continue;
    samples.push({
      tag: el.tagName,
      cls: String(el.className || '').slice(0, 30),
      childNodes: el.childNodes.length,
      childElements: el.children.length,
      hasShadow: !!el.shadowRoot,
      innerTextLen: t.length,
      textContentLen: (el.textContent || '').trim().length,
      head: t.slice(0, 40)
    });
  }
  report.samples = samples;
  return JSON.stringify(report);
})();
`;

const tabs = await new Promise((res) => {
  http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  });
});
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatglm.cn'));
if (!tab) { console.log('no chatglm tab'); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
const raw = res.result?.result?.value;
let info; try { info = JSON.parse(raw); } catch { console.log(String(raw).slice(0, 500)); process.exit(0); }
if (info.error) { console.log('ERROR:', info.error); process.exit(0); }

console.log('root: children=' + info.rootChildren, 'innerTextLen=' + info.rootTextLen, '| shadowHosts found:', info.shadowCount);
info.shadowHosts.slice(0, 10).forEach((h, i) =>
  console.log(`  [shadow ${i}] <${h.tag}> cls="${h.cls}" light=${h.lightChildren} shadow=${h.shadowChildren} innerText=${h.textLen} shadowText=${h.shadowTextLen}`));
console.log('--- text-bearing samples ---');
info.samples.forEach((s, i) =>
  console.log(`  [${i}] <${s.tag}> cls="${s.cls}" childNodes=${s.childNodes} childEls=${s.childElements} shadow=${s.hasShadow} innerText=${s.innerTextLen} textContent=${s.textContentLen} :: ${JSON.stringify(s.head)}`));
c.close();
