import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('doubao.com'));
if (!tab) { console.log('no doubao tab'); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var boxes = document.querySelectorAll('[class*="md-box-root"]:not([class*="gh-user"])');
    var m = boxes[boxes.length - 1];
    if (!m) return JSON.stringify({ error: 'no box' });
    var out = { preCount: m.querySelectorAll('pre').length, codeCount: m.querySelectorAll('code').length, samples: [] };
    // 每个代码块的容器链 + 是否含相同文本的兄弟
    m.querySelectorAll('pre').forEach(function (p, i) {
      if (i >= 3) return;
      var txt = (p.textContent || '').trim().slice(0, 40);
      // 找相同文本的其他 pre
      var dup = 0;
      m.querySelectorAll('pre').forEach(function (o) {
        if (o !== p && (o.textContent || '').trim() === (p.textContent || '').trim()) dup++;
      });
      var chain = [], n = p;
      for (var k = 0; k < 4 && n; k++) { chain.push(n.tagName + '.' + String(n.className || '').slice(0, 30)); n = n.parentElement; }
      out.samples.push({ i: i, txt: txt, dupCount: dup, chain: chain });
    });
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result?.result?.value ?? 'none');
c.close();
