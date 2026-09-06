import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('doubao.com'));
if (!tab) { console.log('no doubao tab'); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var out = { url: location.href.slice(0, 60), userQ: [], reply: [], containers: [] };
    // 用户问题所在容器
    document.querySelectorAll('*').forEach(function (el) {
      var own = '';
      for (var i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === 3) own += el.childNodes[i].nodeValue;
      }
      if (/请联网搜索最佳实践/.test(own) && out.userQ.length < 2) {
        out.userQ.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 50) });
      }
    });
    // 常见回复容器探测
    ['[data-testid]', '[class*="message"]', '[class*="answer"]', '[class*="response"]',
     '[class*="receive"]', '[class*="send"]', '[class*="reply"]', '[class*="agent"]'].forEach(function (sel) {
      try {
        var els = document.querySelectorAll(sel);
        if (els.length && out.containers.length < 10) {
          out.containers.push({ sel: sel, n: els.length, firstCls: String(els[0].className || '').slice(0, 40) });
        }
      } catch (e) {}
    });
    // 页面主内容区文本
    out.bodyHead = (document.body.innerText || '').trim().slice(0, 200);
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result?.result?.value ?? 'none');
c.close();
