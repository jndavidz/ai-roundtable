// 诊断豆包提取: 检查 doubao.js 的 responseSelectors 命中什么容器
import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('doubao.com'));
if (!tab) { console.log('no doubao tab'); process.exit(1); }
const src = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "doubao.js"), "utf8");
const EXPR = '(function(){\n' +
  'var SRC = ' + JSON.stringify(src) + ';\n' +
  'var captured = null;\n' +
  'window.AIPanelBase = { boot: function(){return true;}, base64ToFiles: function(){return [];}, createController: function(c){captured=c;} };\n' +
  '(0, eval)(SRC);\n' +
  `var sels = captured.responseSelectors || [];
  var out = { selectors: sels, hits: [] };
  sels.slice(0, 3).forEach(function (sel) {
    var b = document.querySelectorAll(sel);
    if (b.length) {
      var last = b[b.length - 1];
      out.hits.push({ sel: sel, count: b.length,
        lastText: (last.innerText || '').trim().slice(0, 120),
        lastCls: String(last.className || '').slice(0, 40) });
    }
  });
  return JSON.stringify(out, null, 1);
})();`;
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
console.log(res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 300));
c.close();
