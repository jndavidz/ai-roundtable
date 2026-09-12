import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('yuanbao.tencent.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var out = {};
    var md = document.querySelectorAll('[class*="hyc-content-md"]');
    out.mdCount = md.length;
    out.mdList = [];
    md.forEach(function (el, i) {
      if (i >= 6) return;
      out.mdList.push({ i: i, cls: String(el.className).slice(0, 50),
        len: (el.innerText || '').length, head: (el.innerText || '').trim().slice(0, 45) });
    });
    var bub = document.querySelectorAll('[class*="bubble__content"]');
    out.bubbleCount = bub.length;
    out.bubbleList = [];
    bub.forEach(function (el, i) {
      if (i >= 6) return;
      out.bubbleList.push({ i: i, cls: String(el.className).slice(0, 50),
        len: (el.innerText || '').length, head: (el.innerText || '').trim().slice(0, 45) });
    });
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result?.result?.value ?? 'none');
c.close();
