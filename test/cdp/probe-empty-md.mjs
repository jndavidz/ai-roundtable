#!/usr/bin/env node
// 扫描 gemini 回复: 找「innerText 非空但 toMarkdown 为空」的元素, 打印结构
import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const domUtilsSrc = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "dom-utils.js"), "utf8");
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('gemini.google.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
// 源码用普通字符串拼接注入(避免模板反引号坑)
const EXPR = '(function(){\n' +
  'var D = ' + JSON.stringify(domUtilsSrc) + ';\n' +
  'try { delete window.AIPanelDom; } catch (e) { window.AIPanelDom = undefined; }\n' +
  '(0, eval)(D);\n' +
  `var mc = document.querySelectorAll('message-content');
  var m = mc[mc.length - 1];
  var bad = [];
  m.querySelectorAll('li, p, h2, h3').forEach(function (el) {
    var t = (el.innerText || '').trim();
    if (!t) return;
    var md = '';
    try { md = window.AIPanelDom.toMarkdown(el); } catch (e) { md = 'THREW ' + e.message; }
    if (!String(md).trim() && !String(md).startsWith('THREW')) {
      bad.push({ tag: el.tagName, innerTextLen: t.length, head: t.slice(0, 50),
                 html: el.outerHTML.slice(0, 400) });
    }
  });
  return JSON.stringify({ badCount: bad.length, items: bad.slice(0, 4) }, null, 1);
})();`;
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
console.log(res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 300));
c.close();
