import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatgpt.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var btns = Array.from(document.querySelectorAll('button'));
    var hits = btns.filter(function (b) {
      return /个人资料|profile|Profile/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-testid') || ''));
    });
    return JSON.stringify(hits.map(function (b) {
      return { aria: b.getAttribute('aria-label'), tid: b.getAttribute('data-testid'),
               visible: !!b.offsetParent, rect: b.getBoundingClientRect().width + 'x' + b.getBoundingClientRect().height };
    }), null, 1);
  })()`,
  returnByValue: true });
console.log(res.result.result.value);
c.close();
