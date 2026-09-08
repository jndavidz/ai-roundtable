#!/usr/bin/env node
// 豆包实验3: CDP trusted 输入(浏览器级事件) vs 圆形按钮定位
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('doubao.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

// 激活
await new Promise((res) => {
  const req = http.get({ host: '127.0.0.1', port: 9223, path: '/json/activate/' + tab.id }, r => { r.resume(); r.on('end', () => res()); });
  req.on('error', () => res()); req.setTimeout(3000, () => { req.destroy(); res(); });
});
await sleep(1500);

// 聚焦 + CDP 原生插入文本(trusted input)
await ev(`(function(){ var eds = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(function(e){ return e.offsetParent; }); var ed = eds[eds.length - 1]; ed.focus(); window.__ed = ed; return 'focused'; })()`);
await c.cmd('Input.insertText', { text: '帮我看一下 modsearch 和 dsh-web-search-tavily 这两个插件的主要区别是什么？' });
console.log('insert done:', await ev(`(window.__ed.innerText || '').trim().slice(0, 25)`));
await sleep(1000);

// 列出圆形按钮详情
console.log('round buttons:', await ev(`(function(){
  var out = [];
  document.querySelectorAll('button[class*="!rounded-full"], button[class*="rounded-dbx"]').forEach(function (b) {
    if (!b.offsetParent) return;
    var svg = b.querySelector('svg path');
    out.push({ cls: String(b.className || '').slice(0, 44),
      icon: svg ? svg.getAttribute('d').slice(0, 26) : '',
      disabled: b.disabled || b.getAttribute('aria-disabled') || null });
  });
  return JSON.stringify(out, null, 1);
})()`));

// CDP 真实 Enter（焦点在编辑器）
await c.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await c.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
console.log('trusted Enter dispatched');

let sent = false;
for (let i = 0; i < 8; i++) {
  await sleep(800);
  const st = await ev(`(function(){
    var ed = window.__ed;
    var userBoxes = document.querySelectorAll('[class*="md-box-root"][class*="gh-user"]').length;
    var replyHead = '';
    var nb = document.querySelectorAll('[class*="md-box-root"]:not([class*="gh-user"])');
    if (nb.length) replyHead = (nb[nb.length - 1].innerText || '').trim().slice(0, 30);
    return { editorLen: ed ? (ed.innerText || '').trim().length : -1, userBoxes: userBoxes, replyHead: replyHead };
  })()`);
  console.log('poll', (i + 1) + ':', st);
  const info = JSON.parse(st);
  if (info.userBoxes > 1 || info.replyHead.indexOf('该插件') >= 0) { sent = true; console.log('=> TRUSTED INPUT SENT ✓'); break; }
}
if (!sent) console.log('=> trusted Enter 仍无效');
c.close();
