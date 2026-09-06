import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('gemini.google.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var chips = Array.from(document.querySelectorAll('source-inline-chip'));
    return JSON.stringify({ count: chips.length,
      samples: chips.slice(0, 3).map(function (ch) {
        return { outer: ch.outerHTML.slice(0, 900),
          links: Array.from(ch.querySelectorAll('a[href]')).map(function (a) { return a.getAttribute('href').slice(0, 80); }) };
      }) }, null, 1);
  })()`,
  returnByValue: true });
const val = res.result?.result?.value;
console.log(val === undefined ? JSON.stringify(res.result).slice(0, 300) : String(val).slice(0, 2800));
c.close();
