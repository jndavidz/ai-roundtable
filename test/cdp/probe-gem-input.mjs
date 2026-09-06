// 诊断 gemini 发送失败: 检查输入框/提交按钮实际状态
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('gemini.google.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var out = { editors: [], sendBtns: [], pageState: {} };
    // 按 gemini.js 的选择器逐个测试输入框
    var editSels = ['.ql-editor[contenteditable="true"]', 'rich-textarea [contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="prompt" i]', 'div[contenteditable="true"][role="textbox"]',
      'rich-textarea textarea', 'div[contenteditable="true"]', 'textarea'];
    editSels.forEach(function (sel) {
      try {
        var els = document.querySelectorAll(sel);
        if (els.length) out.editors.push({ sel: sel, n: els.length,
          visible: !!els[0].offsetParent,
          ariaLabel: (els[0].getAttribute('aria-label') || '').slice(0, 30) });
      } catch (e) {}
    });
    // 发送按钮
    var btnSels = ['button[aria-label*="Send" i]', 'button[aria-label*="发送" i]', 'button[mattooltip*="Send" i]',
      'button[data-test-id*="send" i]', 'button[data-testid*="send" i]', '.send-button'];
    btnSels.forEach(function (sel) {
      try {
        var els = document.querySelectorAll(sel);
        if (els.length) out.sendBtns.push({ sel: sel, n: els.length, visible: !!els[0].offsetParent,
          disabled: els[0].disabled || els[0].getAttribute('aria-disabled') });
      } catch (e) {}
    });
    // 微聊输入区实际结构
    var inputArea = document.querySelector('rich-textarea, .input-area, .input-container, form');
    out.pageState.url = location.href.slice(0, 60);
    out.pageState.hasInputArea = !!inputArea;
    out.pageState.inputAreaTag = inputArea ? inputArea.tagName + '.' + String(inputArea.className || '').slice(0, 30) : null;
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 300));
c.close();
