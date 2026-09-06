#!/usr/bin/env node
// 在页面内直接对指定容器跑 toMarkdown, 并对比 innerText, 用于调试序列化器
import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const argv = process.argv.slice(2);
const site = (argv.find(a => a.startsWith('--site=')) || '').slice(7) || 'chatglm.cn';
const sel = (argv.find(a => a.startsWith('--sel=')) || '').slice(6)
  || '.answer-content-wrap:not(.text-advance-thinking-content)';
const domUtilsSrc = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "dom-utils.js"), "utf8");

const EXPR = `
(function () {
  var DOM = ${JSON.stringify(domUtilsSrc)};
  try { delete window.AIPanelDom; } catch (e) { window.AIPanelDom = undefined; }
  (0, eval)(DOM);
  var nodes = document.querySelectorAll(${JSON.stringify(sel)});
  if (!nodes.length) return JSON.stringify({ error: 'no node for ' + ${JSON.stringify(sel)} });
  var el = nodes[nodes.length - 1];
  var cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '';
  // 决定性证据: 打印页面内实际运行的函数源码指纹
  var fnSrc = String(window.AIPanelDom.toMarkdown || 'UNDEFINED');
  var blockSrc = 'n/a';
  var report = { fnHead: fnSrc.slice(0, 150), fnLen: fnSrc.length };
  var md = window.AIPanelDom.toMarkdown(el);
  // 顶层直接子节点的序列化结果, 便于看哪一环出错
  var childInfo = [];
  Array.from(el.children).slice(0, 8).forEach(function (c) {
    var cc = (c.className && c.className.baseVal !== undefined ? c.className.baseVal : c.className) || '';
    var ser = '';
    try { ser = window.AIPanelDom.toMarkdown(c); } catch (e) { ser = 'THREW: ' + e.message; }
    childInfo.push({ tag: c.tagName, cls: String(cc).slice(0, 40), len: (c.innerText || '').length,
                     serLen: ser.length, serHead: ser.slice(0, 60),
                     head: (c.innerText || '').trim().slice(0, 50),
                     kids: Array.from(c.children).slice(0, 10).map(function (k) {
                       var kc = (k.className && k.className.baseVal !== undefined ? k.className.baseVal : k.className) || '';
                       var r = '';
                       try { r = window.AIPanelDom.toMarkdown(k); } catch (e) { r = 'THREW ' + e.message; }
                       var grand = Array.from(k.children).slice(0, 4).map(function (g) {
                         var gc = (g.className && g.className.baseVal !== undefined ? g.className.baseVal : g.className) || '';
                         return g.tagName + '.' + String(gc).slice(0, 25);
                       });
                       return k.tagName + '.' + String(kc).slice(0, 25) + '[' + (k.innerText || '').length +
                              '] -> serLen=' + r.length + ' ' + JSON.stringify(r.slice(0, 40)) +
                              ' kids=' + grand.join(',');
                     }) });
  });
  report.rootTag = el.tagName; report.rootCls = String(cls).slice(0, 60);
  var dbg = JSON.stringify(report);
  return JSON.stringify({
    dbg: report,
    rootTag: el.tagName, rootCls: String(cls).slice(0, 60),
    childCount: el.children.length,
    innerTextLen: (el.innerText || '').length,
    mdLen: md.length,
    mdHead: md.slice(0, 200),
    children: childInfo
  });
})();
`;

const tabs = await new Promise((res) => {
  http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  });
});
const tab = tabs.find(t => t.type === 'page' && t.url.includes(site));
if (!tab) { console.log('no tab for', site); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
const raw = res.result?.result?.value;
let info; try { info = JSON.parse(raw); } catch { console.log(String(raw).slice(0, 500)); process.exit(0); }
if (info.error) { console.log('ERROR:', info.error); }
else {
  console.log('FN PROBE:', JSON.stringify(info.dbg));
  console.log('root:', info.rootTag, '| cls:', info.rootCls);
  console.log('children:', info.childCount, '| innerTextLen:', info.innerTextLen, '| mdLen:', info.mdLen);
  console.log('mdHead:', JSON.stringify(info.mdHead));
  console.log('--- direct children ---');
  info.children.forEach((c2, i) => {
    console.log(`  [${i}] <${c2.tag}> cls="${c2.cls}" len=${c2.len} serLen=${c2.serLen} :: ${JSON.stringify(c2.serHead)}`);
    if (c2.kids) console.log('       kids: ' + c2.kids.join(' | '));
  });
}
c.close();
