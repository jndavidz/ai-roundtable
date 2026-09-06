#!/usr/bin/env node
// 综合诊断: 标签全景(kimi 升级标签?) + kimi/doubao/gemini 输入框残留与对话流
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });

// 1) 标签全景(kimi 相关 + 全部非 AI 的新标签)
console.log('===== 标签全景 =====');
tabs.filter(t => t.type === 'page').forEach(t => {
  const u = t.url || '';
  if (/kimi|member|upgrade|pay|vip/i.test(u) || /kimi/i.test(t.title || '')) {
    console.log(`  [kimi相关] ${u.slice(0, 80)} | title: ${(t.title || '').slice(0, 30)}`);
  }
});
console.log('  全部标签 (' + tabs.filter(t => t.type === 'page').length + '):');
tabs.filter(t => t.type === 'page').forEach(t => console.log(`    ${(t.url || '').slice(0, 75)}`));

// 2) kimi/doubao/gemini 输入框与对话流
for (const [host, editorSel] of [
  ['kimi.com', '[contenteditable="true"]'],
  ['doubao.com', '[contenteditable="true"]'],
  ['gemini.google.com', '.ql-editor[contenteditable="true"]']
]) {
  const tab = tabs.find(t => t.type === 'page' && t.url.includes(host));
  if (!tab) { console.log(`\n===== ${host}: 无标签 =====`); continue; }
  console.log(`\n===== ${host} (${tab.url.slice(0, 50)}) =====`);
  try {
    const c = await cdp(tab.webSocketDebuggerUrl);
    const res = await c.cmd('Runtime.evaluate', {
      expression: `(function(){
        var eds = Array.from(document.querySelectorAll(${JSON.stringify(editorSel)})).filter(function(e){ return e.offsetParent; });
        var ed = eds[eds.length - 1] || null;
        var out = { visibility: document.visibilityState,
          editorText: ed ? (ed.innerText || '').trim().slice(0, 60) : null };
        // 最后 2 条用户消息
        var sels = ['[class*="gh-user"]', '[class*="user"]', 'user-query', '[class*="human"]', '[class*="question"]'];
        for (var i = 0; i < sels.length; i++) {
          var us = document.querySelectorAll(sels[i]);
          if (us.length >= 1) {
            out.userSel = sels[i]; out.userCount = us.length;
            out.lastUser = (us[us.length - 1].innerText || '').trim().slice(0, 40);
            break;
          }
        }
        return JSON.stringify(out);
      })()`,
      returnByValue: true });
    console.log('  ', res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 200));
    c.close();
  } catch (e) { console.log('  ERROR:', e.message); }
}
console.log('\ndone');
