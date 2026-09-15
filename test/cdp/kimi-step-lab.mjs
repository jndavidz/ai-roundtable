import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com') && t.url.includes('/chat/'));
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const MULTI = '第一段：群晖DS416play方案。\n第二段：继续说明细节。\n第三段：收尾。';

console.log('MULTI len:', MULTI.length);
console.log('0 initial:', await ev(`(function(){ var eds=Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(function(e){return e.offsetParent;}); window.__ed=eds[eds.length-1]; return JSON.stringify({len:(window.__ed.innerText||'').length, editors: eds.length}); })()`));

// 1) 清空
console.log('1 clear:', await ev(`(function(){
  var ed=window.__ed; ed.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  return JSON.stringify({ afterClear: (ed.innerText||'').length, raw: JSON.stringify((ed.innerText||'').slice(0,20)) });
})()`));

// 2) insertText
console.log('2 insertText:', await ev(`(function(){
  var ed=window.__ed; ed.focus();
  var ok = document.execCommand('insertText', false, ${JSON.stringify(MULTI)});
  return JSON.stringify({ execOk: ok, lenNow: (ed.innerText||'').length, head: (ed.innerText||'').slice(0,45) });
})()`));
await sleep(600);
console.log('2b after 600ms:', await ev(`JSON.stringify({ len: (window.__ed.innerText||'').length, head: (window.__ed.innerText||'').slice(0,45) })`));
await sleep(1500);
console.log('2c after 2.1s:', await ev(`JSON.stringify({ len: (window.__ed.innerText||'').length, head: (window.__ed.innerText||'').slice(0,45) })`));

// 3) 清空收尾
console.log('3 cleanup:', await ev(`(function(){ var ed=window.__ed; ed.focus(); document.execCommand('selectAll', false,null); document.execCommand('delete', false,null); return 'len=' + (ed.innerText||'').length; })()`));
c.close();
