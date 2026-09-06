import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('doubao.com'));
const c = await cdp(tab.webSocketDebuggerUrl);
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    // 豆包回复特征: 含"置信度"或"推荐"的长段落(排除用户消息里的参考插件名)
    var cands = [];
    document.querySelectorAll('div, section, article').forEach(function (el) {
      var t = (el.innerText || '').trim();
      if (t.length > 200 && /ModSearch|modsearch|搜索插件/.test(t) && !/请联网搜索最佳实践/.test(t.slice(0, 50))) {
        cands.push(el);
      }
    });
    // 取最小(最内层)候选 —— 即助手回复的真实容器
    cands.sort(function (a, b) { return (a.innerText || '').length - (b.innerText || '').length; });
    var out = { candCount: cands.length, samples: [] };
    cands.slice(0, 3).forEach(function (el) {
      var chain = [], n = el;
      for (var i = 0; i < 6 && n; i++) { chain.push(n.tagName + '.' + String(n.className || '').slice(0, 36) + '[' + (n.innerText || '').length + ']'); n = n.parentElement; }
      out.samples.push({ len: (el.innerText || '').length, head: (el.innerText || '').trim().slice(0, 60), chain: chain });
    });
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result?.result?.value ?? 'none');
c.close();
