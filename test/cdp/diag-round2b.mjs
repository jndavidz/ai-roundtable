import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });

// kimi 对话页(排除 pricing)
const kimiChat = tabs.filter(t => t.type === 'page' && t.url.includes('kimi.com') && t.url.includes('/chat/'));
for (const tab of kimiChat) {
  console.log(`===== kimi 对话页 (${tab.url.slice(30, 75)}) =====`);
  const c = await cdp(tab.webSocketDebuggerUrl);
  const res = await c.cmd('Runtime.evaluate', {
    expression: `(function(){
      var eds = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(function(e){ return e.offsetParent; });
      var ed = eds[eds.length - 1] || null;
      var userMsgs = document.querySelectorAll('[class*="chat-content-item-user"]');
      var lastTwo = [];
      for (var i = Math.max(0, userMsgs.length - 2); i < userMsgs.length; i++) {
        lastTwo.push((userMsgs[i].innerText || '').trim().slice(0, 40));
      }
      return JSON.stringify({ visibility: document.visibilityState,
        editorText: ed ? (ed.innerText || '').trim().slice(0, 50) : null,
        userMsgCount: userMsgs.length, lastTwo: lastTwo,
        paywallVisible: !!document.querySelector('[class*="paywall"], [class*="upgrade-membership"]') });
    })()`,
    returnByValue: true });
  console.log(' ', res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 200));
  c.close();
}

// doubao / gemini 详情
for (const [host, userSel] of [['doubao.com', '[class*="md-box-root"][class*="gh-user"]'], ['gemini.google.com', 'user-query']]) {
  const tab = tabs.find(t => t.type === 'page' && t.url.includes(host));
  if (!tab) continue;
  console.log(`===== ${host} =====`);
  const c = await cdp(tab.webSocketDebuggerUrl);
  const res = await c.cmd('Runtime.evaluate', {
    expression: `(function(){
      var ed = document.querySelector('div[contenteditable="true"], .ql-editor[contenteditable="true"]');
      var users = document.querySelectorAll(${JSON.stringify(userSel)});
      var lastUser = users.length ? (users[users.length - 1].innerText || '').trim().slice(0, 40) : null;
      return JSON.stringify({ visibility: document.visibilityState,
        editorText: ed ? (ed.innerText || '').trim().slice(0, 50) : null,
        userMsgCount: users.length, lastUser: lastUser });
    })()`,
    returnByValue: true });
  console.log(' ', res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 200));
  c.close();
}
console.log('done');
