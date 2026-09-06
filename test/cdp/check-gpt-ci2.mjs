// 在用户当前 chatgpt 标签: 打开设置→个性化→自定义指令, 读取后 Esc 关闭
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatgpt.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

// 1) 打开个人资料菜单
console.log('1:', await ev(`(function(){
  var btn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-testid') || '')).includes('个人资料'));
  if (!btn) return 'NO_PROFILE';
  btn.click(); return 'OPENED';
})()`));
await sleep(1500);
// 2) 点设置
console.log('2:', await ev(`(function(){
  var items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] button, [role="dialog"] a, [role="dialog"] button'));
  var s = items.find(b => /^(设置|Settings)/.test((b.innerText || '').trim()));
  if (!s) return 'MENU: ' + items.slice(0, 10).map(b => (b.innerText || '').trim().slice(0, 14)).join('|');
  s.click(); return 'SETTINGS';
})()`));
await sleep(2000);
// 3) 点个性化
console.log('3:', await ev(`(function(){
  var items = Array.from(document.querySelectorAll('[role="dialog"] button, [role="dialog"] a, [data-testid*="settings-section"] *'));
  var p = items.find(b => /个性化|Personalization/.test(b.innerText || ''));
  if (!p) return 'SECTIONS: ' + items.slice(0, 14).map(b => (b.innerText || '').trim().slice(0, 12)).join('|');
  p.click(); return 'PERSONALIZATION';
})()`));
await sleep(1800);
// 4) 点自定义指令
console.log('4:', await ev(`(function(){
  var items = Array.from(document.querySelectorAll('[role="dialog"] button, [role="dialog"] a, [role="dialog"] [role="row"], [role="dialog"] div[class*="cursor"]'));
  var ci = items.find(b => /自定义指令|Customize ChatGPT|Custom instructions/.test(b.innerText || ''));
  if (!ci) return 'ROWS: ' + items.slice(0, 14).map(b => (b.innerText || '').trim().slice(0, 12)).join('|');
  ci.click(); return 'CI_PAGE';
})()`));
await sleep(2500);
// 5) 读文本域
console.log('5:', await ev(`(function(){
  var tas = Array.from(document.querySelectorAll('textarea'));
  return JSON.stringify({ count: tas.length,
    box1: tas[0] ? (tas[0].value || '(空)').slice(0, 600) : null,
    box2: tas[1] ? (tas[1].value || '(空)').slice(0, 600) : null });
})()`));
// 6) Esc 关闭面板
await c.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await c.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(500);
await c.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await c.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
console.log('6: panel closed (Esc)');
c.close();
