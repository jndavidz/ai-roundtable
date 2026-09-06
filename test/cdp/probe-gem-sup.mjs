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
    var out = { supSamples: [], dshMarket: [] };
    // sup 完整结构 + 父容器
    var sups = Array.from(m.querySelectorAll("sup.superscript"));
    sups.slice(0, 3).forEach(function (s) {
      out.supSamples.push({ outer: s.outerHTML.slice(0, 250),
        parentTag: s.parentElement.tagName,
        parentCls: String(s.parentElement.className || '').slice(0, 40),
        parentOuter: s.parentElement.outerHTML.slice(0, 350) });
    });
    // DSH Market 句子的完整结构
    m.querySelectorAll('*').forEach(function (el) {
      var t = (el.textContent || '');
      if (t.indexOf('DSH Market') >= 0 && el.children.length <= 4 && out.dshMarket.length < 2) {
        out.dshMarket.push(el.outerHTML.slice(0, 800));
      }
    });
    return JSON.stringify(out, null, 1);
  })()`,
  returnByValue: true });
const val = res.result?.result?.value;
if (val === undefined) console.log('RAW:', JSON.stringify(res.result).slice(0, 500));
else console.log(String(val).slice(0, 2600));
c.close();
