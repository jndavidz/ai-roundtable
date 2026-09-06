import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const site = process.argv[2] || 'chat.deepseek.com';
const grep = process.argv[3] || '免费网页搜索';
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes(site));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var ps = document.querySelectorAll('.ds-markdown li');
    for (var i = 0; i < ps.length; i++) {
      if ((ps[i].innerText || '').indexOf(${JSON.stringify(grep)}) >= 0) {
        return ps[i].outerHTML.slice(0, 1200);
      }
    }
    return 'NOT FOUND';
  })()`,
  returnByValue: true });
console.log(res.result.result.value);
c.close();
