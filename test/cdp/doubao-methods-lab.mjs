#!/usr/bin/env node
// 豆包实验2: visible 下确定有效发送方式
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
console.log('visibility:', await ev(`document.visibilityState`));

// 写入
console.log('fill:', await ev(`(function(){
  var eds = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(function(e){ return e.offsetParent; });
  var ed = eds[eds.length - 1];
  if (!ed) return 'NO_EDITOR';
  window.__ed = ed;
  ed.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  document.execCommand('insertText', false, '豆包发送方式诊断，请回复任意内容。');
  return { text: (ed.innerText || '').trim().slice(0, 25) };
})()`));
await sleep(600);

// 列出输入框邻近的按钮(含内部结构)
console.log('nearby buttons:', await ev(`(function(){
  var ed = window.__ed;
  var out = [];
  var n = ed, depth = 0;
  while (n && depth < 8) {
    n = n.parentElement;
    depth++;
    if (!n) break;
    Array.from(n.querySelectorAll('button')).forEach(function (b) {
      if (out.length >= 6) return;
      var svgIcon = b.querySelector('svg');
      var iconPath = svgIcon ? (svgIcon.querySelector('path') ? svgIcon.querySelector('path').getAttribute('d') : '').slice(0, 20) : '';
      out.push({ depth: depth, cls: String(b.className || '').slice(0, 40), aria: b.getAttribute('aria-label') || '',
        disabled: b.disabled || b.getAttribute('aria-disabled') || null,
        type: b.getAttribute('type') || null, svg: !!svgIcon, icon: iconPath,
        text: (b.innerText || '').trim().slice(0, 12) });
    });
  }
  return JSON.stringify(out, null, 1);
})()`));

// 方法A: 点击输入框附近的最后一个 SVG 按钮(发送图标通常是箭头)
console.log('A click nearby:', await ev(`(function(){
  var ed = window.__ed;
  var n = ed;
  var btn = null;
  for (var d = 0; d < 8 && n && !btn; d++) {
    n = n.parentElement;
    if (!n) break;
    var bs = Array.from(n.querySelectorAll('button')).filter(function (b) { return b.offsetParent && b.querySelector('svg'); });
    if (bs.length) btn = bs[bs.length - 1];
  }
  if (!btn) return 'NO_BTN';
  window.__btn = btn;
  btn.click();
  return 'CLICKED cls=' + String(btn.className || '').slice(0, 30);
})()`));
await sleep(1500);
console.log('A result:', await ev(`(function(){
  var ed = window.__ed;
  return JSON.stringify({ editorLen: (ed.innerText || '').trim().length,
    userBoxes: document.querySelectorAll('[class*="md-box-root"][class*="gh-user"]').length });
})()`));

// 方法B(若 A 未清空): Enter 派发(带 keyCode/keyCode 完整参数)
console.log('B enter:', await ev(`(function(){
  var ed = window.__ed;
  if ((ed.innerText || '').trim().length === 0) return 'ALREADY_SENT';
  ed.focus();
  var opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  ed.dispatchEvent(new KeyboardEvent('keydown', opts));
  ed.dispatchEvent(new KeyboardEvent('keypress', opts));
  ed.dispatchEvent(new KeyboardEvent('keyup', opts));
  return 'ENTER_DISPATCHED';
})()`));
await sleep(2000);
console.log('B result:', await ev(`(function(){
  var ed = window.__ed;
  return JSON.stringify({ editorLen: (ed.innerText || '').trim().length,
    userBoxes: document.querySelectorAll('[class*="md-box-root"][class*="gh-user"]').length });
})()`));
c.close();
