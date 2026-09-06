#!/usr/bin/env node
// 复现 claude 提交误报: hidden 标签下写入+点击, 观察三个验证判据的实际状态
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('claude.ai'));
if (!tab) { console.log('no claude tab'); process.exit(1); }
console.log('claude tab visibility check...');
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const TEXT = '你好，这是扩展诊断测试消息，请忽略。';

// 0) 页面状态
console.log('0 state:', await ev(`JSON.stringify({ visibility: document.visibilityState, focused: document.hasFocus() })`));

// 1) 找输入框(claude 的 ProseMirror)
console.log('1 editor:', await ev(`(function(){
  var ed = document.querySelector('div[contenteditable="true"].ProseMirror, div.ProseMirror[contenteditable="true"]');
  if (!ed) {
    var eds = Array.from(document.querySelectorAll('[contenteditable="true"]'));
    ed = eds.find(function (e) { return e.offsetParent; });
  }
  if (!ed) return 'NO_EDITOR';
  window.__dbgEditor = ed;
  return { tag: ed.tagName, cls: String(ed.className).slice(0, 40), visible: !!ed.offsetParent };
})()`));

// 2) 写入(模拟 setEditorText: focus + execCommand)
console.log('2 fill:', await ev(`(function(){
  var ed = window.__dbgEditor;
  ed.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  var ok = document.execCommand('insertText', false, ${JSON.stringify(TEXT)});
  return { execOk: ok, text: (ed.innerText || '').trim().slice(0, 30) };
})()`));
await sleep(600);

// 3) 找发送按钮(claude.js 的 submitOptions selectors)
console.log('3 button:', await ev(`(function(){
  var sels = ['button[aria-label*="Send" i]', 'button[aria-label*="发送" i]', 'button[data-testid*="send" i]'];
  var btn = null, used = '';
  for (var i = 0; i < sels.length; i++) {
    var b = document.querySelector(sels[i]);
    if (b && b.offsetParent) { btn = b; used = sels[i]; break; }
  }
  if (!btn) {
    // claude 发送按钮: 输入框附近最后一个 button
    var ed = window.__dbgEditor;
    var container = ed.closest('form') || ed.closest('div[class*="input"]') || document.body;
    var btns = Array.from(container.querySelectorAll('button')).filter(function (b) { return b.offsetParent; });
    btn = btns[btns.length - 1];
    used = 'fallback-last-btn';
  }
  window.__dbgBtn = btn;
  return { used: used, aria: (btn.getAttribute('aria-label') || '').slice(0, 24),
    disabled: btn.disabled || btn.getAttribute('aria-disabled'),
    inDom: document.contains(btn) };
})()`));

// 4) 点击并逐 400ms 观察三判据
console.log('4 click + verify:', await ev(`(function(){
  var ed = window.__dbgEditor, btn = window.__dbgBtn;
  var beforeText = (ed.innerText || '').trim();
  var beforeCount = document.querySelectorAll('[data-test-render-count], [class*="assistant"]').length;
  btn.click();
  var timeline = [];
  var t0 = Date.now();
  return new Promise(function (resolve) {
    var iv = setInterval(function () {
      var el = window.__dbgEditor;
      var b = window.__dbgBtn;
      var cur = (el && el.innerText || '').trim();
      var p1 = !!document.querySelector('[aria-label*="Stop" i], [aria-label*="停止" i], button[data-testid*="stop"]');
      var p2btn = b ? (!document.contains(b) || b.disabled || b.getAttribute('aria-disabled') === 'true') : true;
      var p3 = !cur || cur !== beforeText;
      timeline.push({ ms: Date.now() - t0, len: cur.length, p1: p1, p2btnGoneOrDisabled: p2btn, p3textChanged: p3 });
      if (timeline.length >= 8) {
        clearInterval(iv);
        resolve(JSON.stringify({ beforeText: beforeText.slice(0, 25), beforeCount: beforeCount, timeline: timeline }, null, 1));
      }
    }, 400);
  });
})()`));
c.close();
