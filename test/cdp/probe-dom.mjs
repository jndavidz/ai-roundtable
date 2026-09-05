#!/usr/bin/env node
// 在指定站点标签页上 dump 指定容器内部的 candidate 节点 class/text，
// 用于定位"工具调用块 / 升级提示 / 推广"等噪声的真实 class。
// 用法: node probe-dom.mjs --site=kimi.com --sel='.chat-content-item-assistant'
import { pathToFileURL } from "node:url";
import http from "node:http";

const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const argv = process.argv.slice(2);
const site = (argv.find(a => a.startsWith('--site=')) || '').slice(7);
const sel = (argv.find(a => a.startsWith('--sel=')) || '').slice(6) || 'body';
const grep = (argv.find(a => a.startsWith('--grep=')) || '').slice(7); // 只列含该文本的

const tabs = await new Promise((res) => {
  http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  });
});
const tab = tabs.find(t => t.type === 'page' && t.url.includes(site));
if (!tab) { console.log('no tab for', site); process.exit(1); }

const EXPR = `
(function () {
  var all = document.querySelectorAll(${JSON.stringify(sel)});
  var root = all.length ? all[all.length - 1] : document.querySelector('body');
  if (!root) return JSON.stringify({ error: 'root not found: ' + ${JSON.stringify(sel)} });
  var out = [];
  root.querySelectorAll('*').forEach(function (el) {
    var t = (el.innerText || '').trim().replace(/\\s+/g, ' ');
    if (!t) return;
    var cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '';
    out.push({ tag: el.tagName, cls: String(cls).slice(0, 70), len: t.length, head: t.slice(0, 70) });
  });
  return JSON.stringify({ total: out.length, nodes: out });
})();
`;

const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
let info;
try { info = JSON.parse(res.result?.result?.value ?? '{}'); } catch (e) { console.log('parse fail', String(res.result?.result?.value).slice(0, 300)); }
if (info.error) { console.log('ERROR:', info.error); }
else {
  console.log('nodes with text under', sel, ':', info.total);
  const filter = grep ? info.nodes.filter(n => n.head.includes(grep)) : info.nodes;
  console.log('showing', filter.length, grep ? `(grep=${grep})` : '');
  filter.slice(0, 40).forEach(n => console.log(`  <${n.tag}> cls="${n.cls}" len=${n.len} :: ${n.head}`));
}
c.close();
