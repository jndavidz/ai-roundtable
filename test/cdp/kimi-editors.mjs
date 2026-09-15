import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const domUtilsSrc = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "dom-utils.js"), "utf8");
const kimiSrc = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "kimi.js"), "utf8");
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com') && t.url.includes('/chat/'));
const c = await cdp(tab.webSocketDebuggerUrl);
const EXPR = '(function(){\n' +
  'var D = ' + JSON.stringify(domUtilsSrc) + ';\n' +
  'try { delete window.AIPanelDom; } catch (e) { window.AIPanelDom = undefined; }\n' +
  '(0, eval)(D);\n' +
  'var KS = ' + JSON.stringify(kimiSrc) + ';\n' +
  'var captured = null;\n' +
  'window.AIPanelBase = { boot: function(){return true;}, base64ToFiles: function(){return [];}, createController: function(cfg){ captured = cfg; } };\n' +
  '(0, eval)(KS);\n' +
  `var sels = captured.inputSelectors || [];
  var listed = [];
  sels.forEach(function (sel, si) {
    var els = document.querySelectorAll(sel);
    if (!els.length) return;
    Array.prototype.forEach.call(els, function (el, i) {
      listed.push({ sel: sel, selIdx: si, elIdx: i, cls: String(el.className || '').slice(0, 40),
        visible: !!el.offsetParent, len: (el.innerText || '').length, head: (el.innerText || '').slice(0, 25) });
    });
  });
  var picked = window.AIPanelDom.findInputField(sels, { preferBottom: true });
  return JSON.stringify({ listed: listed, picked: picked ? { cls: String(picked.className || '').slice(0, 40), len: (picked.innerText || '').length } : null }, null, 1);
})();`;
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
console.log(res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 300));
c.close();
