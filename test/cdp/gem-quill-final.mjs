#!/usr/bin/env node
// 终验: __quill.setText 写入 -> 点发送 -> 观察消息真实发出
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('gemini.google.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const TEXT = '你好，这是扩展发送测试，请忽略。';

// 1) Quill API 写入
console.log('1 quill set:', await ev(`(function(){
  var ra = document.querySelector('rich-textarea');
  var q = ra && ra.__quill;
  if (!q) return 'NO_QUILL';
  q.setText(${JSON.stringify(TEXT)});
  var ed = document.querySelector('.ql-editor[contenteditable="true"]');
  return { modelSet: true, domText: (ed.innerText || '').trim().slice(0, 40) };
})()`));
await sleep(1200);

// 2) 点发送
console.log('2 click:', await ev(`(function(){
  var btn = document.querySelector('button[aria-label*="发送" i]') || document.querySelector('button[aria-label*="Send" i]');
  btn.click();
  return 'CLICKED';
})()`));

// 3) 观察发送结果
for (let i = 0; i < 8; i++) {
  await sleep(800);
  const st = await ev(`(function(){
    var ed = document.querySelector('.ql-editor[contenteditable="true"]');
    var userMsgs = document.querySelectorAll('user-query, [class*="user-query"]').length;
    return { editorLen: (ed.innerText || '').trim().length, userMsgs: userMsgs };
  })()`);
  console.log('3 poll', (i + 1) + ':', JSON.stringify(st));
  if (st && st.editorLen === 0 && st.userMsgs > 0) { console.log('=> SENT OK ✓'); break; }
}
c.close();
