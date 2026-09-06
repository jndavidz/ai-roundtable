import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('kimi.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var m = document.querySelector('.chat-content-item-assistant');
    var out = {};
    // 各类候选角标
    ['sup', '[class*="citation"]', '[class*="cite"]', '[class*="footnote"]', '[class*="quote-mark"]', '[class*="ref-mark"]'].forEach(function (sel) {
      var els = m.querySelectorAll(sel);
      if (els.length) out[sel] = { n: els.length, sample: els[0].outerHTML.slice(0, 200) };
    });
    // 含链接的行内 a(正文里的引用链接, 排除 pua-ref 卡片)
    var links = [];
    m.querySelectorAll('a[href]').forEach(function (a) {
      if (a.closest('[class*="pua-ref"]')) return;
      var cls = String(a.className || '');
      links.push({ cls: cls.slice(0, 40), text: (a.textContent || '').trim().slice(0, 24), href: a.getAttribute('href').slice(0, 60) });
    });
    out.inlineLinks = { n: links.length, sample: links.slice(0, 6) };
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result.result.value.slice(0, 2400));
c.close();
