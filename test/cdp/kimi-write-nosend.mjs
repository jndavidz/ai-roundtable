#!/usr/bin/env node
// 零副作用验证: 在 kimi 输入框连续写入 3 次(用真实 setEditorText), 读回长度
// 验证「不再叠加」——不发送消息, 最后清空
import { pathToFileURL } from "node:url";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const domUtilsSrc = fs.readFileSync(path.join("D:/repos/ai-roundtable/content", "dom-utils.js"), "utf8");
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com'));
if (!tab) { console.log('no kimi tab'); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e, awaitP) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: !!awaitP })).result?.result?.value;

const MULTI = '第一段：群晖DS416play方案。\n第二段：继续说明细节。\n第三段：收尾。';
console.log('MULTI len:', MULTI.length);

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
  '  out.push({ round: i + 1, len: (ed.innerText || "").length, head: (ed.innerText || "").slice(0, 30) });\n' +
  '}\n' +
  'return JSON.stringify(out, null, 1);\n' +
  '})();';
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true });
console.log(res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 250));

// 清空(不发消息): 键盘 Ctrl+A + Backspace
const clr = await ev(`(function(){
  var eds = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(function(e){ return e.offsetParent; });
  var ed = eds[eds.length - 1]; ed.focus();
  var mk = function(t, o) { return new KeyboardEvent(t, Object.assign({ bubbles: true, cancelable: true }, o)); };
  ed.dispatchEvent(mk('keydown', { key:'a', code:'KeyA', keyCode:65, which:65, ctrlKey:true }));
  ed.dispatchEvent(mk('keyup', { key:'a', code:'KeyA', keyCode:65, which:65, ctrlKey:true }));
  ed.dispatchEvent(mk('keydown', { key:'Backspace', code:'Backspace', keyCode:8, which:8 }));
  ed.dispatchEvent(mk('keyup', { key:'Backspace', code:'Backspace', keyCode:8, which:8 }));
  return 'clear dispatched';
})()`);
console.log(clr);
await sleep(600);
console.log('final len:', await ev(`(function(){ var eds=Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(function(e){return e.offsetParent;}); return (eds[eds.length-1].innerText || '').length; })()`));
c.close();
