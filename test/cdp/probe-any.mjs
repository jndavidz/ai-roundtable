import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const site = process.argv[2] || 'qianwen.com';
const sel = process.argv[3] || 'pre';
const grep = process.argv[4] || 'npx';
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes(site));
if (!tab) { console.log('no tab for', site); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var els = document.querySelectorAll(${JSON.stringify(sel)});
    var out = [];
    for (var i = 0; i < els.length && out.length < 2; i++) {
      var el = els[i];
      var t = (el.innerText || '');
      if (!t) continue;
      if (${JSON.stringify(grep)} && t.indexOf(${JSON.stringify(grep)}) < 0) continue;
      out.push(el.outerHTML.slice(0, 1500));
    }
    return out.join('\\n=====\\n') || 'NOT FOUND';
  })()`,
  returnByValue: true });
console.log(res.result.result.value);
c.close();
