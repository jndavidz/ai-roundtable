#!/usr/bin/env node
// 诊断: 1) chatgpt/grok 是否双标签  2) doubao/gemini 输入框残留与对话流状态
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });

// 1) 双标签检查
console.log('===== 标签分布 =====');
const groups = {};
tabs.filter(t => t.type === 'page').forEach(t => {
  let h = 'unknown';
  try { h = new URL(t.url).hostname.replace(/^www\./, ''); } catch (e) {}
  (groups[h] = groups[h] || []).push(t.url.slice(0, 60));
});
for (const [h, urls] of Object.entries(groups)) {
  if (urls.length > 1 || /chatgpt|grok/.test(h)) console.log(`  ${h}: ${urls.length} 个 -> ${urls.join(' | ')}`);
}

// 2) 豆包/Gemini 输入框与对话流
for (const [host, editorSel, userSel] of [
  ['doubao.com', '[contenteditable="true"]', '[class*="md-box-root"][class*="gh-user"]'],
  ['gemini.google.com', '.ql-editor[contenteditable="true"]', 'user-query']
]) {
  const tab = tabs.find(t => t.type === 'page' && t.url.includes(host));
  if (!tab) { console.log(`\n===== ${host}: 无标签 =====`); continue; }
  console.log(`\n===== ${host} =====`);
  try {
    const c = await cdp(tab.webSocketDebuggerUrl);
    const res = await c.cmd('Runtime.evaluate', {
      expression: `(function(){
        var ed = document.querySelector(${JSON.stringify(editorSel)});
        var users = document.querySelectorAll(${JSON.stringify(userSel)});
        var lastUser = users.length ? (users[users.length - 1].innerText || '').trim().slice(0, 40) : null;
        return JSON.stringify({ visibility: document.visibilityState,
          editorText: ed ? (ed.innerText || ed.value || '').trim().slice(0, 50) : null,
          userMsgCount: users.length, lastUser: lastUser });
      })()`,
      returnByValue: true });
    console.log('  ', res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 200));
    c.close();
  } catch (e) { console.log('  ERROR:', e.message); }
}
console.log('\ndone');
