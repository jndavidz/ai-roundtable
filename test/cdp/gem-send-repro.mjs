#!/usr/bin/env node
// 复现 gemini 发送流程, 逐步观察失败点:
// 写入 -> 读回 -> 点击发送 -> 轮询输入框文本变化
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('gemini.google.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const TEXT = '你好，这是一条扩展诊断测试消息，请忽略。';

// 1) 写入
console.log('1 fill:', await ev(`(function(){
  var ed = document.querySelector('.ql-editor[contenteditable="true"]');
  if (!ed) return 'NO_EDITOR';
  ed.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  var ok = document.execCommand('insertText', false, ${JSON.stringify(TEXT)});
  return { execOk: ok, domText: (ed.innerText || '').trim().slice(0, 40) };
})()`));
await sleep(800);

// 2) 读回 + Quill 模型痕迹
console.log('2 readback:', await ev(`(function(){
  var ed = document.querySelector('.ql-editor[contenteditable="true"]');
  var btn = document.querySelector('button[aria-label*="发送" i]') || document.querySelector('button[aria-label*="Send" i]');
  return { editorText: (ed.innerText || '').trim().slice(0, 40),
    btnDisabled: btn ? (btn.disabled || btn.getAttribute('aria-disabled')) : null,
    btnLabel: btn ? (btn.getAttribute('aria-label') || '').slice(0, 20) : null,
    btnVisible: btn ? !!btn.offsetParent : false };
})()`));

// 3) 点击发送
console.log('3 click:', await ev(`(function(){
  var btn = document.querySelector('button[aria-label*="发送" i]') || document.querySelector('button[aria-label*="Send" i]');
  if (!btn) return 'NO_BTN';
  btn.click();
  return 'CLICKED';
})()`));

// 4) 轮询观察输入框清空与新消息出现
for (let i = 0; i < 10; i++) {
  await sleep(800);
  const st = await ev(`(function(){
    var ed = document.querySelector('.ql-editor[contenteditable="true"]');
    var userMsgs = document.querySelectorAll('user-query, [class*="user-query"], [data-message-author-role="user"]').length;
    var modelResp = document.querySelectorAll('message-content, [class*="model-response"]').length;
    return { editorLen: (ed.innerText || '').trim().length, userMsgs: userMsgs, modelResp: modelResp };
  })()`);
  console.log('4 poll', (i + 1) + ':', JSON.stringify(st));
  if (st && st.editorLen === 0 && st.userMsgs > 0) { console.log('=> SENT OK'); break; }
}
c.close();
