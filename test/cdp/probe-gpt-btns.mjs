import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatgpt.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var btns = Array.from(document.querySelectorAll('button, [role="button"]'));
    var out = [];
    btns.forEach(function (b) {
      var label = b.getAttribute('aria-label') || b.getAttribute('data-testid') || (b.innerText || '').trim().slice(0, 18);
      if (label && out.length < 45) out.push(String(label).slice(0, 34));
    });
    return JSON.stringify(out);
  })()`,
  returnByValue: true });
console.log(res.result.result.value);
c.close();
