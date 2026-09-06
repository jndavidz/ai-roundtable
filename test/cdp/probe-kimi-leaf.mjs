import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var m = document.querySelector('.chat-content-item-assistant');
    var best = null, bestLen = 1e9;
    m.querySelectorAll('*').forEach(function (el) {
      var t = (el.textContent || '');
      if (t.indexOf('单页精读') >= 0 && t.length < bestLen) { best = el; bestLen = t.length; }
    });
    if (!best) return 'NOT FOUND';
    // 打印该元素与后续兄弟(引用角标可能在后面)
    var out = [];
    var n = best;
    for (var i = 0; i < 3 && n; i++) {
      out.push({ tag: n.tagName, cls: String(n.className || '').slice(0, 40), html: n.outerHTML.slice(0, 900) });
      n = n.nextElementSibling;
    }
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result.result.value.slice(0, 2200));
c.close();
