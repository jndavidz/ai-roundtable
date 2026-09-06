// 开新标签页检查 ChatGPT 自定义指令设置(读完即关, 不动用户当前页面)
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);

const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const main = tabs.find(t => t.type === 'page' && t.url.includes('chatgpt.com'));

// 用主 tab 的 ws 开新标签(Target.createTarget 挂在 browser 级; 通过 page 的 ws 不行)
// cdp-helper 连的是 page 级 ws —— 改用 /json/new 开新标签(HTTP API)
const newTab = await new Promise((res) => {
  const req = http.request({ host: '127.0.0.1', port: 9223, path: '/json/new?https://chatgpt.com/', method: 'PUT' }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
  });
  req.on('error', () => res(null));
  req.end();
});
if (!newTab) { console.log('failed to open new tab'); process.exit(1); }
console.log('new tab:', newTab.id);
await new Promise(r => setTimeout(r, 6000));

const c = await cdp(newTab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ev(expr) {
  const r = await c.cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
}

// 打开设置面板: ChatGPT 支持键盘快捷键/URL; 先试 profile 按钮
const steps = [
  // 1) 点 profile/头像按钮
  `(function(){
     var btn = document.querySelector('[data-testid="profile-button"], [aria-label*="Profile"], [id="profile-button"], button[aria-haspopup="menu"][class*="truncate"]');
     if (!btn) return 'NO_PROFILE_BTN';
     btn.click(); return 'CLICKED';
   })()`
];
for (const s of steps) console.log(await ev(s));
await sleep(1500);
console.log(await ev(`(function(){
   var items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] button, [role="dialog"] button'));
   var settings = items.find(b => /设置|Settings/i.test(b.innerText || ''));
   if (!settings) return 'NO_SETTINGS_ITEM: ' + items.slice(0, 8).map(b => (b.innerText || '').trim().slice(0, 20)).join(' | ');
   settings.click(); return 'SETTINGS_CLICKED';
 })()`));
await sleep(2000);
console.log(await ev(`(function(){
   var links = Array.from(document.querySelectorAll('[role="dialog"] a, [role="dialog"] button, [data-testid*="settings"] *, a[href*="settings"]'));
   var pers = links.find(b => /个性化|Personalization|Custom/i.test(b.innerText || b.getAttribute('href') || ''));
   if (!pers) return 'NO_PERSONALIZATION: ' + Array.from(document.querySelectorAll('[role="dialog"] a, [role="dialog"] button')).slice(0, 12).map(b => (b.innerText || '').trim().slice(0, 16)).join(' | ');
   pers.click(); return 'PERS_CLICKED';
 })()`));
await sleep(2000);
console.log(await ev(`(function(){
   var links = Array.from(document.querySelectorAll('[role="dialog"] a, [role="dialog"] button'));
   var ci = links.find(b => /自定义指令|Customize/i.test(b.innerText || ''));
   if (!ci) return 'NO_CI_LINK: ' + links.slice(0, 12).map(b => (b.innerText || '').trim().slice(0, 16)).join(' | ');
   ci.click(); return 'CI_CLICKED';
 })()`));
await sleep(2500);
const text = await ev(`(function(){
   var tas = Array.from(document.querySelectorAll('textarea'));
   var dlg = document.querySelector('[role="dialog"]');
   return JSON.stringify({
     textareas: tas.map(function (t) { return (t.value || '').slice(0, 400); }),
     dialogHead: dlg ? (dlg.innerText || '').slice(0, 200) : null
   });
 })()`);
console.log('INSTRUCTIONS:', text);
c.close();
// 关闭新标签
await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/close/' + newTab.id }, r => { let d=''; r.on('data', ()=>{}); r.on('end', () => res()); }); });
console.log('new tab closed');
