#!/usr/bin/env node
// 实验: gemini Quill 多段文本写入 — 一次性 insertText vs 逐段 insertText+insertParagraph
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('gemini.google.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

// 激活(避免 hidden 干扰)
await new Promise((res) => {
  const req = http.get({ host: '127.0.0.1', port: 9223, path: '/json/activate/' + tab.id }, r => { r.resume(); r.on('end', () => res()); });
  req.on('error', () => res()); req.setTimeout(3000, () => { req.destroy(); res(); });
});
await sleep(1500);

const MULTI = '第一段测试内容，用于验证多段写入。\n第二段：包含换行后的文字。\n\n第四行：空行之后。';

// A) 一次性 insertText
console.log('A one-shot:', await ev(`(function(){
  var ed = document.querySelector('.ql-editor[contenteditable="true"]');
  ed.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  document.execCommand('insertText', false, ${JSON.stringify(MULTI)});
  var t = (ed.innerText || '');
  return JSON.stringify({ len: t.length, lines: t.split('\\n').length, text: t.slice(0, 120) });
})()`));
await sleep(500);

// B) 逐段 insertText + insertParagraph
console.log('B per-line:', await ev(`(function(){
  var ed = document.querySelector('.ql-editor[contenteditable="true"]');
  ed.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  var lines = ${JSON.stringify(MULTI)}.split('\\n');
  for (var i = 0; i < lines.length; i++) {
    if (i > 0) {
      var okP = document.execCommand('insertParagraph', false, null);
      if (!okP) document.execCommand('insertLineBreak', false, null);
    }
    if (lines[i]) document.execCommand('insertText', false, lines[i]);
  }
  var t = (ed.innerText || '');
  return JSON.stringify({ len: t.length, lines: t.split('\\n').length, text: t.slice(0, 160) });
})()`));
await sleep(500);

// C) 清空收尾
console.log('C clear:', await ev(`(function(){
  var ed = document.querySelector('.ql-editor[contenteditable="true"]');
  ed.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  return 'cleared, len=' + (ed.innerText || '').trim().length;
})()`));

// D) kimi 用户消息全量清点
const kimi = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com') && t.url.includes('/chat/'));
if (kimi) {
  console.log('\n===== kimi 用户消息清点 =====');
  const kc = await cdp(kimi.webSocketDebuggerUrl);
  const kres = await kc.cmd('Runtime.evaluate', {
    expression: `(function(){
      var sels = ['[class*="chat-content-item-user"]', '[class*="item-user"]', '[class*="segment-user"]'];
      var out = {};
      sels.forEach(function (sel) {
        var els = document.querySelectorAll(sel);
        out[sel] = { n: els.length, texts: Array.prototype.slice.call(els, 0, 6).map(function (e) { return (e.innerText || '').trim().slice(0, 40); }) };
      });
      return JSON.stringify(out, null, 1);
    })()`,
    returnByValue: true });
  console.log(kres.result?.result?.value ?? 'none');
  kc.close();
}
c.close();
