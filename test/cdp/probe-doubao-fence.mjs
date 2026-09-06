import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const domUtilsSrc = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "dom-utils.js"), "utf8");
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('doubao.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const EXPR = '(function(){\n' +
  'var D = ' + JSON.stringify(domUtilsSrc) + ';\n' +
  'try { delete window.AIPanelDom; } catch (e) { window.AIPanelDom = undefined; }\n' +
  '(0, eval)(D);\n' +
  `var boxes = document.querySelectorAll('[class*="md-box-root"]:not([class*="gh-user"])');
  var m = boxes[boxes.length - 1];
  var pres = m.querySelectorAll('pre');
  var p = pres[0];
  var codeEl = p.querySelector('code');
  var langEl = p.querySelector('.language, [class*="language-"]');
  var md = window.AIPanelDom.toMarkdown(p);
  return JSON.stringify({
    preCls: String(p.className).slice(0, 50),
    codeCls: codeEl ? String(codeEl.className).slice(0, 50) : null,
    langElCls: langEl ? String(langEl.className).slice(0, 50) : null,
    langInnerText: langEl ? (langEl.innerText || '').slice(0, 60) : null,
    md: md }, null, 1);
})();`;
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
const val = res.result?.result?.value;
console.log(val === undefined ? JSON.stringify(res.result).slice(0, 300) : String(val).slice(0, 1200));
c.close();
