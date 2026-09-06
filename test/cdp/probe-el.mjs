import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const domUtilsSrc = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "dom-utils.js"), "utf8");
const site = process.argv[2] || 'chatgpt.com';
const sel = process.argv[3] || 'ul';
const idx = parseInt(process.argv[4] || '0', 10);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes(site));
const c = await cdp(tab.webSocketDebuggerUrl);
// 源码注入: 普通字符串拼接
const EXPR = '(function(){\n' +
  'var D=' + JSON.stringify(domUtilsSrc) + ';\n' +
  'try { delete window.AIPanelDom; } catch (e) { window.AIPanelDom = undefined; }\n' +
  '(0, eval)(D);\n' +
  'var els = document.querySelectorAll(' + JSON.stringify(sel) + ');\n' +
  'var el = els[' + idx + '];\n' +
  'if (!el) return JSON.stringify({ error: "not found" });\n' +
  'var md = window.AIPanelDom.toMarkdown(el);\n' +
  'var liHTML = el.querySelector("li") ? el.querySelector("li").outerHTML.slice(0, 300) : null;\n' +
  'return JSON.stringify({ md: md.slice(0, 300), liHTML: liHTML, liTag: el.querySelector("li") ? el.querySelector("li").tagName : null });\n' +
  '})();';
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
console.log(res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 300));
c.close();
