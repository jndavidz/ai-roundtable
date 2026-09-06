import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('gemini.google.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var mc = document.querySelectorAll('message-content');
    var m = mc[mc.length - 1];
    // 找「配置与部署最佳实践」标题元素, 打印它和后续 4 个兄弟
    var all = m.querySelectorAll('*');
    var anchor = null;
    for (var i = 0; i < all.length; i++) {
      var t = (all[i].textContent || '').trim();
      var own = '';
      for (var j = 0; j < all[i].childNodes.length; j++) {
        if (all[i].childNodes[j].nodeType === 3) own += all[i].childNodes[j].nodeValue;
      }
      if (/配置与部署最佳实践/.test(own.trim())) { anchor = all[i]; break; }
    }
    if (!anchor) return 'ANCHOR NOT FOUND';
    var out = [];
    var n = anchor;
    for (var k = 0; k < 5 && n; k++) {
      out.push({ tag: n.tagName, cls: String(n.className || '').slice(0, 30),
                 html: n.outerHTML.slice(0, 500) });
      n = n.nextElementSibling;
      if (!n) { // 上溯到父级再找兄弟
        var p = anchor;
        for (var q = 0; q < 3 && p; q++) { p = p.parentElement; if (p && p.nextElementSibling) { n = p.nextElementSibling; break; } }
      }
    }
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result.result.value.slice(0, 2500));
c.close();
