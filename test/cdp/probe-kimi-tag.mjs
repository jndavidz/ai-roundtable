import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var m = document.querySelector('.chat-content-item-assistant');
    var out = [];
    m.querySelectorAll('.pua-ref-cite-tag').forEach(function (a) {
      if (a.closest('.pua-ref-renderer:has([class*="pua-ref-article"])')) return;
      out.push({ outer: a.outerHTML.slice(0, 300),
        text: (a.textContent || '').trim().slice(0, 50),
        href: a.getAttribute('href').slice(0, 80) });
    });
    return JSON.stringify(out.slice(0, 4), null, 1);
  })()`,
  returnByValue: true });
console.log(res.result.result.value.slice(0, 1800));
c.close();
