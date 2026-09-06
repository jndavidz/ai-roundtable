#!/usr/bin/env node
// 探测 kimi 助手消息内: 搜索结果块 与 分析正文块 各自的 class 与父链,
// 用于决定剥离哪一类节点。
// 用法: node probe-chain.mjs --grep='关键词'
import { pathToFileURL } from "node:url";
import http from "node:http";

const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const argv = process.argv.slice(2);
const grep = (argv.find(a => a.startsWith('--grep=')) || '').slice(7) || '置信度评级';
const sel = (argv.find(a => a.startsWith('--sel=')) || '').slice(6) || '.chat-content-item-assistant';

const tabs = await new Promise((res) => {
  http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  });
});
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com'));
if (!tab) { console.log('no kimi tab'); process.exit(1); }

const EXPR = `
(function () {
  var root = document.querySelector(${JSON.stringify(sel)});
  if (!root) return JSON.stringify({ error: 'no root: ' + ${JSON.stringify(sel)} });
  var out = [];
  root.querySelectorAll('*').forEach(function (el) {
    var t = (el.innerText || '').trim().replace(/\\s+/g, ' ');
    if (!t) return;
    if (!new RegExp(${JSON.stringify(grep)}).test(t)) return;
    var chain = [], n = el;
    for (var i = 0; i < 6 && n; i++) {
      var nc = (n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) || '';
      chain.push(n.tagName + '.' + String(nc).slice(0, 42) + '[' + ((n.innerText || '').trim().replace(/\\s+/g, ' ').length) + ']');
      n = n.parentElement;
    }
    out.push({ hit: t.slice(0, 50), chain: chain });
  });
  return JSON.stringify({ n: out.length, items: out.slice(0, 10) });
})();
`;

const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
const raw = res.result?.result?.value;
let info;
try { info = JSON.parse(raw); } catch { console.log('raw:', String(raw).slice(0, 400)); process.exit(0); }
if (info.error) { console.log('ERROR:', info.error); }
else {
  console.log('matches:', info.n);
  info.items.forEach((it, i) => {
    console.log(`\n[${i}] hit: ${it.hit}`);
    it.chain.forEach((c2, d) => console.log(`    ${d}: ${c2}`));
  });
}
c.close();
