#!/usr/bin/env node
// kimi 编辑器清空方式实验: 找出可靠清空(当前叠加 3 遍 = 清空失效导致重写变追加)
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com') && t.url.includes('/chat/'));
if (!tab) { console.log('no kimi chat tab'); process.exit(1); }
await new Promise((res) => {
  const req = http.get({ host: '127.0.0.1', port: 9223, path: '/json/activate/' + tab.id }, r => { r.resume(); r.on('end', () => res()); });
  req.on('error', () => res()); req.setTimeout(3000, () => { req.destroy(); res(); });
});
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(1500);
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

// 编辑器定位
console.log('editor:', await ev(`(function(){
  var eds = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(function(e){ return e.offsetParent; });
  var ed = eds[eds.length - 1];
  if (!ed) return 'NO_EDITOR';
  window.__ed = ed;
  return JSON.stringify({ tag: ed.tagName, cls: String(ed.className || '').slice(0, 60),
    current: (ed.innerText || '').slice(0, 60), len: (ed.innerText || '').length });
})()`));

const read = async (label) => console.log(label, await ev(`(function(){ var t = (window.__ed.innerText || ''); return JSON.stringify({ len: t.length, head: t.slice(0, 50) }); })()`));

// 实验: 每种清空方式后写入 'BBB', 看是否叠加
const TEST = 'BBB';

// A) selectAll + delete (当前实现)
console.log('--- A: execCommand selectAll+delete ---');
console.log(await ev(`(function(){
  var ed = window.__ed; ed.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  return 'after-clear: ' + JSON.stringify((ed.innerText || '').slice(0, 40));
})()`));
await ev(`(function(){ window.__ed.focus(); document.execCommand('insertText', false, ${JSON.stringify(TEST)}); return 'wrote'; })()`);
await sleep(300);
await read('  A result:');

// B) innerHTML = ''
console.log('--- B: innerHTML = "" ---');
console.log(await ev(`(function(){
  var ed = window.__ed; ed.focus();
  ed.innerHTML = '';
  ed.dispatchEvent(new Event('input', { bubbles: true }));
  return 'after-clear: ' + JSON.stringify((ed.innerText || '').slice(0, 40));
})()`));
await ev(`(function(){ window.__ed.focus(); document.execCommand('insertText', false, ${JSON.stringify(TEST)}); return 'wrote'; })()`);
await sleep(300);
await read('  B result:');

// C) textContent='' + input
console.log('--- C: textContent="" + input ---');
console.log(await ev(`(function(){
  var ed = window.__ed; ed.focus();
  ed.textContent = '';
  ed.dispatchEvent(new Event('input', { bubbles: true }));
  return 'after-clear: ' + JSON.stringify((ed.innerText || '').slice(0, 40));
})()`));
await ev(`(function(){ window.__ed.focus(); document.execCommand('insertText', false, ${JSON.stringify(TEST)}); return 'wrote'; })()`);
await sleep(300);
await read('  C result:');

// D) SelectAll 键盘事件(trusted-like) + Backspace
console.log('--- D: keyboard Ctrl+A then Backspace ---');
console.log(await ev(`(function(){
  var ed = window.__ed; ed.focus();
  ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true, bubbles: true }));
  ed.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true, bubbles: true }));
  ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true }));
  ed.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true }));
  return 'after-clear: ' + JSON.stringify((ed.innerText || '').slice(0, 40));
})()`));
await ev(`(function(){ window.__ed.focus(); document.execCommand('insertText', false, ${JSON.stringify(TEST)}); return 'wrote'; })()`);
await sleep(300);
await read('  D result:');

// 收尾: 尽力清空
console.log('cleanup:', await ev(`(function(){
  var ed = window.__ed; ed.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  ed.innerHTML = '';
  ed.dispatchEvent(new Event('input', { bubbles: true }));
  return 'final len=' + (ed.innerText || '').length;
})()`));
c.close();
