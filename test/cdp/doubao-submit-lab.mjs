#!/usr/bin/env node
// 豆包提交复现: 激活标签 -> 写入 -> 按豆包选择器找按钮 -> 点击 -> 观察
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('doubao.com'));
if (!tab) { console.log('no doubao tab'); process.exit(1); }
// 激活标签
await new Promise((res) => {
  const req = http.get({ host: '127.0.0.1', port: 9223, path: '/json/activate/' + tab.id }, r => { r.resume(); r.on('end', () => res()); });
  req.on('error', () => res()); req.setTimeout(3000, () => { req.destroy(); res(); });
});
console.log('0 tab activated');
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2000);
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const TEXT = '豆包提交链路诊断测试，请回复任意内容。';

// 1) 可见性
console.log('1 state:', await ev(`JSON.stringify({ visibility: document.visibilityState, focused: document.hasFocus() })`));

// 2) 写入
console.log('2 fill:', await ev(`(function(){
  var eds = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(function(e){ return e.offsetParent; });
  var ed = eds[eds.length - 1];
  if (!ed) return 'NO_EDITOR';
  window.__ed = ed;
  ed.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  var ok = document.execCommand('insertText', false, ${JSON.stringify(TEXT)});
  return { execOk: ok, text: (ed.innerText || '').trim().slice(0, 30) };
})()`));
await sleep(800);

// 3) 按豆包选择器找按钮
console.log('3 buttons:', await ev(`(function(){
  var sels = ['button[class*="rounded-dbx"]', 'button[class*="size-36"]', 'button[class*="!rounded-full"]',
    'button[aria-label*="发送"]', 'button[aria-label*="Send"]', 'button[type="submit"]'];
  var out = [];
  sels.forEach(function (sel) {
    var els = document.querySelectorAll(sel);
    var vis = Array.prototype.filter.call(els, function (b) { return b.offsetParent; });
    if (els.length) out.push({ sel: sel, n: els.length, visible: vis.length,
      aria: vis.length ? (vis[0].getAttribute('aria-label') || '').slice(0, 16) : '',
      disabled: vis.length ? (vis[0].disabled || vis[0].getAttribute('aria-disabled')) : null });
  });
  return JSON.stringify(out, null, 1);
})()`));

// 4) 点击发送按钮(优先 aria 发送)
console.log('4 click:', await ev(`(function(){
  var btn = document.querySelector('button[aria-label*="发送"]') || document.querySelector('button[aria-label*="Send"]');
  if (!btn || !btn.offsetParent) return 'NO_VISIBLE_BTN';
  window.__btn = btn;
  btn.click();
  return 'CLICKED aria=' + (btn.getAttribute('aria-label') || '');
})()`));

// 5) 轮询观察
for (let i = 0; i < 8; i++) {
  await sleep(800);
  const st = await ev(`(function(){
    var ed = window.__ed;
    var userBoxes = document.querySelectorAll('[class*="md-box-root"][class*="gh-user"]').length;
    return { editorLen: (ed.innerText || '').trim().length, userBoxes: userBoxes };
  })()`);
  console.log('5 poll', (i + 1) + ':', JSON.stringify(st));
  const info = JSON.parse(st);
  if (info.editorLen === 0) { console.log('=> 输入框已清空（发送动作发生了）'); break; }
}
c.close();
