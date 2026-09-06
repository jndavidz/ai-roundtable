import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const EXPR = `(function () {
  var item = document.querySelector('.answer-content-wrap .source-item');
  if (!item) return JSON.stringify({ error: 'no source-item' });
  var wrap = item.closest('.source-wrapper, .source-list, .sources, [class*="source"]') || item.parentElement;
  return JSON.stringify({
    itemHTML: item.outerHTML.slice(0, 400),
    parentCls: String(wrap.className || '').slice(0, 60),
    parentHTML: wrap.outerHTML.slice(0, 900),
    // 找页面里所有可能的 URL 载体
    withHref: Array.from(document.querySelectorAll('[href]')).length,
    dataAttrs: Object.keys(item.dataset || {})
  });
})();`;
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('chatglm.cn'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
console.log(res.result?.result?.value);
c.close();
