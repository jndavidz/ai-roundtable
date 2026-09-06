import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatgpt.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
console.log('open:', await ev(`(function(){
  var btn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => ((b.getAttribute('aria-label') || '') + (b.getAttribute('data-testid') || '')).includes('个人资料'));
  btn.click(); return 'OK';
})()`));
await sleep(1500);
console.log(await ev(`(function(){
  // 找所有可见的、含文本的小元素(菜单项特征)
  var els = Array.from(document.querySelectorAll('a, button, [role="menuitem"], div[tabindex], li')).filter(function (e) {
    var t = (e.innerText || '').trim();
    return t && t.length < 30 && e.offsetParent;
  });
  return JSON.stringify(els.slice(-25).map(function (e) {
    return e.tagName + (e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : '') + ':' + (e.innerText || '').trim().slice(0, 22);
  }));
})()`));
// Esc 收尾
await c.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await c.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
c.close();
console.log('closed');
