#!/usr/bin/env node
// 验证用户观察: 激活 gemini 标签后发送是否成功
// (用户观察: 只有手动点开 Gemini 标签才会激活对话)
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('gemini.google.com'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
// 1) 激活标签(模拟用户点击标签) —— 带超时兜底
await new Promise((res) => {
  const req = http.get({ host: '127.0.0.1', port: 9223, path: '/json/activate/' + tab.id }, r => { r.resume(); r.on('end', () => res()); });
  req.on('error', () => res());
  req.setTimeout(3000, () => { req.destroy(); res(); });
});
console.log('1 tab activated (or timeout-fallback)');
await sleep(1500);

const c = await cdp(tab.webSocketDebuggerUrl);
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const TEXT = '你好，这是激活标签后的发送测试，请忽略。';

// 2) Quill API 写入(标签已在前台)
console.log('2 quill set:', await ev(`(function(){
  var ra = document.querySelector('rich-textarea');
  var q = ra && ra.__quill;
  if (!q) return 'NO_QUILL';
  q.setText(${JSON.stringify(TEXT)});
  var ed = document.querySelector('.ql-editor[contenteditable="true"]');
  return { domText: (ed.innerText || '').trim().slice(0, 30) };
})()`));
await sleep(1000);

// 3) 点发送
console.log('3 click:', await ev(`(function(){
  var btn = document.querySelector('button[aria-label*="发送" i]') || document.querySelector('button[aria-label*="Send" i]');
  if (!btn) return 'NO_BTN';
  btn.click();
  return 'CLICKED';
})()`));

// 4) 观察发送
let sent = false;
for (let i = 0; i < 8; i++) {
  await sleep(800);
  const st = await ev(`(function(){
    var ed = document.querySelector('.ql-editor[contenteditable="true"]');
    var userMsgs = document.querySelectorAll('user-query, [class*="user-query"]').length;
    return { editorLen: (ed.innerText || '').trim().length, userMsgs: userMsgs, focused: document.hasFocus(), visible: document.visibilityState };
  })()`);
  console.log('4 poll', (i + 1) + ':', JSON.stringify(st));
  if (st && st.editorLen === 0 && st.userMsgs > 0) { sent = true; console.log('=> SENT OK ✓'); break; }
}
if (!sent) console.log('=> 仍失败');
c.close();
