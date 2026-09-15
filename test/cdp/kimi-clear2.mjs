import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com') && t.url.includes('/chat/'));
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

console.log('0 before:', await ev(`(function(){ var eds=Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(function(e){return e.offsetParent;}); window.__ed=eds[eds.length-1]; return JSON.stringify({len:(window.__ed.innerText||'').length}); })()`));

// D: 合成键盘 Ctrl+A + Backspace
console.log('D keyboard:', await ev(`(function(){
  var ed = window.__ed; ed.focus();
  var mk = function(type, opts) { return new KeyboardEvent(type, Object.assign({ bubbles: true, cancelable: true }, opts)); };
  ed.dispatchEvent(mk('keydown', { key:'a', code:'KeyA', keyCode:65, which:65, ctrlKey:true }));
  ed.dispatchEvent(mk('keyup', { key:'a', code:'KeyA', keyCode:65, which:65, ctrlKey:true }));
  ed.dispatchEvent(mk('keydown', { key:'Backspace', code:'Backspace', keyCode:8, which:8 }));
  ed.dispatchEvent(mk('keyup', { key:'Backspace', code:'Backspace', keyCode:8, which:8 }));
  return 'dispatched';
})()`));
await sleep(800);
console.log('D after:', await ev(`JSON.stringify({len:(window.__ed.innerText||'').length, raw: JSON.stringify((window.__ed.innerText||'').slice(0,30))})`));

// E: Range 选区 + execCommand delete
console.log('E range-select:', await ev(`(function(){
  var ed = window.__ed; ed.focus();
  var range = document.createRange();
  range.selectNodeContents(ed);
  var sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  document.execCommand('delete', false, null);
  return 'dispatched';
})()`));
await sleep(800);
console.log('E after:', await ev(`JSON.stringify({len:(window.__ed.innerText||'').length, raw: JSON.stringify((window.__ed.innerText||'').slice(0,30))})`));

// F: innerHTML 清空 + input 事件(等待 Vue 回滚观察)
console.log('F innerHTML:', await ev(`(function(){
  var ed = window.__ed; ed.focus();
  ed.innerHTML = '';
  ed.dispatchEvent(new Event('input', { bubbles: true }));
  return 'dispatched';
})()`));
await sleep(800);
console.log('F after 800ms:', await ev(`JSON.stringify({len:(window.__ed.innerText||'').length})`));
await sleep(1500);
console.log('F after 2.3s:', await ev(`JSON.stringify({len:(window.__ed.innerText||'').length, raw: JSON.stringify((window.__ed.innerText||'').slice(0,30))})`));
c.close();
