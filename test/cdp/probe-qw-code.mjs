import { pathToFileURL } from "node:url";
import http from "node:http";
const { cdp } = await import(pathToFileURL("D:/repos/aurora/scripts/cdp/cdp-helper.mjs").href);
const tabs = await new Promise((res) => { http.get({ host: '127.0.0.1', port: 9223, path: '/json/list' }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }); });
const tab = tabs.find(t => t.type === 'page' && t.url.includes('qianwen.com'));
if (!tab) { console.log('no qianwen tab'); process.exit(1); }
const c = await cdp(tab.webSocketDebuggerUrl);
// 找代码块容器与行号元素
const res = await c.cmd('Runtime.evaluate', {
  expression: `(function(){
    var out = { codeContainers: [], citeLike: [] };
    // 常见代码块 class 探测
    var sels = ['pre', '[class*="code"]', '[class*="highlight"]'];
    var seen = new Set();
    sels.forEach(function(sel){
      Array.from(document.querySelectorAll(sel)).slice(0, 6).forEach(function(el){
        if (seen.has(el)) return; seen.add(el);
        var cls = String(el.className || '').slice(0, 60);
        var t = (el.innerText || '').trim().slice(0, 60);
        if (!t) return;
        out.codeContainers.push({ sel: sel, tag: el.tagName, cls: cls, text: t });
      });
    });
    // 行号候选: 纯数字小元素
    Array.from(document.querySelectorAll('span,div')).forEach(function(el){
      var t = (el.textContent || '').trim();
      if (/^\\d+$/.test(t) && el.children.length === 0 && (el.className || '').toString()) {
        var cls = String(el.className || '').slice(0, 50);
        var key = cls;
        if (!out.citeLike.some(function(x){ return x.cls === key; }) && out.citeLike.length < 8) {
          out.citeLike.push({ cls: cls, num: t, parentCls: String(el.parentElement.className || '').slice(0, 40) });
        }
      }
    });
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
console.log(res.result.result.value);
c.close();
