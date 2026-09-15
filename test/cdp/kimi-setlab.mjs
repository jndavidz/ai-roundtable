#!/usr/bin/env node
// 验证: 用真实 setEditorText(加固版) 在 kimi 编辑器上连续写入 3 次, 检查是否叠加
import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const domUtilsSrc = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "dom-utils.js"), "utf8");
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com') && t.url.includes('/chat/'));
await new Promise((res) => {
  const req = http.get({ host: '127.0.0.1', port: 9223, path: '/json/activate/' + tab.id }, r => { r.resume(); r.on('end', () => res()); });
  req.on('error', () => res()); req.setTimeout(3000, () => { req.destroy(); res(); });
});
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(1500);

const MULTI = '第一段：群晖DS416play方案。\n第二段：继续说明细节。\n第三段：收尾。';
// 用真实 setEditorText(注入页面)
const EXPR = '(async function(){\n' +
  'var D = ' + JSON.stringify(domUtilsSrc) + ';\n' +
  'try { delete window.AIPanelDom; } catch (e) { window.AIPanelDom = undefined; }\n' +
  '(0, eval)(D);\n' +
  'var eds = Array.from(document.querySelectorAll(\'[contenteditable="true"]\')).filter(function(e){ return e.offsetParent; });\n' +
  'var ed = eds[eds.length - 1];\n' +
  'if (!ed) return "NO_EDITOR";\n' +
  'var out = [];\n' +
  'for (var i = 0; i < 3; i++) {\n' +
  '  await window.AIPanelDom.setEditorText(ed, ' + JSON.stringify(MULTI) + ', { afterInputDelay: 300 });\n' +
  '  var t = (ed.innerText || "");\n' +
  '  out.push({ round: i + 1, len: t.length, head: t.slice(0, 40) });\n' +
  '}\n' +
  'return JSON.stringify(out, null, 1);\n' +
  '})();';
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true });
console.log(res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 300));

// 收尾清空
const cl = await c.cmd('Runtime.evaluate', {
  expression: `(function(){ var eds = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(function(e){ return e.offsetParent; }); var ed = eds[eds.length-1]; ed.focus(); document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); return 'cleared len=' + (ed.innerText||'').length; })()`,
  returnByValue: true });
console.log('cleanup:', cl.result?.result?.value);
c.close();
