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
    m.querySelectorAll('[class*="cite"]').forEach(function (el) {
      var chain = [], n = el;
      for (var i = 0; i < 4 && n; i++) {
        chain.push(n.tagName + '.' + String(n.className || '').slice(0, 30));
        n = n.parentElement;
      }
      out.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 50),
        inPuaRef: !!el.closest('[class*="pua-ref"]'),
        prevText: (el.previousElementSibling ? (el.previousElementSibling.textContent || '').trim().slice(-30) : ''),
        href: (el.getAttribute('href') || '').slice(0, 50), chain: chain });
    });
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result.result.value.slice(0, 2600));
c.close();
