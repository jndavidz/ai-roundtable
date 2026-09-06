import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('gemini.google.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var t = document.querySelector('.table-block-component');
    if (!t) return 'NO TABLE BLOCK';
    var counts = { table: t.querySelectorAll('table').length, tr: t.querySelectorAll('tr').length,
                   row: t.querySelectorAll('[class*="row"], [role="row"]').length,
                   cell: t.querySelectorAll('[class*="cell"], [role="cell"]').length,
                   innerTables: t.querySelectorAll('table, [role="table"]').length };
    return JSON.stringify({ counts: counts, htmlHead: t.outerHTML.slice(0, 800) }, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result.result.value);
c.close();
