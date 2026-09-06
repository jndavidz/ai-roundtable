import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com'));
if (!tab) { console.log('no kimi tab'); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var m = document.querySelector('.chat-content-item-assistant');
    if (!m) return JSON.stringify({ error: 'no assistant' });
    var out = { citeEls: [], readPageCtx: [] };
    // 找 "read_page" / "单页精读" 所在元素及其后续兄弟(引用角标常在句尾)
    m.querySelectorAll('span, p, div').forEach(function (el) {
      var t = (el.textContent || '');
      if (/单页精读|read_page/.test(t) && el.children.length < 6 && out.readPageCtx.length < 2) {
        out.readPageCtx.push(el.outerHTML.slice(0, 700));
      }
    });
    // 引用角标候选: 上标/数字/引用 class
    m.querySelectorAll('sup, [class*="cite"], [class*="citation"], [class*="ref"], a[class*="ref"]').forEach(function (el) {
      if (out.citeEls.length < 8) {
        out.citeEls.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 40),
          text: (el.textContent || '').trim().slice(0, 20),
          href: el.getAttribute('href') || null,
          dataUrl: el.getAttribute('data-url') || el.dataset?.url || null });
      }
    });
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result.result.value.slice(0, 2400));
c.close();
