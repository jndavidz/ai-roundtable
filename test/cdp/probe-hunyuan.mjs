import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('yuanbao.tencent.com'));
if (!tab) { console.log('no hunyuan tab'); process.exit(1); }
console.log('URL:', tab.url);
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var sels = ['[class*="markdown"]', '[class*="chat-content"]', '[class*="message"] [class*="content"]',
      '[class*="answer"]', '[class*="response"]', '[class*="bubble"]', '.agent-chat__content',
      '[class*="hyc-content"]', '[class*="agent-chat"]', '[class*="chat-message"]', '[class*="conversation"]'];
    var out = [];
    sels.forEach(function (sel) {
      try {
        var els = document.querySelectorAll(sel);
        if (els.length) {
          var last = els[els.length - 1];
          out.push({ sel: sel, n: els.length, lastLen: (last.innerText || '').length,
            lastCls: String(last.className || '').slice(0, 44),
            head: (last.innerText || '').trim().slice(0, 40) });
        }
      } catch (e) {}
    });
    return JSON.stringify({ url: location.href.slice(0, 60), hits: out }, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result?.result?.value ?? 'none');
c.close();
