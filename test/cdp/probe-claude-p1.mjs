import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('claude.ai'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var sels = ['[data-is-streaming="true"]', 'button[aria-label*="Stop" i]', '[aria-label*="Stop" i]',
                '[data-testid*="stop"]', '[class*="stop"]', '[aria-label*="停止" i]'];
    var out = [];
    sels.forEach(function (sel) {
      try {
        var els = document.querySelectorAll(sel);
        els.length && out.push({ sel: sel, n: els.length,
          first: els[0].outerHTML.slice(0, 120), visible: !!els[0].offsetParent });
      } catch (e) {}
    });
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result?.result?.value ?? 'none');
c.close();
