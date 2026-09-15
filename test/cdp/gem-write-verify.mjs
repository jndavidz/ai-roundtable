import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const domUtilsSrc = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "dom-utils.js"), "utf8");
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('gemini.google.com'));
await new Promise((res) => {
  const req = http.get({ host: '127.0.0.1', port: 9223, path: '/json/activate/' + tab.id }, r => { r.resume(); r.on('end', () => res()); });
  req.on('error', () => res()); req.setTimeout(3000, () => { req.destroy(); res(); });
});
const c = await cdp(tab.webSocketDebuggerUrl);
const MULTI = '第一段：群晖DS416play方案。\n第二段：继续说明细节。\n第三段：收尾。';
const EXPR = '(async function(){\n' +
  'var D = ' + JSON.stringify(domUtilsSrc) + ';\n' +
  'try { delete window.AIPanelDom; } catch (e) { window.AIPanelDom = undefined; }\n' +
  '(0, eval)(D);\n' +
  'var ed = document.querySelector(".ql-editor[contenteditable=\'true\']");\n' +
  'if (!ed) return "NO_EDITOR";\n' +
  'var out = [];\n' +
  'for (var i = 0; i < 2; i++) {\n' +
  '  await window.AIPanelDom.setEditorText(ed, ' + JSON.stringify(MULTI) + ', { afterInputDelay: 300 });\n' +
  '  out.push({ round: i + 1, len: (ed.innerText || "").length, head: (ed.innerText || "").slice(0, 35) });\n' +
  '}\n' +
  'return JSON.stringify(out, null, 1);\n' +
  '})();';
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true });
console.log(res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 300));
// 收尾清空
await c.cmd('Runtime.evaluate', { expression: `(function(){ var ed=document.querySelector('.ql-editor'); ed.focus(); var r=document.createRange(); r.selectNodeContents(ed); var s=window.getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('delete',false,null); return 1; })()`, returnByValue: true });
console.log('cleanup done');
c.close();
