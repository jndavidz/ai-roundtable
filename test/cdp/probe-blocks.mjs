import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const site = process.argv[2] || 'chatgpt.com';
const hostSel = process.argv[3] || '[data-message-author-role="assistant"]';
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes(site));
if (!tab) { console.log('no tab for', site); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var hosts = document.querySelectorAll(${JSON.stringify(hostSel)});
    if (!hosts.length) return JSON.stringify({ error: 'no host' });
    var root = hosts[hosts.length - 1];
    // 顶层块类型分布
    var dist = {};
    function walk(el, depth) {
      if (depth > 3) return;
      Array.from(el.children).forEach(function (ch) {
        if ((ch.innerText || '').trim()) {
          var key = ch.tagName + (ch.tagName === 'DIV' ? '.' + String(ch.className || '').split(' ').slice(0, 2).join('.') : '');
          dist[key] = (dist[key] || 0) + 1;
        }
        walk(ch, depth + 1);
      });
    }
    walk(root, 0);
    // markdown 容器的直接子节点序列
    var md = root.querySelector('.markdown, [class*="markdown"]');
    var seq = [];
    if (md) {
      Array.from(md.children).slice(0, 25).forEach(function (ch) {
        seq.push(ch.tagName + (String(ch.className || '').slice(0, 24) ? '.' + String(ch.className).slice(0, 24) : '') + '[' + (ch.innerText || '').trim().slice(0, 28) + ']');
      });
    }
    return JSON.stringify({ hostChildren: root.children.length, dist: dist, mdCls: md ? String(md.className).slice(0, 40) : null, seq: seq }, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result.result.value);
c.close();
