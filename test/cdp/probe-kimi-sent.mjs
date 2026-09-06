import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const domUtilsSrc = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "dom-utils.js"), "utf8");
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const EXPR = '(function(){\n' +
  'var D = ' + JSON.stringify(domUtilsSrc) + ';\n' +
  'try { delete window.AIPanelDom; } catch (e) { window.AIPanelDom = undefined; }\n' +
  '(0, eval)(D);\n' +
  `var m = document.querySelector('.chat-content-item-assistant');
  var best = null, bestLen = 1e9;
  m.querySelectorAll('*').forEach(function (el) {
    var t = (el.textContent || '');
    if (t.indexOf('无需注册、无需 API Key') >= 0 && t.length < bestLen) { best = el; bestLen = t.length; }
  });
  if (!best) return JSON.stringify({ error: 'sentence not found' });
  var chain = [], n = best;
  for (var i = 0; i < 4 && n; i++) { chain.push(n.tagName + '.' + String(n.className || '').slice(0, 34)); n = n.parentElement; }
  var md = '';
  try { md = window.AIPanelDom.toMarkdown(best); } catch (e) { md = 'THREW ' + e.message; }
  return JSON.stringify({ textLen: bestLen, innerText: (best.innerText || '').slice(0, 200),
    chain: chain, mdLen: md.length, md: md.slice(0, 300),
    html: best.outerHTML.slice(0, 1200) }, null, 1);
})();`;
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
console.log(res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 300));
c.close();
