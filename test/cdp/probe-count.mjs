import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const site = (process.argv[2] || 'chat.deepseek.com');
const sel = process.argv[3] || '.ds-markdown';
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes(site));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `JSON.stringify({ count: document.querySelectorAll(${JSON.stringify(sel)}).length, bodyLen: document.body.innerText.length })`,
  returnByValue: true });
console.log(sel, '=>', res.result.result.value);
c.close();
