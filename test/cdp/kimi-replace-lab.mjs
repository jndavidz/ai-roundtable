import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com') && t.url.includes('/chat/'));
const c = await cdp(tab.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (e) => (await c.cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const A = 'AAAAAAAAAA';
const B = 'BBBBBBBBBB';

// 准备: 写入 3 份 A 模拟叠加状态
console.log('setup:', await ev(`(function(){
  var ed = document.querySelector('.chat-input-editor'); window.__ed = ed; ed.focus();
  document.execCommand('insertText', false, ${JSON.stringify(A)});
  document.execCommand('insertText', false, ${JSON.stringify(A)});
  document.execCommand('insertText', false, ${JSON.stringify(A)});
  return JSON.stringify({ len: (ed.innerText||'').length, t: (ed.innerText||'').slice(0,40) });
})()`));
await sleep(800);
console.log('setup after:', await ev(`JSON.stringify({len:(window.__ed.innerText||'').length})`));

// 方案X: Range 全选 + insertText(一步替换)
console.log('X range+insertText:', await ev(`(function(){
  var ed = window.__ed; ed.focus();
  var range = document.createRange();
  range.selectNodeContents(ed);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  var ok = document.execCommand('insertText', false, ${JSON.stringify(B)});
  return JSON.stringify({ execOk: ok, lenNow: (ed.innerText||'').length });
})()`));
await sleep(900);
console.log('X after 900ms:', await ev(`JSON.stringify({len:(window.__ed.innerText||'').length, t:(window.__ed.innerText||'').slice(0,40)})`));

// 再叠 3 份 A, 用方案Y(清空+等待+插入)对比
console.log('setup2:', await ev(`(function(){
  var ed = window.__ed; ed.focus();
  document.execCommand('insertText', false, ${JSON.stringify(A)});
  document.execCommand('insertText', false, ${JSON.stringify(A)});
  document.execCommand('insertText', false, ${JSON.stringify(A)});
  return JSON.stringify({ len: (ed.innerText||'').length });
})()`));
await sleep(900);
console.log('Y clear+wait+insert:', await ev(`(async function(){
  var ed = window.__ed; ed.focus();
  var mk = function(t, o) { return new KeyboardEvent(t, Object.assign({bubbles:true,cancelable:true}, o)); };
  ed.dispatchEvent(mk('keydown', {key:'a',code:'KeyA',keyCode:65,which:65,ctrlKey:true}));
  ed.dispatchEvent(mk('keyup', {key:'a',code:'KeyA',keyCode:65,which:65,ctrlKey:true}));
  ed.dispatchEvent(mk('keydown', {key:'Backspace',code:'Backspace',keyCode:8,which:8}));
  ed.dispatchEvent(mk('keyup', {key:'Backspace',code:'Backspace',keyCode:8,which:8}));
  await new Promise(function(r){ setTimeout(r, 500); });
  var afterClear = (ed.innerText||'').length;
  document.execCommand('insertText', false, ${JSON.stringify(B)});
  await new Promise(function(r){ setTimeout(r, 500); });
  return JSON.stringify({ afterClear: afterClear, finalLen: (ed.innerText||'').length, t: (ed.innerText||'').slice(0,40) });
})()`));

// 收尾
await ev(`(function(){ var ed=window.__ed; ed.focus(); var r=document.createRange(); r.selectNodeContents(ed); var s=window.getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('delete',false,null); return 'done'; })()`);
c.close();
