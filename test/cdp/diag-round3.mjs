#!/usr/bin/env node
// 诊断三问题: 混元/gemini 写入截断 + kimi 三重重复 + claude incognito
import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }); });

console.log('===== Claude 标签 URL(incognito?) =====');
tabs.filter(t => t.type === 'page' && /claude\.ai/.test(t.url)).forEach(t => {
  console.log(`  ${t.url}`);
});

console.log('\n===== kimi 标签 =====');
tabs.filter(t => t.type === 'page' && /kimi\.com/.test(t.url)).forEach(t => {
  console.log(`  ${t.url.slice(0, 90)}`);
});

// 混元/gemini/kimi 输入框与对话流
for (const [host, cfg] of Object.entries({
  'yuanbao.tencent.com': { editor: 'textarea, [contenteditable="true"]', user: '[class*="bubble__content"]' },
  'gemini.google.com': { editor: '.ql-editor[contenteditable="true"]', user: 'user-query' },
  'kimi.com': { editor: '[contenteditable="true"]', user: '[class*="chat-content-item-user"]' }
})) {
  const tab = tabs.find(t => t.type === 'page' && t.url.includes(host) && !/membership|pricing/.test(t.url));
  if (!tab) { console.log(`\n===== ${host}: 无标签 =====`); continue; }
  console.log(`\n===== ${host} =====`);
  console.log(`  URL: ${tab.url.slice(0, 80)}`);
  try {
    const c = await cdp(tab.webSocketDebuggerUrl);
    const res = await c.cmd('Runtime.evaluate', {
      expression: `(function(){
        var eds = Array.from(document.querySelectorAll(${JSON.stringify(cfg.editor)})).filter(function(e){ return e.offsetParent; });
        var ed = eds[eds.length - 1] || null;
        var val = ed ? ((ed.value !== undefined && ed.tagName === 'TEXTAREA') ? ed.value : (ed.innerText || '')) : '';
        var users = document.querySelectorAll(${JSON.stringify(cfg.user)});
        var lastFew = [];
        for (var i = Math.max(0, users.length - 3); i < users.length; i++) {
          lastFew.push((users[i].innerText || '').trim().slice(0, 50));
        }
        return JSON.stringify({ visibility: document.visibilityState,
          editorLen: val.length, editorHead: val.slice(0, 60), editorHasNewline: val.indexOf('\\n') >= 0,
          userCount: users.length, lastFew: lastFew }, null, 1);
      })()`,
      returnByValue: true });
    console.log(' ', res.result?.result?.value ?? JSON.stringify(res.result).slice(0, 200));
    c.close();
  } catch (e) { console.log('  ERROR:', e.message); }
}
console.log('\ndone');
