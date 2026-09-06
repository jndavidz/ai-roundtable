#!/usr/bin/env node
// 实验: 让 gemini 的 Quill 编辑器真正同步输入
// 方法A: 纯 beforeinput 事件(让 Quill 自己处理插入)
// 方法B: 找 Quill/Angular 组件实例直接调 API
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('gemini.google.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

// 先清掉上次实验残留(点发送没发出去, 文本还在)
console.log('0 clear:', await ev(`(function(){
  var ed = document.querySelector('.ql-editor[contenteditable="true"]');
  ed.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  return 'cleared, len=' + (ed.innerText || '').trim().length;
})()`));
await sleep(500);

// 方法A: beforeinput 让 Quill 自己插入
console.log('A beforeinput:', await ev(`(function(){
  var ed = document.querySelector('.ql-editor[contenteditable="true"]');
  ed.focus();
  var e = new InputEvent('beforeinput', { bubbles: true, cancelable: true,
    inputType: 'insertText', data: '测试A' });
  var notCancelled = ed.dispatchEvent(e);
  return { notCancelled: notCancelled, domAfter: (ed.innerText || '').trim().slice(0, 20) };
})()`));
await sleep(800);
console.log('A result:', await ev(`(function(){
  var ed = document.querySelector('.ql-editor[contenteditable="true"]');
  return (ed.innerText || '').trim().slice(0, 30);
})()`));

// 方法B: 探测 Quill 实例 / Angular 组件
console.log('B probe:', await ev(`(function(){
  var ed = document.querySelector('.ql-editor[contenteditable="true"]');
  var out = { ownKeys: Object.keys(ed).slice(0, 10) };
  var parent = ed.closest('rich-textarea');
  out.parentKeys = parent ? Object.keys(parent).slice(0, 10) : null;
  // Angular 组件实例(ng.devmode)
  try {
    var comp = ng.getComponent(parent || ed);
    if (comp) {
      out.angularComp = Object.keys(comp).slice(0, 15);
      // 找 quill 实例
      for (var k of Object.keys(comp)) {
        if (comp[k] && comp[k].constructor && /Quill/i.test(comp[k].constructor.name)) out.quillFound = k;
      }
    }
  } catch (e) { out.ngErr = e.message; }
  return JSON.stringify(out);
})()`));
c.close();
