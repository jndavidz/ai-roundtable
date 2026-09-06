import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const domUtilsSrc = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "dom-utils.js"), "utf8");
const EXPR = `(function () {
  try { delete window.AIPanelDom; } catch (e) { window.AIPanelDom = undefined; }
  (0, eval)(${JSON.stringify(domUtilsSrc)});
  var blocks = document.querySelectorAll('.answer-content-wrap .code-no-artifacts');
  var out = [];
  Array.from(blocks).forEach(function (b) {
    var md = window.AIPanelDom.toMarkdown(b);
    var codeEl = b.querySelector('code');
    out.push({
      cls: String(b.className).slice(0, 30),
      liveInnerText: (b.innerText || '').length,
      cloneInnerText: (b.cloneNode(true).innerText || '').length,
      cloneTextContent: (b.cloneNode(true).textContent || '').length,
      hasCode: !!codeEl,
      codeLive: codeEl ? (codeEl.innerText || '').length : -1,
      codeClone: codeEl ? (codeEl.cloneNode(true).innerText || '').length : -1,
      mdLen: md.length,
      mdHead: md.slice(0, 60)
    });
  });
  return JSON.stringify(out, null, 1);
})();`;
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatglm.cn'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
console.log(res.result?.result?.value);
c.close();
