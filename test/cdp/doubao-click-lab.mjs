#!/usr/bin/env node
// 终验: CDP trusted 鼠标点击豆包发送按钮(确认 chrome.debugger 方案可行性)
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

// 聚焦 + trusted 文本输入
await ev(`(function(){ var eds = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(function(e){ return e.offsetParent; }); var ed = eds[eds.length - 1]; ed.focus(); window.__ed = ed; return 'focused'; })()`);
await c.cmd('Input.insertText', { text: '对比一下 modsearch 和 dsh-web-search-pro 的适用场景差异？' });
await sleep(1000);
console.log('text in:', await ev(`(window.__ed.innerText || '').trim().slice(0, 25)`));

// 找发送按钮坐标(rounded-full 且含 svg 的那个, 取中心点)
const btn = await ev(`(function(){
  var out = null;
  document.querySelectorAll('button[class*="!rounded-full"]').forEach(function (b) {
    if (out || !b.offsetParent) return;
    var r = b.getBoundingClientRect();
    if (r.width > 20 && r.height > 20) {
      out = { x: r.x + r.width / 2, y: r.y + r.height / 2, cls: String(b.className).slice(0, 30) };
    }
  });
  return JSON.stringify(out);
})()`);
console.log('send button:', btn);
const bInfo = JSON.parse(btn);

// CDP trusted 鼠标点击
await c.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(bInfo.x), y: Math.round(bInfo.y), button: 'left', clickCount: 1 });
await c.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(bInfo.x), y: Math.round(bInfo.y), button: 'left', clickCount: 1 });
console.log('trusted click dispatched at', Math.round(bInfo.x), Math.round(bInfo.y));

let sent = false;
for (let i = 0; i < 8; i++) {
  await sleep(900);
  const st = await ev(`(function(){
    var ed = window.__ed;
    var nb = document.querySelectorAll('[class*="md-box-root"]:not([class*="gh-user"])');
    var last = nb.length ? (nb[nb.length - 1].innerText || '').trim().slice(0, 30) : '';
    return { editorLen: ed ? (ed.innerText || '').trim().length : -1, lastBox: last };
  })()`);
  console.log('poll', (i + 1) + ':', st);
  const info = JSON.parse(st);
  if (info.editorLen === 0) { sent = true; console.log('=> TRUSTED CLICK SENT ✓ — chrome.debugger 方案可行'); break; }
}
if (!sent) console.log('=> trusted click 也无效');
c.close();
